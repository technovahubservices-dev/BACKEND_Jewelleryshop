const asyncHandler = require('express-async-handler');
const ContactEnquiry = require('../models/ContactEnquiry');
const { isMailerConfigured, sendContactReplyEmail } = require('../services/mailer');

const CONTACT_STATUSES = [
  { value: 'new', label: 'New' },
  { value: 'read', label: 'Read' },
  { value: 'replied', label: 'Replied' },
  { value: 'archived', label: 'Archived' },
];

exports.CONTACT_STATUSES = CONTACT_STATUSES;
exports.CONTACT_STATUS_VALUES = CONTACT_STATUSES.map((s) => s.value);

const serializeEnquiry = (doc) => {
  if (!doc) return null;
  const plain = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  return {
    _id: plain._id,
    name: plain.name,
    email: plain.email,
    phone: plain.phone || '',
    message: plain.message,
    routedTo: plain.routedTo || '',
    delivered: plain.delivered || false,
    deliveryError: plain.deliveryError || '',
    status: plain.status || 'new',
    isRead: plain.isRead || false,
    adminNote: plain.adminNote || '',
    createdAt: plain.createdAt,
    updatedAt: plain.updatedAt,
  };
};

exports.getContactEnquiries = asyncHandler(async (req, res) => {
  const {
    search,
    status,
    startDate,
    endDate,
    page = 1,
    limit = 20,
    sortBy = '-createdAt',
  } = req.query;

  const query = {};

  if (search) {
    query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
      { phone: { $regex: search, $options: 'i' } },
      { message: { $regex: search, $options: 'i' } },
    ];
  }

  if (status) {
    query.status = status;
  }

  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) {
      query.createdAt.$gte = new Date(startDate);
    }
    if (endDate) {
      query.createdAt.$lte = new Date(endDate);
    }
  }

  const validSortFields = ['-createdAt', 'createdAt', '-updatedAt', 'updatedAt', 'name'];
  const sortOption = validSortFields.includes(sortBy) ? sortBy : '-createdAt';

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const skip = (pageNum - 1) * limitNum;

  const [enquiries, total] = await Promise.all([
    ContactEnquiry.find(query).sort(sortOption).skip(skip).limit(limitNum),
    ContactEnquiry.countDocuments(query),
  ]);

  const pages = Math.ceil(total / limitNum);

  const stats = await ContactEnquiry.aggregate([
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);

  const statusCounts = {};
  CONTACT_STATUSES.forEach((s) => {
    statusCounts[s.value] = 0;
  });
  stats.forEach((s) => {
    statusCounts[s._id] = s.count;
  });

  res.status(200).json({
    success: true,
    count: enquiries.length,
    total,
    page: pageNum,
    pages,
    hasMore: pageNum < pages,
    stats: statusCounts,
    data: enquiries.map(serializeEnquiry),
  });
});

exports.getContactEnquiry = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!id || !id.match(/^[0-9a-fA-F]{24}$/)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid enquiry ID',
    });
  }

  const enquiry = await ContactEnquiry.findById(id);

  if (!enquiry) {
    return res.status(404).json({
      success: false,
      message: 'Enquiry not found',
    });
  }

  res.status(200).json({
    success: true,
    data: serializeEnquiry(enquiry),
  });
});

exports.updateContactStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status, isRead, adminNote } = req.body;

  const ALLOWED_STATUSES = CONTACT_STATUSES.map((s) => s.value);

  if (!id || !id.match(/^[0-9a-fA-F]{24}$/)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid enquiry ID',
    });
  }

  const enquiry = await ContactEnquiry.findById(id);

  if (!enquiry) {
    return res.status(404).json({
      success: false,
      message: 'Enquiry not found',
    });
  }

  if (status !== undefined) {
    if (!ALLOWED_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Valid values: ${ALLOWED_STATUSES.join(', ')}`,
      });
    }
    enquiry.status = status;
  }

  if (isRead !== undefined) {
    enquiry.isRead = isRead;
  }

  if (adminNote !== undefined) {
    enquiry.adminNote = String(adminNote).trim();
  }

  await enquiry.save();

  res.status(200).json({
    success: true,
    message: 'Enquiry status updated successfully',
    data: serializeEnquiry(enquiry),
  });
});

exports.replyToEnquiry = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { replyMessage, subject } = req.body;

  if (!id || !id.match(/^[0-9a-fA-F]{24}$/)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid enquiry ID',
    });
  }

  if (!replyMessage || !replyMessage.trim()) {
    return res.status(400).json({
      success: false,
      message: 'Reply message is required',
    });
  }

  const enquiry = await ContactEnquiry.findById(id);

  if (!enquiry) {
    return res.status(404).json({
      success: false,
      message: 'Enquiry not found',
    });
  }

  if (!enquiry.email) {
    return res.status(400).json({
      success: false,
      message: 'Enquiry has no email address',
    });
  }

  if (!isMailerConfigured()) {
    return res.status(503).json({
      success: false,
      message: 'Email service is not configured. Cannot send reply.',
    });
  }

  const result = await sendContactReplyEmail({
    to: enquiry.email,
    fromName: enquiry.name,
    subject: subject || 'Re: Your enquiry',
    message: replyMessage,
    storeName: process.env.STORE_NAME || 'Jewellery Shop',
  });

  if (!result.delivered) {
    return res.status(200).json({
      success: true,
      message: 'Reply could not be sent: ' + (result.error || 'Unknown error'),
      delivered: false,
      data: serializeEnquiry(enquiry),
    });
  }

  enquiry.status = 'replied';
  enquiry.isRead = true;
  await enquiry.save();

  res.status(200).json({
    success: true,
    message: 'Reply sent successfully',
    delivered: true,
    data: serializeEnquiry(enquiry),
  });
});
