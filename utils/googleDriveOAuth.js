const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const DEFAULT_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
];

const stateStore = new Map();

const getRequiredGoogleConfig = () => {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, FRONTEND_URL } = process.env;

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI || !FRONTEND_URL) {
    throw new Error('Google Drive OAuth environment variables are not fully configured');
  }

  const redirectUrl = new URL(GOOGLE_REDIRECT_URI);
  if (!redirectUrl.protocol || !redirectUrl.host) {
    throw new Error('GOOGLE_REDIRECT_URI must be an absolute URL');
  }

  if (redirectUrl.pathname !== '/api/auth/google-drive/callback') {
    throw new Error('GOOGLE_REDIRECT_URI must point to /api/auth/google-drive/callback');
  }

  return {
    clientId: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    redirectUri: redirectUrl.toString(),
    frontendUrl: new URL(FRONTEND_URL).toString(),
  };
};

const getScopes = () => {
  const rawScopes = process.env.GOOGLE_DRIVE_SCOPES;

  if (!rawScopes) {
    return DEFAULT_SCOPES;
  }

  const scopes = rawScopes
    .trim()
    .split(/\s+/)
    .map((scope) => scope.replace(/^['"]+|['"]+$/g, ''))
    .filter(Boolean);

  // Temporary safe diagnostic: scopes only, never OAuth credentials or tokens.
  console.log('[Google Drive OAuth] Parsed scopes:', scopes);

  return scopes.length ? scopes : DEFAULT_SCOPES;
};

const cleanupExpiredStates = () => {
  const now = Date.now();

  for (const [state, record] of stateStore.entries()) {
    if (record.expiresAt <= now) {
      stateStore.delete(state);
    }
  }
};

// Configure these in Google Cloud Console:
// OAuth client ID/secret, and an exact redirect URI matching /api/auth/google-drive/callback.
const createGoogleDriveState = (user) => {
  cleanupExpiredStates();

  const nonce = crypto.randomBytes(16).toString('hex');
  const state = jwt.sign(
    {
      purpose: 'google-drive-oauth',
      userId: String(user._id),
      nonce,
    },
    process.env.JWT_SECRET,
    { expiresIn: '10m' }
  );

  stateStore.set(state, {
    userId: String(user._id),
    nonce,
    expiresAt: Date.now() + 10 * 60 * 1000,
  });

  return state;
};

const consumeGoogleDriveState = (state) => {
  cleanupExpiredStates();

  const stored = stateStore.get(state);
  if (!stored) {
    return null;
  }

  stateStore.delete(state);
  return stored;
};

const buildGoogleDriveAuthUrl = (state) => {
  const config = getRequiredGoogleConfig();
  const scopes = getScopes();
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');

  authUrl.searchParams.set('client_id', config.clientId);
  authUrl.searchParams.set('redirect_uri', config.redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', scopes.join(' '));
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent');
  authUrl.searchParams.set('state', state);

  return authUrl.toString();
};

const buildFrontendRedirectUrl = (query = {}) => {
  const { frontendUrl } = getRequiredGoogleConfig();
  const url = new URL('/admin/settings', frontendUrl);

  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }

  return url.toString();
};

const sanitizeReason = (reason) => {
  const allowed = new Set([
    'missing_code',
    'invalid_state',
    'invalid_config',
    'token_exchange_failed',
    'google_rejected',
    'account_mismatch',
    'oauth_failed',
  ]);

  return allowed.has(reason) ? reason : 'oauth_failed';
};

module.exports = {
  buildGoogleDriveAuthUrl,
  buildFrontendRedirectUrl,
  consumeGoogleDriveState,
  createGoogleDriveState,
  getRequiredGoogleConfig,
  getScopes,
  sanitizeReason,
};
