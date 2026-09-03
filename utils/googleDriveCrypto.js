const crypto = require('crypto');

const getEncryptionKey = () => {
  const seed = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY || process.env.JWT_SECRET || process.env.GOOGLE_CLIENT_SECRET;

  if (!seed) {
    throw new Error('Missing encryption secret for Google Drive tokens');
  }

  return crypto.createHash('sha256').update(String(seed)).digest();
};

const encryptValue = (value) => {
  if (!value) {
    return '';
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
};

const decryptValue = (payload) => {
  if (!payload) {
    return '';
  }

  const buffer = Buffer.from(String(payload), 'base64');

  if (buffer.length < 29) {
    throw new Error('Invalid encrypted payload');
  }

  const iv = buffer.subarray(0, 12);
  const authTag = buffer.subarray(12, 28);
  const encrypted = buffer.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', getEncryptionKey(), iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
};

module.exports = {
  encryptValue,
  decryptValue,
};
