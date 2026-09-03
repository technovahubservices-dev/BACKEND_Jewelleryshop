const fs = require('fs');
const path = require('path');
const GoogleDriveConnection = require('../models/GoogleDriveConnection');
const { decryptValue, encryptValue } = require('./googleDriveCrypto');
const { getRequiredGoogleConfig } = require('./googleDriveOAuth');

const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_UPLOAD_ENDPOINT = 'https://www.googleapis.com/upload/drive/v3/files';
const GOOGLE_FILES_ENDPOINT = 'https://www.googleapis.com/drive/v3/files';

const driveError = (message) => {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
};

const getAccessToken = async (userId, { forceRefresh = false } = {}) => {
  const connection = await GoogleDriveConnection.findOne({ user: userId });

  if (!connection || !connection.refreshTokenEncrypted) {
    throw driveError('Connect Google Drive before uploading files');
  }

  const accessToken = decryptValue(connection.accessTokenEncrypted);
  if (!forceRefresh && accessToken && connection.tokenExpiresAt && connection.tokenExpiresAt > new Date(Date.now() + 60 * 1000)) {
    return { accessToken, connection };
  }

  const config = getRequiredGoogleConfig();
  const refreshToken = decryptValue(connection.refreshTokenEncrypted);
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });

  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await response.json();

  if (!response.ok || !data.access_token) {
    throw driveError('Google Drive authorization has expired. Reconnect Google Drive.');
  }

  connection.accessTokenEncrypted = encryptValue(data.access_token);
  connection.tokenExpiresAt = new Date(Date.now() + (Number(data.expires_in) || 3600) * 1000);
  connection.lastRefreshedAt = new Date();
  await connection.save();

  return { accessToken: data.access_token, connection };
};

const requestDrive = async (userId, requestOptions) => {
  let tokenResult = await getAccessToken(userId);
  let response = await fetch(requestOptions.url, {
    ...requestOptions,
    headers: {
      ...(requestOptions.headers || {}),
      Authorization: `Bearer ${tokenResult.accessToken}`,
    },
  });

  if (response.status === 401) {
    tokenResult = await getAccessToken(userId, { forceRefresh: true });
    response = await fetch(requestOptions.url, {
      ...requestOptions,
      headers: {
        ...(requestOptions.headers || {}),
        Authorization: `Bearer ${tokenResult.accessToken}`,
      },
    });
  }

  return response;
};

const uploadFileToGoogleDrive = async ({ userId, filePath, originalName, mimeType, makePublic = false }) => {
  if (!filePath || !fs.existsSync(filePath)) {
    throw driveError('Uploaded file is no longer available on the server');
  }

  const name = `${Date.now()}-${path.basename(originalName || path.basename(filePath))}`;
  const metadata = {
    name,
    ...(process.env.GOOGLE_DRIVE_FOLDER_ID
      ? { parents: [process.env.GOOGLE_DRIVE_FOLDER_ID] }
      : {}),
  };
  const fileBuffer = await fs.promises.readFile(filePath);
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', new Blob([fileBuffer], { type: mimeType || 'application/octet-stream' }), name);

  const response = await requestDrive(userId, {
    url: `${GOOGLE_UPLOAD_ENDPOINT}?uploadType=multipart&fields=id,name,mimeType,webViewLink,webContentLink`,
    method: 'POST',
    body: form,
  });
  const data = await response.json();

  if (!response.ok || !data.id) {
    throw driveError(data.error?.message || 'Unable to upload file to Google Drive');
  }

  if (makePublic) {
    const permissionResponse = await requestDrive(userId, {
      url: `${GOOGLE_FILES_ENDPOINT}/${encodeURIComponent(data.id)}/permissions`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'anyone', role: 'reader' }),
    });

    if (!permissionResponse.ok) {
      throw driveError('File uploaded, but Google Drive sharing could not be configured');
    }
  }

  return {
    id: data.id,
    name: data.name,
    mimeType: data.mimeType,
    url: makePublic
      ? `https://drive.google.com/uc?export=view&id=${encodeURIComponent(data.id)}`
      : data.webViewLink || `https://drive.google.com/file/d/${encodeURIComponent(data.id)}/view`,
  };
};

const uploadRequestFilesToGoogleDrive = async (req, { makePublic = false } = {}) => {
  if (!req.files || req.files.length === 0) return [];

  const uploaded = [];
  for (const file of req.files) {
    uploaded.push(await uploadFileToGoogleDrive({
      userId: req.user._id,
      filePath: file.path,
      originalName: file.originalname,
      mimeType: file.mimetype,
      makePublic,
    }));
  }
  return uploaded;
};

const uploadRequestFileToGoogleDrive = async (req, { makePublic = false } = {}) => {
  if (!req.file) return null;

  return uploadFileToGoogleDrive({
    userId: req.user._id,
    filePath: req.file.path,
    originalName: req.file.originalname,
    mimeType: req.file.mimetype,
    makePublic,
  });
};

module.exports = {
  uploadFileToGoogleDrive,
  uploadRequestFileToGoogleDrive,
  uploadRequestFilesToGoogleDrive,
};
