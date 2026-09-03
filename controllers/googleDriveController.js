const asyncHandler = require('express-async-handler');
const User = require('../models/User');
const GoogleDriveConnection = require('../models/GoogleDriveConnection');
const {
  buildGoogleDriveAuthUrl,
  buildFrontendRedirectUrl,
  consumeGoogleDriveState,
  createGoogleDriveState,
  getRequiredGoogleConfig,
  getScopes,
  sanitizeReason,
} = require('../utils/googleDriveOAuth');
const { encryptValue, decryptValue } = require('../utils/googleDriveCrypto');

const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
const GOOGLE_DRIVE_ABOUT_ENDPOINT = 'https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName,photoLink)';

const redirectWithGoogleDriveStatus = (res, query) => {
  try {
    return res.redirect(302, buildFrontendRedirectUrl(query));
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const exchangeGoogleCodeForTokens = async (code, config) => {
  const body = new URLSearchParams({
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    grant_type: 'authorization_code',
  });

  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  const data = await response.json();

  if (!response.ok) {
    const message = data.error_description || data.error || 'Unable to exchange Google authorization code';
    throw new Error(message);
  }

  return data;
};

const fetchGoogleDriveAccount = async (accessToken) => {
  const response = await fetch(GOOGLE_DRIVE_ABOUT_ENDPOINT, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    return null;
  }

  return response.json();
};

const revokeGoogleToken = async (token) => {
  if (!token) {
    return;
  }

  const body = new URLSearchParams({ token });
  await fetch(GOOGLE_REVOKE_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
};

const startGoogleDriveAuth = asyncHandler(async (req, res) => {
  getRequiredGoogleConfig();

  const state = createGoogleDriveState(req.user);
  const authUrl = buildGoogleDriveAuthUrl(state);

  res.redirect(302, authUrl);
});

const handleGoogleDriveCallback = asyncHandler(async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    return redirectWithGoogleDriveStatus(res, {
      googleDrive: 'error',
      reason: sanitizeReason('google_rejected'),
    });
  }

  if (!code) {
    return redirectWithGoogleDriveStatus(res, {
      googleDrive: 'error',
      reason: sanitizeReason('missing_code'),
    });
  }

  if (!state) {
    return redirectWithGoogleDriveStatus(res, {
      googleDrive: 'error',
      reason: sanitizeReason('invalid_state'),
    });
  }

  let config;
  try {
    config = getRequiredGoogleConfig();
  } catch (configError) {
    return redirectWithGoogleDriveStatus(res, {
      googleDrive: 'error',
      reason: sanitizeReason('invalid_config'),
    });
  }

  let decodedState;
  try {
    decodedState = require('jsonwebtoken').verify(state, process.env.JWT_SECRET);
  } catch (verifyError) {
    return redirectWithGoogleDriveStatus(res, {
      googleDrive: 'error',
      reason: sanitizeReason('invalid_state'),
    });
  }

  const storedState = consumeGoogleDriveState(state);
  if (
    !storedState ||
    storedState.userId !== String(decodedState.userId) ||
    storedState.nonce !== decodedState.nonce ||
    decodedState.purpose !== 'google-drive-oauth'
  ) {
    return redirectWithGoogleDriveStatus(res, {
      googleDrive: 'error',
      reason: sanitizeReason('invalid_state'),
    });
  }

  const user = await User.findById(storedState.userId);
  if (!user || !user.isAdmin) {
    return redirectWithGoogleDriveStatus(res, {
      googleDrive: 'error',
      reason: sanitizeReason('invalid_state'),
    });
  }

  const tokenData = await exchangeGoogleCodeForTokens(code, config);
  const existingConnection = await GoogleDriveConnection.findOne({ user: user._id });

  const accountData = await fetchGoogleDriveAccount(tokenData.access_token);
  const accessToken = tokenData.access_token || '';
  const refreshToken = tokenData.refresh_token || '';

  const connection = existingConnection || new GoogleDriveConnection({ user: user._id });
  connection.googleAccountId = accountData?.user?.emailAddress || connection.googleAccountId || '';
  connection.email = accountData?.user?.emailAddress || connection.email || user.email;
  connection.scope = typeof tokenData.scope === 'string'
    ? tokenData.scope.split(/\s+/).filter(Boolean)
    : getScopes();
  connection.accessTokenEncrypted = encryptValue(accessToken);
  connection.refreshTokenEncrypted = encryptValue(refreshToken || decryptValue(existingConnection?.refreshTokenEncrypted || ''));
  connection.tokenExpiresAt = tokenData.expires_in ? new Date(Date.now() + (Number(tokenData.expires_in) * 1000)) : null;
  connection.connectedAt = connection.connectedAt || new Date();
  connection.lastRefreshedAt = new Date();

  if (!connection.refreshTokenEncrypted && !existingConnection?.refreshTokenEncrypted) {
    return redirectWithGoogleDriveStatus(res, {
      googleDrive: 'error',
      reason: sanitizeReason('oauth_failed'),
    });
  }

  await connection.save();

  return redirectWithGoogleDriveStatus(res, {
    googleDrive: 'connected',
  });
});

const getGoogleDriveStatus = asyncHandler(async (req, res) => {
  const connection = await GoogleDriveConnection.findOne({ user: req.user._id });

  return res.status(200).json({
    success: true,
    connected: Boolean(connection),
    email: connection?.email || null,
    connectedAt: connection?.connectedAt || null,
  });
});

const disconnectGoogleDrive = asyncHandler(async (req, res) => {
  const connection = await GoogleDriveConnection.findOne({ user: req.user._id });

  if (!connection) {
    return res.status(200).json({
      success: true,
      connected: false,
    });
  }

  let tokenToRevoke = '';
  try {
    tokenToRevoke = connection.refreshTokenEncrypted
      ? decryptValue(connection.refreshTokenEncrypted)
      : decryptValue(connection.accessTokenEncrypted);
  } catch (error) {
    tokenToRevoke = '';
  }

  try {
    await revokeGoogleToken(tokenToRevoke);
  } catch (revokeError) {
    console.warn('Google Drive token revocation failed:', revokeError.message);
  }

  await GoogleDriveConnection.deleteOne({ _id: connection._id });

  return res.status(200).json({
    success: true,
    connected: false,
  });
});

module.exports = {
  disconnectGoogleDrive,
  getGoogleDriveStatus,
  handleGoogleDriveCallback,
  startGoogleDriveAuth,
};
