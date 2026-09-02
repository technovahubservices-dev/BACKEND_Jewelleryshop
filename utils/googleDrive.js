const { google } = require('googleapis');
const path = require('path');

const CREDENTIALS_PATH = path.join(__dirname, 'jkr-fashion-c8363bb3d0b3.json');
const FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;

let driveClient = null;

function getDriveClient() {
  if (!driveClient) {
    const auth = new google.auth.GoogleAuth({
      keyFile: CREDENTIALS_PATH,
      scopes: ['https://www.googleapis.com/auth/drive.file'],
    });
    driveClient = google.drive({ version: 'v3', auth });
  }
  return driveClient;
}

async function uploadFile(buffer, originalName, mimeType) {
  try {
    const drive = getDriveClient();

    const fileMetadata = {
      name: originalName,
      parents: FOLDER_ID ? [FOLDER_ID] : undefined,
    };

    const media = {
      mimeType: mimeType || 'application/octet-stream',
      body: Buffer.from(buffer),
    };

    const response = await drive.files.create({
      resource: fileMetadata,
      media: media,
      fields: 'id, name, webViewLink, thumbnailLink, webContentLink',
    });

    const file = response.data;

    await drive.permissions.create({
      fileId: file.id,
      requestBody: {
        role: 'reader',
        type: 'anyone',
      },
    });

    const directUrl = `https://drive.google.com/uc?export=view&id=${file.id}`;

    return {
      fileId: file.id,
      fileName: file.name,
      url: directUrl,
      driveUrl: file.webViewLink,
    };
  } catch (error) {
    console.error('Google Drive upload error:', error.message);
    throw error;
  }
}

async function deleteFile(fileId) {
  try {
    const drive = getDriveClient();
    await drive.files.delete({ fileId });
    return true;
  } catch (error) {
    if (error.code === '404') {
      return true;
    }
    console.error('Google Drive delete error:', error.message);
    throw error;
  }
}

async function getFileUrl(fileId) {
  return `https://drive.google.com/uc?export=view&id=${fileId}`;
}

function isDriveUrl(str) {
  if (!str) return false;
  return str.startsWith('drive://') || str.startsWith('GD://');
}

function isDriveFileId(str) {
  if (!str) return false;
  return /^[a-zA-Z0-9_-]{25,}$/.test(str);
}

module.exports = {
  uploadFile,
  deleteFile,
  getFileUrl,
  isDriveUrl,
  isDriveFileId,
};