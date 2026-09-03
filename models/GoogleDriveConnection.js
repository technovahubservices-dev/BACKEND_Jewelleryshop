const mongoose = require('mongoose');

const googleDriveConnectionSchema = mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    googleAccountId: {
      type: String,
      trim: true,
      default: '',
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: '',
    },
    scope: {
      type: [String],
      default: [],
    },
    accessTokenEncrypted: {
      type: String,
      default: '',
    },
    refreshTokenEncrypted: {
      type: String,
      default: '',
    },
    tokenExpiresAt: {
      type: Date,
    },
    connectedAt: {
      type: Date,
      default: Date.now,
    },
    lastRefreshedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('GoogleDriveConnection', googleDriveConnectionSchema);
