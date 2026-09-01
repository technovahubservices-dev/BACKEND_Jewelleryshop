const Quotation = require('../models/Quotation');
const QuotationCounter = require('../models/QuotationCounter');
const asyncHandler = require('express-async-handler');

const QUOTATION_STATUSES = ['draft', 'sent', 'accepted', 'rejected', 'expired', 'converted'];

const STATUS_TRANSITIONS = {
  draft: ['sent', 'expired'],
  sent: ['accepted', 'rejected', 'expired'],
  accepted: ['converted', 'expired'],
  rejected: ['expired'],
  expired: [],
  converted: [],
};

// Canonical line calculation. Mirrors the React Summary panel so that the
// value the user sees on screen matches the value persisted in MongoDB.
//
// - price: rupee price per unit
// - quantity: integer count
// - discount: percent (0-100). If a value is clearly an absolute rupee amount
//   (e.g. 5000) we still treat it as percent for consistency with the UI.
// - gst: percent
// - Falls back to a jewellery-style metal calculation if price is 0 but
//   metalRate * netWeight > 0 (manual quotation entry).
const computeLineTotal = (item) => {
  const qty = Number(item.quantity) || 0;
  const price = Number(item.price) || 0;
  const discountPercent = Number(item.discount) || 0;
  const gstPercent = Number(item.gst) || 0;
  const metalRate = Number(item.metalRate) || 0;
  const netWeight = Number(item.netWeight) || 0;
  const makingCharges = Number(item.makingCharges) || 0;
  const wastage = Number(item.wastage) || 0;
  const stoneCharges = Number(item.stoneCharges) || 0;

  const basePriceTotal = price > 0
    ? qty * price
    : qty * (metalRate * netWeight) + makingCharges + wastage + stoneCharges;
  const discountAmount = basePriceTotal * (discountPercent / 100);
  const taxableValue = Math.max(0, basePriceTotal - discountAmount);
  const gstAmount = taxableValue * (gstPercent / 100);
  return taxableValue + gstAmount;
};

const computeQuotationTotal = (items) => {
  if (!Array.isArray(items)) return 0;
  return items.reduce((sum, item) => sum + computeLineTotal(item), 0);
};

// Shape an item coming from the API / Excel import so it matches the
// QuotationItemSchema exactly. Unknown fields are dropped, string-vs-number
// types are normalised, and `0` is preserved (we never coerce `0` to a
// default). An optional `product` ObjectId can be passed to link the line
// to a real Product document.
const normalizeQuotationItem = (raw, index = 0) => {
  if (!raw || typeof raw !== 'object') return null;

  const num = (v, fallback = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };

  const productRef = raw.product || raw.productId || null;
  const productId = (productRef && /^[0-9a-fA-F]{24}$/.test(String(productRef)))
    ? String(productRef)
    : null;

  return {
    product: productId,
    name: String(raw.name || `Item ${index + 1}`).trim(),
    sku: String(raw.sku || '').trim(),
    hsn: String(raw.hsn || '').trim(),
    metal: String(raw.metal || '').trim(),
    purity: String(raw.purity || '').trim(),
    grossWeight: String(raw.grossWeight || '').trim(),
    netWeight: String(raw.netWeight || '').trim(),
    stoneWeight: String(raw.stoneWeight || '').trim(),
    stoneType: String(raw.stoneType || '').trim(),
    metalRate: num(raw.metalRate, 0),
    makingCharges: num(raw.makingCharges, 0),
    wastage: num(raw.wastage, 0),
    stoneCharges: num(raw.stoneCharges, 0),
    price: num(raw.price, 0),
    quantity: num(raw.quantity, 1) || 1,
    discount: num(raw.discount, 0),
    gst: num(raw.gst, 18),
  };
};

const generateQuotationNumber = async () => {
  const year = new Date().getFullYear();
  const counter = await QuotationCounter.findOneAndUpdate(
    { _id: `quotation-${year}` },
    { $inc: { sequence: 1 } },
    { new: true, upsert: true }
  );
  return `QT-${year}-${String(counter.sequence).padStart(5, '0')}`;
};

const isStatusTransitionValid = (currentStatus, newStatus) => {
  if (!currentStatus || !newStatus) return true;
  if (currentStatus === newStatus) return true;
  const allowed = STATUS_TRANSITIONS[currentStatus] || [];
  return allowed.includes(newStatus);
};

const checkAndExpireQuotations = async () => {
  const now = new Date();
  const result = await Quotation.updateMany(
    {
      status: { $in: ['draft', 'sent', 'accepted'] },
      validUntil: { $lt: now },
    },
    { $set: { status: 'expired' } }
  );
  return result.modifiedCount;
};

exports.createQuotation = asyncHandler(async (req, res) => {
  const { customer, date, validUntil, items, notes, status, quotationNumber } = req.body;

  if (!customer || !customer.name || !validUntil || !items || items.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'Customer details, valid until date, and at least one item are required',
    });
  }

  if (status && !QUOTATION_STATUSES.includes(status)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid status',
    });
  }

  const qNumber = quotationNumber || await generateQuotationNumber();

  const existing = await Quotation.findOne({ quotationNumber: qNumber });
  if (existing) {
    return res.status(409).json({
      success: false,
      message: 'Quotation number already exists',
    });
  }

  const normalizedItems = items
    .map((item, idx) => normalizeQuotationItem(item, idx))
    .filter(Boolean);

  if (normalizedItems.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'At least one valid item is required',
    });
  }

  const totalAmount = computeQuotationTotal(normalizedItems);

  const quotation = await Quotation.create({
    quotationNumber: qNumber,
    date: date ? new Date(date) : undefined,
    customer: {
      name: String(customer.name || '').trim(),
      phone: String(customer.phone || '').trim(),
      email: String(customer.email || '').trim(),
      address: String(customer.address || '').trim(),
    },
    validUntil,
    items: normalizedItems,
    notes: notes || '',
    totalAmount,
    status: status || 'draft',
    createdBy: req.user ? req.user._id : null,
  });

  // Return the persisted doc with item.product populated so the client can
  // render a fully-resolved preview without a second round-trip.
  const populated = await Quotation.findById(quotation._id).populate(
    'items.product',
    'name sku metal purity weight price images primaryImage'
  );

  res.status(201).json({
    success: true,
    message: 'Quotation created successfully',
    data: populated,
  });
});

exports.getAllQuotations = asyncHandler(async (req, res) => {
  if (!req.user || !req.user.isAdmin) {
    return res.status(403).json({
      success: false,
      message: 'Not authorized to view quotations',
    });
  }

  await checkAndExpireQuotations();

  const { status, search } = req.query;
  let query = {};

  if (status) query.status = status;
  if (search) {
    query.$or = [
      { quotationNumber: { $regex: search, $options: 'i' } },
      { 'customer.name': { $regex: search, $options: 'i' } },
    ];
  }

  const quotations = await Quotation.find(query)
    .sort({ createdAt: -1 })
    .populate('items.product', 'name sku metal purity weight price images primaryImage');

  res.status(200).json({
    success: true,
    count: quotations.length,
    data: quotations,
  });
});

exports.getQuotationById = asyncHandler(async (req, res) => {
  if (!req.user || !req.user.isAdmin) {
    return res.status(403).json({
      success: false,
      message: 'Not authorized to view this quotation',
    });
  }

  if (!req.params.id || !/^[0-9a-fA-F]{24}$/.test(req.params.id)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid quotation id',
    });
  }

  const quotation = await Quotation.findById(req.params.id).populate(
    'items.product',
    'name sku metal purity weight price images primaryImage'
  );

  if (!quotation) {
    return res.status(404).json({
      success: false,
      message: 'Quotation not found',
    });
  }

  if (quotation.status !== 'expired' && new Date(quotation.validUntil) < new Date()) {
    quotation.status = 'expired';
    await quotation.save();
  }

  res.status(200).json({
    success: true,
    data: quotation,
  });
});

exports.updateQuotation = asyncHandler(async (req, res) => {
  const quotation = await Quotation.findById(req.params.id);

  if (!quotation) {
    return res.status(404).json({
      success: false,
      message: 'Quotation not found',
    });
  }

  const { customer, validUntil, items, notes, status } = req.body;

  if (customer) {
    quotation.customer = {
      name: String(customer.name || quotation.customer?.name || '').trim(),
      phone: String(customer.phone || quotation.customer?.phone || '').trim(),
      email: String(customer.email || quotation.customer?.email || '').trim(),
      address: String(customer.address || quotation.customer?.address || '').trim(),
    };
  }
  if (validUntil) quotation.validUntil = validUntil;
  if (notes !== undefined) quotation.notes = notes;

  if (items) {
    const normalizedItems = items
      .map((item, idx) => normalizeQuotationItem(item, idx))
      .filter(Boolean);
    quotation.items = normalizedItems;
    quotation.totalAmount = computeQuotationTotal(normalizedItems);
  }

  if (status) {
    if (!QUOTATION_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status',
      });
    }

    if (!isStatusTransitionValid(quotation.status, status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status transition from "${quotation.status}" to "${status}"`,
      });
    }

    quotation.status = status;
  }

  if (quotation.status !== 'expired' && new Date(quotation.validUntil) < new Date()) {
    quotation.status = 'expired';
  }

  await quotation.save();

  const populated = await Quotation.findById(quotation._id).populate(
    'items.product',
    'name sku metal purity weight price images primaryImage'
  );

  res.status(200).json({
    success: true,
    message: 'Quotation updated successfully',
    data: populated,
  });
});

exports.deleteQuotation = asyncHandler(async (req, res) => {
  const quotation = await Quotation.findById(req.params.id);

  if (!quotation) {
    return res.status(404).json({
      success: false,
      message: 'Quotation not found',
    });
  }

  await quotation.deleteOne();

  res.status(200).json({
    success: true,
    message: 'Quotation deleted successfully',
  });
});

exports.uploadExcel = asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: 'Please upload an Excel file',
    });
  }

  const XLSX = require('xlsx');
  const filePath = req.file.path;
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const rawData = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

  if (!rawData || rawData.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'Excel file is empty or invalid',
    });
  }

  const columnMap = {
    'Product Name': 'name',
    'Product': 'name',
    'Item': 'name',
    'Item Name': 'name',
    'Quantity': 'quantity',
    'Qty': 'quantity',
    'Price': 'price',
    'Rate': 'price',
    'Unit Price': 'price',
    'HSN': 'hsn',
    'HSN Code': 'hsn',
    'SKU': 'sku',
    'Metal': 'metal',
    'Metal Type': 'metal',
    'Purity': 'purity',
    'Gross Weight': 'grossWeight',
    'Net Weight': 'netWeight',
    'Stone Weight': 'stoneWeight',
    'Stone Type': 'stoneType',
    'Metal Rate': 'metalRate',
    'Making Charges': 'makingCharges',
    'Wastage': 'wastage',
    'Stone Charges': 'stoneCharges',
    'Discount': 'discount',
    'Discount %': 'discount',
    'GST': 'gst',
    'GST %': 'gst',
    'GST Percentage': 'gst',
  };

  const normalizeKey = (key) => {
    const trimmed = String(key || '').trim();
    if (columnMap[trimmed]) return columnMap[trimmed];
    const upper = trimmed.toUpperCase();
    if (columnMap[upper]) return columnMap[upper];
    return trimmed.toLowerCase().replace(/\s+/g, '');
  };

  const parseNumeric = (value) => {
    if (value === '' || value === null || value === undefined) return null;
    const cleaned = String(value).replace(/[^0-9.\-]/g, '');
    if (!cleaned) return null;
    const num = parseFloat(cleaned);
    return Number.isFinite(num) ? num : null;
  };

  const mappedItems = rawData
    .map((row, index) => {
      const item = { _row: index + 2 };
      Object.keys(row).forEach((key) => {
        const normalized = normalizeKey(key);
        if (item[normalized] === undefined) {
          item[normalized] = row[key];
        }
      });

      // Normalise types. We use `null` for missing numerics and only fall
      // back to defaults inside normalizeQuotationItem so a real `0` is
      // never silently rewritten to a default value.
      const num = (key) => {
        const v = parseNumeric(item[key]);
        return v === null ? undefined : v;
      };

      return normalizeQuotationItem({
        ...item,
        quantity: num('quantity') ?? 1,
        price: num('price') ?? 0,
        metalRate: num('metalRate') ?? 0,
        makingCharges: num('makingCharges') ?? 0,
        wastage: num('wastage') ?? 0,
        stoneCharges: num('stoneCharges') ?? 0,
        discount: num('discount') ?? 0,
        gst: num('gst') ?? 18,
        name: item.name,
        sku: item.sku,
        hsn: item.hsn,
        metal: item.metal,
        purity: item.purity,
        grossWeight: item.grossWeight,
        netWeight: item.netWeight,
        stoneWeight: item.stoneWeight,
        stoneType: item.stoneType,
      }, index);
    })
    .filter(Boolean);

  if (mappedItems.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'No valid items found in the Excel file',
    });
  }

  // Compute the total up-front so the client preview matches the eventual
  // server-side total exactly (same formula as createQuotation).
  const previewTotal = computeQuotationTotal(mappedItems);

  res.status(200).json({
    success: true,
    message: 'Excel file parsed successfully',
    data: mappedItems,
    totalAmount: previewTotal,
    count: mappedItems.length,
  });
});
