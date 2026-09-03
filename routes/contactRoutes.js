const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const asyncHandler = require('express-async-handler');
const StoreSetting = require('../models/StoreSetting');
const ContactEnquiry = require('../models/ContactEnquiry');
const { sendInquiryEmail, isMailerConfigured } = require('../services/mailer');

const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, message: 'Too many enquiries submitted, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

const submitContactEnquiry = [
  contactLimiter,
  asyncHandler(async (req, res) => {
    const { name, email, message, phone } = req.body || {};

    if (!name || !String(name).trim()) {
      return res.status(400).json({ success: false, message: 'Name is required' });
    }
    if (!email || !String(email).trim()) {
      return res.status(400).json({ success: false, message: 'Email is required' });
    }
    const normalizedEmail = String(email).trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
      return res.status(400).json({ success: false, message: 'Please provide a valid email' });
    }
    if (!message || !String(message).trim()) {
      return res.status(400).json({ success: false, message: 'Message is required' });
    }

    const settings = await StoreSetting.getSettings();
    const recipient = (settings.email || '').trim().toLowerCase();

    if (!recipient || !/^\S+@\S+\.\S+$/.test(recipient)) {
      console.error('[contact] Store contact email is not configured in admin settings');
      return res.status(503).json({
        success: false,
        message: 'Store contact email is not configured. Please update it in Admin Settings.',
      });
    }

    const normalizedPhone = phone ? String(phone).trim().slice(0, 30) : '';

    const enquiry = await ContactEnquiry.create({
      name: String(name).trim().slice(0, 120),
      email: normalizedEmail,
      phone: normalizedPhone,
      message: String(message).trim().slice(0, 5000),
      routedTo: recipient,
    });

    const result = await sendInquiryEmail({
      to: recipient,
      fromName: settings.storeName,
      fromEmail: normalizedEmail,
      name: enquiry.name,
      email: enquiry.email,
      phone: enquiry.phone,
      message: enquiry.message,
      storeName: settings.storeName,
    });

    enquiry.delivered = result.delivered;
    enquiry.deliveryError = result.error || '';
    await enquiry.save();

    if (!result.delivered) {
      console.error(`[contact] Failed to send inquiry email to ${recipient}: ${result.error}`);
      return res.status(202).json({
        success: true,
        message: 'Enquiry received. Email delivery is currently unavailable; the team will follow up manually.',
        delivered: false,
        error: result.error,
      });
    }

    res.status(200).json({
      success: true,
      message: 'Enquiry sent successfully',
      delivered: true,
    });
  }),
];

const getContactStatus = asyncHandler(async (req, res) => {
  res.status(200).json({
    success: true,
    data: {
      mailerConfigured: isMailerConfigured(),
    },
  });
});

router.post('/', submitContactEnquiry);
router.get('/status', getContactStatus);

module.exports = router;
