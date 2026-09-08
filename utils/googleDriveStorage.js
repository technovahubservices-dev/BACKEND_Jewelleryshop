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

const buildPreviewUrl = (id) => {
  if (!id) {
    return '';
  }

  // Google Drive preview/embed URL suitable for iframe embedding.
  return `https://drive.google.com/file/d/${encodeURIComponent(id)}/preview`;
};

const buildProxyMediaUrl = (fileId, type = 'image') => {
  if (!fileId) {
    return '';
  }
  return `/api/upload/drive/${encodeURIComponent(fileId)}`;
};

const driveError = (message) => {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
};

const getGoogleDriveFileId = (url) => {
  if (!url || typeof url !== 'string') return null;

  let normalizedUrl = url.trim();

  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(normalizedUrl) &&
      !normalizedUrl.startsWith('/')) {
    normalizedUrl = `https://${normalizedUrl}`;
  }

  try {
    const parsed = new URL(normalizedUrl);
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

  const trimmed = url.trim();
  if (!trimmed) {
    return url;
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch (error) {
    if (/^[a-zA-Z0-9_-]{20,}$/.test(trimmed)) {
      return buildProxyMediaUrl(trimmed);
    }
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed) &&
        !trimmed.startsWith('/')) {
      try {
        parsed = new URL(`https://${trimmed}`);
      } catch (retryError) {
        return url;
      }
    } else {
      return url;
    }
  }

  const host = parsed.hostname.toLowerCase();

  if (!host.includes('google.com')) {
    return url;
  }

  const fileId = getGoogleDriveFileId(trimmed);

  if (!fileId) {
    return url;
  }

  return buildProxyMediaUrl(fileId);
};

const getGoogleDriveFileCapabilities = async (userId, fileId) => {
  const response = await requestDrive(userId, {
    url: `${GOOGLE_FILES_ENDPOINT}/${encodeURIComponent(fileId)}?fields=capabilities,id,name,mimeType,permissions`,
    method: 'GET',
  });

  if (!response.ok) {
    return null;
  }

  return response.json();
};

const ensurePublicPermission = async (userId, fileId) => {
  const file = await getGoogleDriveFileCapabilities(userId, fileId);
  if (!file) return false;

  const existingAnyone = Array.isArray(file.permissions)
    ? file.permissions.find((p) => p.type === 'anyone' && p.role === 'reader')
    : null;

  if (existingAnyone) {
    return true;
  }

  const permissionResponse = await requestDrive(userId, {
    url: `${GOOGLE_FILES_ENDPOINT}/${encodeURIComponent(fileId)}/permissions`,
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

  if (!permissionResponse.ok) {
    const permissionError = permissionData?.error?.message || 'Unknown Google Drive permission error';
    console.error('[Google Drive] Permission creation failed on repair', {
      fileId,
      status: permissionResponse.status,
      error: permissionError,
    });
    return false;
  }

  console.log('[Google Drive] Public permission set successfully', { fileId });
  return true;
};

const verifyDriveFileAccess = async (userId, fileId) => {
  if (!fileId) {
    const err = new Error('Google Drive file ID is required.');
    err.code = 'DRIVE_FILE_ID_ERROR';
    throw err;
  }

  const config = getRequiredGoogleConfig();
  const metadata = await getDriveFileMetadata(userId, fileId);

  const fileExists = metadata && metadata.id && !metadata.capabilities?.trashed;

  if (!fileExists) {
    const err = new Error('File does not exist or has been deleted in Google Drive.');
    err.code = 'DRIVE_FILE_NOT_FOUND';
    throw err;
  }

  const isInFolder = Array.isArray(metadata.parents) &&
    metadata.parents.includes(config.folderId);

  if (!isInFolder) {
    console.warn('[Drive Verification] File is not in the configured folder', {
      fileId,
      expectedFolderId: config.folderId,
      actualParents: metadata.parents || [],
    });
  }

  const hasPublicRead = metadata.capabilities?.canReadFile === true ||
    metadata.capabilities?.canDownload === true;

  if (!hasPublicRead) {
    const permissionSet = await ensurePublicPermission(userId, fileId);
    if (!permissionSet) {
      const err = new Error('File exists but public read permission could not be verified or applied.');
      err.code = 'DRIVE_ACCESS_ERROR';
      throw err;
    }
  }

  return {
    fileId: metadata.id,
    mimeType: metadata.mimeType,
    size: metadata.size,
    name: metadata.name,
    parents: metadata.parents || [],
    inFolder: isInFolder,
    publicRead: true,
  };
};

const repairDriveUrl = (url) => {
  if (!url || typeof url !== 'string') return url;

  const fileId = getGoogleDriveFileId(url);
  if (!fileId) return url;

  return buildProxyMediaUrl(fileId);
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

const getDriveFileMetadata = async (userId, fileId) => {
  if (!fileId) {
    const err = new Error('Google Drive file ID is required.');
    err.code = 'DRIVE_FILE_ID_ERROR';
    throw err;
  }

  const response = await requestDrive(userId, {
    url: `${GOOGLE_FILES_ENDPOINT}/${encodeURIComponent(fileId)}?fields=id,name,mimeType,size,capabilities`,
    method: 'GET',
  });

  if (!response.ok) {
    if (response.status === 404) {
      const err = new Error('File not found in Google Drive.');
      err.code = 'DRIVE_FILE_NOT_FOUND';
      throw err;
    }
    if (response.status === 403) {
      const err = new Error('Google Drive access denied. The file may not be publicly accessible.');
      err.code = 'DRIVE_ACCESS_ERROR';
      throw err;
    }
    const err = new Error('Failed to fetch Google Drive file metadata.');
    err.code = response.status;
    throw err;
  }

  return response.json();
};

const downloadDriveFileStream = async (userId, fileId) => {
  if (!fileId) {
    const err = new Error('Google Drive file ID is required.');
    err.code = 'DRIVE_FILE_ID_ERROR';
    throw err;
  }

  const response = await requestDrive(userId, {
    url: `${GOOGLE_FILES_ENDPOINT}/${encodeURIComponent(fileId)}?alt=media`,
    method: 'GET',
  });

  if (!response.ok) {
    if (response.status === 404) {
      const err = new Error('File not found in Google Drive.');
      err.code = 'DRIVE_FILE_NOT_FOUND';
      throw err;
    }
    if (response.status === 403) {
      const err = new Error('Google Drive access denied. The file may not be publicly accessible.');
      err.code = 'DRIVE_ACCESS_ERROR';
      throw err;
    }
    const err = new Error('Failed to download Google Drive file.');
    err.code = response.status;
    throw err;
  }

  return response;
};

const uploadFileToGoogleDrive = async ({ userId, filePath, buffer, originalName, mimeType, makePublic = false }) => {
  let fileBuffer;
  if (Buffer.isBuffer(buffer)) {
    fileBuffer = buffer;
  } else if (filePath && fs.existsSync(filePath)) {
    fileBuffer = await fs.promises.readFile(filePath);
  } else {
    throw driveError('Uploaded file is no longer available on the server');
  }

  const name = `${Date.now()}-${path.basename(originalName || 'image')}`;
  console.log('[Google Drive Upload] Preparing file upload', {
    userId: String(userId),
    filePath: filePath || null,
    inMemory: Buffer.isBuffer(buffer),
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
    const permissionSet = await ensurePublicPermission(userId, data.id);

    if (!permissionSet) {
      throw driveError('File uploaded to Google Drive, but public sharing permission could not be verified or applied.');
    }

    console.log('[Google Drive Upload] Public permission verified', {
      fileId: data.id,
      status: 'verified',
    });
  }

  if (!Array.isArray(data.parents) || !data.parents.includes(process.env.GOOGLE_DRIVE_FOLDER_ID)) {
    console.error('[Google Drive Upload] File was not created in the configured folder', {
      fileId: data.id,
      expectedFolderId: process.env.GOOGLE_DRIVE_FOLDER_ID,
      actualParents: data.parents || [],
    });
    await deleteFileFromGoogleDrive({ userId, fileId: data.id });
    throw driveError('Google Drive uploaded the file to an unexpected folder');
  }

  if (process.env.GOOGLE_DRIVE_FOLDER_ID) {
    try {
      await verifyDriveFileAccess(userId, data.id);
      console.log('[Google Drive Upload] File verified', {
        fileId: data.id,
        status: 'verified',
      });
    } catch (verifyErr) {
      console.error('[Google Drive Upload] File verification failed, deleting uploaded file', {
        fileId: data.id,
        error: verifyErr.message,
        code: verifyErr.code,
      });
      await deleteFileFromGoogleDrive({ userId, fileId: data.id });
      throw verifyErr;
    }
  }

  const proxyUrl = buildProxyMediaUrl(data.id);

  console.log('[Google Drive Upload] Final media URL', {
    fileId: data.id,
    url: proxyUrl,
  });

  const isVideo = data.mimeType && data.mimeType.startsWith('video/');
  const publicDriveUrl = isVideo
    ? buildPreviewUrl(data.id)
    : buildPublicDriveImageUrl(data.id);

  return {
    id: data.id,
    name: data.name,
    mimeType: data.mimeType,
    url: proxyUrl,
    viewUrl: proxyUrl,
    publicDriveUrl,
    previewUrl: isVideo ? buildPreviewUrl(data.id) : null,
    mediaType: isVideo ? 'video' : 'image',
    publicUrl: makePublic ? proxyUrl : null,
    uploadedAt: new Date().toISOString(),
  };
};

const uploadRequestFilesToGoogleDrive = async (req, { makePublic = false } = {}) => {
  if (!req.files || req.files.length === 0) return [];

  const uploaded = [];
  for (const file of req.files) {
    uploaded.push(await uploadFileToGoogleDrive({
      userId: req.user._id,
      filePath: file.path,
      buffer: file.buffer,
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
    buffer: req.file.buffer,
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

const getFileIdFromUrl = (url) => {
  if (!url || typeof url !== 'string') return null;

  const driveFileId = getGoogleDriveFileId(url);
  if (driveFileId) return driveFileId;

  const proxyMatch = url.match(/^\/api\/upload\/drive\/(.+)$/);
  if (proxyMatch) return proxyMatch[1];

  return null;
};

const deleteDriveFilesForUrls = async ({ userId, urls = [] }) => {
  const fileIds = [...new Set(urls.map(getFileIdFromUrl).filter(Boolean))];

  for (const fileId of fileIds) {
    await deleteFileFromGoogleDrive({ userId, fileId });
  }
};

module.exports = {
  deleteDriveFilesForUrls,
  deleteFileFromGoogleDrive,
  getGoogleDriveFileId,
  normalizeGoogleDriveUrl,
  repairDriveUrl,
  ensurePublicPermission,
  getDriveFileMetadata,
  downloadDriveFileStream,
  buildPublicDriveImageUrl,
  buildProxyMediaUrl,
  buildPreviewUrl,
  verifyDriveFileAccess,
  uploadFileToGoogleDrive,
  uploadRequestFileToGoogleDrive,
  uploadRequestFilesToGoogleDrive,
};
