const PDFDocument = require('pdfkit');
const https = require('https');
const http = require('http');
const StoreSetting = require('../models/StoreSetting');
const HomepageSetting = require('../models/HomepageSetting');
const { normalizeGoogleDriveUrl, getGoogleDriveFileId, buildPublicDriveImageUrl } = require('../utils/googleDriveStorage');

const formatCurrency = (amount, currency = 'INR') => {
  const num = Number(amount) || 0;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
};

const getLineTotal = (item) => {
  const qty = Number(item.quantity) || 0;
  const price = Number(item.price) || 0;
  const lineTotal = Number(item.lineTotal);
  if (Number.isFinite(lineTotal)) {
    return lineTotal;
  }
  return price * qty;
};

const computeSubtotal = (items) => {
  return items.reduce((sum, item) => sum + getLineTotal(item), 0);
};

const fetchImageBuffer = (url, timeout = 5000) => {
  return new Promise((resolve) => {
    if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
      return resolve(null);
    }
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        res.resume();
        return resolve(fetchImageBuffer(res.headers.location, timeout));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return resolve(null);
      }
      const data = [];
      res.on('data', (chunk) => data.push(chunk));
      res.on('end', () => resolve(Buffer.concat(data)));
    });
    req.on('error', () => resolve(null));
    req.setTimeout(timeout, () => {
      req.destroy();
      resolve(null);
    });
  });
};

const resolveLogoUrl = (logoUrl) => {
  if (!logoUrl || typeof logoUrl !== 'string') return '';
  const trimmed = logoUrl.trim();
  if (!trimmed) return '';

  if (/^https?:\/\//i.test(trimmed)) {
    const fileId = getGoogleDriveFileId(trimmed);
    if (fileId) {
      return buildPublicDriveImageUrl(fileId);
    }
    return normalizeGoogleDriveUrl(trimmed);
  }

  if (trimmed.startsWith('/')) {
    return trimmed;
  }

  return trimmed;
};

const renderInvoice = (doc, data) => {
  const leftMargin = 50;
  const rightColX = 390;
  let y = 50;

  const logoX = leftMargin;
  const logoY = y;
  const nameX = data.storeLogo ? leftMargin + 75 : leftMargin;

  doc.fontSize(20).font('Helvetica-Bold')
    .text(data.storeName, nameX, y);
  doc.fontSize(10).font('Helvetica')
    .text(data.storeEmail, nameX, y + 16)
    .text(data.storePhone, nameX, y + 30);

  doc.fontSize(14).font('Helvetica-Bold')
    .text('INVOICE', rightColX, y, { align: 'right' });
  doc.fontSize(10).font('Helvetica')
    .text(`Invoice #: ${data.invoiceNumber}`, rightColX, y + 16, { align: 'right' })
    .text(`Order #: ${data.orderNumber}`, rightColX, y + 30, { align: 'right' })
    .text(`Invoice Date: ${new Date(data.invoiceDate).toLocaleDateString('en-IN')}`, rightColX, y + 44, { align: 'right' })
    .text(`Order Date: ${new Date(data.orderDate).toLocaleDateString('en-IN')}`, rightColX, y + 58, { align: 'right' });

  y = 145;

  if (data.logoBuffer) {
    try {
      doc.image(data.logoBuffer, logoX, logoY, { width: 60, height: 40, valign: 'top' });
      y = Math.max(y, logoY + 45);
    } catch (e) {
      y = 145;
    }
  }

  doc.fontSize(11).font('Helvetica-Bold').text('Bill To:', leftMargin, y);
  doc.fontSize(10).font('Helvetica')
    .text(data.customerName, leftMargin, y + 14)
    .text(data.billingAddress, leftMargin, y + 26, { width: 280 });

  let shipY = y + 44;
  doc.fontSize(10).font('Helvetica')
    .text(`Phone: ${data.phone}`, leftMargin, shipY)
    .text(`Email: ${data.customerEmail || 'N/A'}`, leftMargin, shipY + 14);

  y = shipY + 34;

  if (data.shippingAddress && data.shippingAddress !== data.billingAddress) {
    doc.fontSize(11).font('Helvetica-Bold').text('Ship To:', leftMargin, y);
    doc.fontSize(10).font('Helvetica')
      .text(data.customerName, leftMargin, y + 14)
      .text(data.shippingAddress, leftMargin, y + 26, { width: 280 });

    y += 44;
    doc.fontSize(10).font('Helvetica')
      .text(`Phone: ${data.phone}`, leftMargin, y)
      .text(`Email: ${data.customerEmail || 'N/A'}`, leftMargin, y + 14);

    y += 34;
  }

  y += 15;

  const tableTop = y;
  const pageWidth = 595;
  const rightEdge = pageWidth - rightColX;
  const tableWidth = rightEdge - leftMargin;

  doc.fontSize(9).font('Helvetica-Bold');
  const headers = ['Product', 'SKU', 'Qty', 'Unit Price', 'Discount', 'GST', 'Total'];
  const colWidths = [150, 50, 28, 58, 50, 48, 55];
  const colGap = 5;

  let x = leftMargin;
  headers.forEach((header, i) => {
    doc.text(header, x, tableTop, { width: colWidths[i], align: i === 0 ? 'left' : 'right' });
    x += colWidths[i] + colGap;
  });

  y = tableTop + 17;
  doc.fontSize(8).font('Helvetica');

  data.items.forEach((item) => {
    const row = [
      item.name,
      item.sku || '-',
      String(item.quantity),
      formatCurrency(item.unitPrice, data.currency),
      `${item.discountPercent}%`,
      `${item.gstPercent}%`,
      formatCurrency(getLineTotal(item), data.currency),
    ];

    const productNameWidth = colWidths[0];
    const charPerLine = Math.max(1, Math.floor(productNameWidth / 6.5));
    const maxRows = Math.max(1, Math.ceil((row[0].length || 1) / charPerLine));

    let cellX = leftMargin;
    row.forEach((cell, i) => {
      doc.text(cell, cellX, y, { width: colWidths[i], align: i === 0 ? 'left' : 'right' });
      cellX += colWidths[i] + colGap;
    });

    y += 16 * maxRows;
  });

  y += 8;
  doc.moveTo(leftMargin, y).lineTo(leftMargin + tableWidth, y).stroke();
  y += 15;

  const summaryRight = leftMargin + tableWidth;
  const labelX = summaryRight - 100;
  const valueX = summaryRight - 10;
  doc.fontSize(10).font('Helvetica');

  const addSummaryLine = (label, value) => {
    doc.text(label, labelX, y, { align: 'right' });
    doc.text(formatCurrency(value, data.currency), valueX, y, { align: 'right' });
    y += 16;
  };

  addSummaryLine('Subtotal:', data.subtotal);
  addSummaryLine('Discount:', -data.totalDiscount);
  addSummaryLine('GST:', data.totalGst);
  addSummaryLine('Shipping:', data.shippingCharges);

  y += 5;
  doc.moveTo(labelX, y).lineTo(summaryRight, y).stroke();
  y += 10;

  doc.fontSize(12).font('Helvetica-Bold');
  doc.text('Grand Total:', labelX, y, { align: 'right' });
  doc.text(formatCurrency(data.grandTotal, data.currency), valueX, y, { align: 'right' });

  y += 25;
  doc.fontSize(10).font('Helvetica');
  doc.text(`Payment Method: ${data.paymentMethod.toUpperCase()}`, leftMargin, y);
  doc.text(`Payment Status: ${data.paymentStatus}`, leftMargin + 130, y);
  doc.text(`Order Status: ${data.orderStatus}`, leftMargin + 260, y);
  if (data.trackingNumber) {
    doc.text(`Tracking No: ${data.trackingNumber}`, leftMargin + 390, y);
  }

  y += 25;
  doc.fontSize(8).font('Helvetica')
    .text('Thank you for your order!', 0, y, { align: 'center' })
    .text('This is a computer-generated invoice.', 0, y + 14, { align: 'center' });

  doc.end();
};

const buildInvoiceData = async (order) => {
  const [storeSettings, homepageSettings] = await Promise.all([
    StoreSetting.getSettings(),
    HomepageSetting.getSettings(),
  ]);

  const plainOrder = typeof order?.toObject === 'function'
    ? order.toObject()
    : { ...order };

  const currency = storeSettings.currency || 'INR';
  const logoUrl = resolveLogoUrl(homepageSettings.footerLogoUrl);

  let logoBuffer = null;
  if (logoUrl && /^https?:\/\//i.test(logoUrl)) {
    logoBuffer = await fetchImageBuffer(logoUrl);
  }

  const items = (plainOrder.items || []).map((item) => {
    const qty = Number(item.quantity) || 0;
    const price = Number(item.price) || 0;
    const discountPercent = Number(item.discount) || 0;
    const gstPercent = Number(item.gst) || 0;

    const gross = price * qty;
    const discountAmount = gross * (discountPercent / 100);
    const taxableValue = Math.max(0, gross - discountAmount);
    const gstAmount = taxableValue * (gstPercent / 100);
    const lineTotal = Number.isFinite(Number(item.lineTotal))
      ? Number(item.lineTotal)
      : (taxableValue + gstAmount);

    const product = typeof item.product === 'object' && item.product ? item.product : {};

    return {
      name: item.name || product.name || 'Product',
      sku: item.sku || product.sku || '',
      image: item.image || product.primaryImage || '',
      quantity: qty,
      unitPrice: price,
      discountPercent,
      discountAmount,
      taxableValue,
      gstPercent,
      gstAmount,
      lineTotal,
    };
  });

  const subtotal = items.reduce((sum, i) => sum + i.gross, 0);
  const totalDiscount = items.reduce((sum, i) => sum + i.discountAmount, 0);
  const totalGst = items.reduce((sum, i) => sum + i.gstAmount, 0);
  const shippingCharges = Number(plainOrder.shippingPrice) || 0;
  const grandTotal = Number(plainOrder.totalPrice) || 0;

  const billing = plainOrder.billingAddress || plainOrder.shippingAddress || {};
  const shipping = plainOrder.shippingAddress || {};
  const customer = (typeof plainOrder.user === 'object' && plainOrder.user) ? plainOrder.user : {};

  return {
    storeName: storeSettings.storeName || 'Jewellery Shop',
    storeEmail: storeSettings.email || '',
     storePhone: storeSettings.phone || '',
    storeLogo: logoUrl || '',
    logoBuffer,
    currency,
    invoiceNumber: plainOrder.invoiceNumber || '',
    orderNumber: plainOrder.orderNumber || '',
    invoiceDate: plainOrder.updatedAt || plainOrder.createdAt || new Date(),
    orderDate: plainOrder.createdAt || new Date(),
    customerName: billing.fullName || customer.name || '',
    customerEmail: customer.email || '',
    billingAddress: `${billing.address || ''}${billing.landmark ? ', ' + billing.landmark : ''}, ${billing.city || ''}, ${billing.state || ''} ${billing.pincode || ''}`.trim().replace(/^,\s*/, ''),
    shippingAddress: `${shipping.address || ''}${shipping.landmark ? ', ' + shipping.landmark : ''}, ${shipping.city || ''}, ${shipping.state || ''} ${shipping.pincode || ''}`.trim().replace(/^,\s*/, ''),
    phone: shipping.phone || billing.phone || '',
    items,
    subtotal,
    totalDiscount,
    totalGst,
    shippingCharges,
    grandTotal,
    paymentMethod: plainOrder.paymentMethod || 'cod',
    paymentStatus: plainOrder.paymentStatus || 'pending',
    orderStatus: plainOrder.status || 'new',
    trackingNumber: plainOrder.trackingNumber || '',
  };
};

const generateInvoicePDF = async (order) => {
  const data = await buildInvoiceData(order);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    renderInvoice(doc, data);
  });
};

const streamInvoiceToResponse = async (order, res) => {
  const data = await buildInvoiceData(order);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="invoice-${data.invoiceNumber || data.orderNumber || 'order'}.pdf"`
  );
  res.setHeader('Content-Transfer-Encoding', 'binary');

  const doc = new PDFDocument({ margin: 50 });

  doc.on('data', (chunk) => {
    if (!res.write(chunk)) {
      doc.pause();
      res.on('drain', () => doc.resume());
    }
  });
  doc.on('end', () => res.end());
  doc.on('error', (err) => {
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: 'Failed to generate invoice',
      });
    }
  });

  renderInvoice(doc, data);
};

module.exports = {
  generateInvoicePDF,
  streamInvoiceToResponse,
  buildInvoiceData,
  resolveLogoUrl,
  fetchImageBuffer,
  formatCurrency,
  getLineTotal,
};
