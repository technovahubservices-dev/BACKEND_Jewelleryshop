const fs = require('fs');
const path = require('path');
const GoogleDriveConnection = require('../models/GoogleDriveConnection');
const { decryptValue, encryptValue } = require('./googleDriveCrypto');
const { getRequiredGoogleConfig } = require('./googleDriveOAuth');

const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_UPLOAD_ENDPOINT = 'https://www.googleapis.com/upload/drive/v3/files';
const GOOGLE_FILES_ENDPOINT = 'https://www.googleapis.com/drive/v3/files';

const buildPublicDriveImageUrl = (id) => {
  if (!id) {
    return '';
  }

  // Drive's uc?export=view endpoint can return an HTML/interstitial response
  // to browser image requests. The thumbnail endpoint returns image content.
  return `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w2000`;
};

const driveError = (message) => {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
};

const getGoogleDriveFileId = (url) => {
  if (!url || typeof url !== 'string') return null;

  try {
    const parsed = new URL(url);
    if (!parsed.hostname.toLowerCase().includes('google.com')) return null;

    return parsed.searchParams.get('id')
      || parsed.pathname.match(/\/file\/d\/([^/]+)/)?.[1]
      || null;
  } catch (error) {
    return null;
  }
};

const normalizeGoogleDriveUrl = (url) => {
  if (!url || typeof url !== 'string') {
    return url;
  }

  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();

    if (!host.includes('google.com')) {
      return url;
    }

    const fileId = getGoogleDriveFileId(url);

    if (!fileId) {
      return url;
    }

    if (parsed.pathname === '/thumbnail') {
      return url;
    }

    return `https://drive.google.com/thumbnail?id=${encodeURIComponent(fileId)}&sz=w2000`;
  } catch (error) {
    return url;
  }
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
  console.log('[Google Drive Upload] Preparing file upload', {
    userId: String(userId),
    filePath,
    originalName,
    mimeType,
    name,
    makePublic,
  });

  if (!process.env.GOOGLE_DRIVE_FOLDER_ID) {
    throw driveError('GOOGLE_DRIVE_FOLDER_ID is not configured');
  }
  const metadata = {
    name,
    parents: [process.env.GOOGLE_DRIVE_FOLDER_ID],
  };
  const fileBuffer = await fs.promises.readFile(filePath);
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', new Blob([fileBuffer], { type: mimeType || 'application/octet-stream' }), name);

  const response = await requestDrive(userId, {
    url: `${GOOGLE_UPLOAD_ENDPOINT}?uploadType=multipart&fields=id,name,mimeType,parents`,
    method: 'POST',
    body: form,
  });
  const data = await response.json();

  console.log('[Google Drive Upload] Upload response', {
    ok: response.ok,
    status: response.status,
    id: data?.id || null,
    name: data?.name || null,
    mimeType: data?.mimeType || null,
    error: data?.error?.message || null,
  });

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

    let permissionData = null;
    try {
      permissionData = await permissionResponse.json();
    } catch (error) {
      permissionData = null;
    }

    console.log('[Google Drive Upload] Permission response', {
      ok: permissionResponse.ok,
      status: permissionResponse.status,
      fileId: data.id,
      response: permissionData,
    });

    if (!permissionResponse.ok) {
      const permissionError = permissionData?.error?.message || 'Unknown Google Drive permission error';
      console.error('[Google Drive Upload] Permission creation failed', {
        fileId: data.id,
        status: permissionResponse.status,
        error: permissionError,
      });
      throw driveError(`File uploaded, but Google Drive sharing failed: ${permissionError}`);
    }
  }

  if (!Array.isArray(data.parents) || !data.parents.includes(process.env.GOOGLE_DRIVE_FOLDER_ID)) {
    console.error('[Google Drive Upload] File was not created in the configured folder', {
      fileId: data.id,
      expectedFolderId: process.env.GOOGLE_DRIVE_FOLDER_ID,
      actualParents: data.parents || [],
    });
    throw driveError('Google Drive uploaded the file to an unexpected folder');
  }

  const url = buildPublicDriveImageUrl(data.id);

  console.log('[Google Drive Upload] Final image url', {
    fileId: data.id,
    url,
  });

  return {
    id: data.id,
    name: data.name,
    mimeType: data.mimeType,
    url,
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

const deleteFileFromGoogleDrive = async ({ userId, fileId }) => {
  if (!fileId) return;

  const response = await requestDrive(userId, {
    url: `${GOOGLE_FILES_ENDPOINT}/${encodeURIComponent(fileId)}`,
    method: 'DELETE',
  });

  let data = null;
  try {
    data = await response.json();
  } catch (error) {
    data = null;
  }

  if (response.status === 404) {
    console.warn('[Google Drive Delete] File was already missing', { fileId });
    return;
  }

  if (!response.ok) {
    const message = data?.error?.message || 'Unable to delete file from Google Drive';
    console.error('[Google Drive Delete] API error', {
      fileId,
      status: response.status,
      error: data?.error || data,
    });
    throw driveError(message);
  }

  console.log('[Google Drive Delete] File deleted', {
    fileId,
    status: response.status,
  });
};

const deleteDriveFilesForUrls = async ({ userId, urls = [] }) => {
  const fileIds = [...new Set(urls.map(getGoogleDriveFileId).filter(Boolean))];

  for (const fileId of fileIds) {
    await deleteFileFromGoogleDrive({ userId, fileId });
  }
};

module.exports = {
  deleteDriveFilesForUrls,
  deleteFileFromGoogleDrive,
  getGoogleDriveFileId,
  normalizeGoogleDriveUrl,
  uploadFileToGoogleDrive,
  uploadRequestFileToGoogleDrive,
  uploadRequestFilesToGoogleDrive,
};
