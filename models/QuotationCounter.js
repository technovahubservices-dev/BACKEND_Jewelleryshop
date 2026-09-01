const mongoose = require('mongoose');

const counterSchema = mongoose.Schema({
  _id: { type: String, required: true },
  year: { type: Number, required: true },
  sequence: { type: Number, default: 0 },
});

module.exports = mongoose.model('QuotationCounter', counterSchema);
