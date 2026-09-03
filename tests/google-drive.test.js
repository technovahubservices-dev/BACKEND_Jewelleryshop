jest.mock('../middleware/uploadImage', () => ({
  array: () => (req, res, next) => next(),
  single: () => (req, res, next) => next(),
}));

jest.mock('../middleware/upload', () => ({
  array: () => (req, res, next) => next(),
  single: () => (req, res, next) => next(),
}));

const request = require('supertest');
const { app } = require('../server');
const { close, connect } = require('./setup');
const User = require('../models/User');
const GoogleDriveConnection = require('../models/GoogleDriveConnection');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getScopes } = require('../utils/googleDriveOAuth');

const createAdminUser = async (email, password) => {
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(password, salt);
  return User.create({
    name: 'Admin',
    email,
    password: hashedPassword,
    isAdmin: true,
  });
};

describe('Google Drive integration', () => {
  beforeAll(connect);
  afterAll(close);

  let admin;
  let adminToken;
  let originalFetch;

  beforeAll(async () => {
    process.env.GOOGLE_CLIENT_ID = 'google-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'google-client-secret';
    process.env.GOOGLE_REDIRECT_URI = 'http://localhost:5000/api/auth/google-drive/callback';
    process.env.GOOGLE_DRIVE_SCOPES = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.metadata.readonly';
    process.env.FRONTEND_URL = 'http://localhost:3000';
    process.env.JWT_SECRET = 'test-jwt-secret';
    originalFetch = global.fetch;

    admin = await createAdminUser(`admin_drive_${Date.now()}@test.com`, 'admin123');
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: admin.email, password: 'admin123' });
    adminToken = loginRes.body.token;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    global.fetch = originalFetch;
  });

  it('should return the current status for an admin', async () => {
    const res = await request(app)
      .get('/api/integrations/google-drive/status')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      connected: false,
      email: null,
    });
  });

  it('should start Google OAuth for an admin', async () => {
    const state = 'test-google-drive-state';
    jest.spyOn(jwt, 'sign').mockReturnValue(state);

    const res = await request(app)
      .get('/api/auth/google-drive')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain('accounts.google.com/o/oauth2/v2/auth');
    expect(res.headers.location).toContain(`client_id=${encodeURIComponent(process.env.GOOGLE_CLIENT_ID)}`);
  });

  it('should parse quoted scopes into separate OAuth scopes', () => {
    process.env.GOOGLE_DRIVE_SCOPES = '"https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.metadata.readonly"';

    expect(getScopes()).toEqual([
      'https://www.googleapis.com/auth/drive.file',
      'https://www.googleapis.com/auth/drive.metadata.readonly',
    ]);
  });

  it('should complete the OAuth callback and persist the connection', async () => {
    const startRes = await request(app)
      .get('/api/auth/google-drive')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(startRes.statusCode).toBe(302);
    const authUrl = new URL(startRes.headers.location);
    const state = authUrl.searchParams.get('state');
    expect(state).toBeTruthy();

    const payloadPart = state.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const decodedPayload = JSON.parse(Buffer.from(payloadPart, 'base64').toString('utf8'));

    jest.spyOn(jwt, 'verify').mockReturnValue(decodedPayload);

    global.fetch = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          expires_in: 3600,
          scope: process.env.GOOGLE_DRIVE_SCOPES,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          user: {
            emailAddress: admin.email,
            displayName: admin.name,
          },
        }),
      });

    const callbackRes = await request(app)
      .get('/api/auth/google-drive/callback')
      .query({ code: 'auth-code', state });

    expect(callbackRes.statusCode).toBe(302);
    expect(callbackRes.headers.location).toContain('googleDrive=connected');

    const connection = await GoogleDriveConnection.findOne({ user: admin._id });
    expect(connection).not.toBeNull();
    expect(connection.email).toBe(admin.email);
  });

  it('should disconnect a stored Google Drive connection', async () => {
    await GoogleDriveConnection.deleteMany({ user: admin._id });
    await GoogleDriveConnection.create({
      user: admin._id,
      email: 'admin@example.com',
      accessTokenEncrypted: 'access-token',
      refreshTokenEncrypted: 'refresh-token',
    });

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    const res = await request(app)
      .post('/api/integrations/google-drive/disconnect')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      success: true,
      connected: false,
    });

    const connection = await GoogleDriveConnection.findOne({ user: admin._id });
    expect(connection).toBeNull();
  });
});
