const PDFDocument = require('pdfkit');
const StoreSetting = require('../models/StoreSetting');

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

const renderInvoice = (doc, data) => {
  let y = 50;

  doc.fontSize(20).font('Helvetica-Bold')
    .text(data.storeName, 50, y);
  doc.fontSize(10).font('Helvetica')
    .text(data.storeEmail, 50, y + 15)
    .text(data.storePhone, 50, y + 28);

  doc.fontSize(14).font('Helvetica-Bold')
    .text('INVOICE', 400, y, { align: 'right' });
  doc.fontSize(10).font('Helvetica')
    .text(`Invoice #: ${data.invoiceNumber}`, 400, y + 18, { align: 'right' })
    .text(`Order #: ${data.orderNumber}`, 400, y + 30, { align: 'right' })
    .text(`Invoice Date: ${new Date(data.invoiceDate).toLocaleDateString('en-IN')}`, 400, y + 42, { align: 'right' })
    .text(`Order Date: ${new Date(data.orderDate).toLocaleDateString('en-IN')}`, 400, y + 54, { align: 'right' });

  y += 85;

  doc.fontSize(11).font('Helvetica-Bold').text('Bill To:', 50, y);
  doc.fontSize(10).font('Helvetica')
    .text(data.customerName, 50, y + 14)
    .text(data.billingAddress, 50, y + 26)
    .text(`Phone: ${data.phone}`, 50, y + 50)
    .text(`Email: ${data.customerEmail || 'N/A'}`, 50, y + 62);

  y += 95;

  if (data.shippingAddress !== data.billingAddress) {
    doc.fontSize(11).font('Helvetica-Bold').text('Ship To:', 50, y);
    doc.fontSize(10).font('Helvetica')
      .text(data.customerName, 50, y + 14)
      .text(data.shippingAddress, 50, y + 26)
      .text(`Phone: ${data.phone}`, 50, y + 50);
    y += 80;
  }

  y += 20;

  const tableTop = y;

  doc.fontSize(9).font('Helvetica-Bold');
  const headers = ['Product', 'SKU', 'Qty', 'Unit Price', 'Discount', 'GST', 'Total'];
  const colWidths = [180, 60, 30, 60, 50, 50, 60];

  let x = 50;
  headers.forEach((header, i) => {
    doc.text(header, x, tableTop, { width: colWidths[i], align: i > 0 ? 'right' : 'left' });
    x += colWidths[i] + 10;
  });

  y = tableTop + 15;
  doc.fontSize(8).font('Helvetica');

  data.items.forEach((item) => {
    x = 50;
    const row = [
      item.name,
      item.sku || '-',
      String(item.quantity),
      formatCurrency(item.unitPrice, data.currency),
      `${item.discountPercent}%`,
      `${item.gstPercent}%`,
      formatCurrency(getLineTotal(item), data.currency),
    ];

    const maxRows = Math.max(1, Math.ceil(row[0].length / 22));

    row.forEach((cell, i) => {
      doc.text(cell, x, y, { width: colWidths[i], align: i > 0 ? 'right' : 'left' });
      x += colWidths[i] + 10;
    });

    y += 18 * maxRows;
  });

  y += 10;
  doc.moveTo(50, y).lineTo(550, y).stroke();
  y += 15;

  const summaryX = 300;
  doc.fontSize(10).font('Helvetica');

  const addSummaryLine = (label, value) => {
    doc.text(label, summaryX, y, { align: 'right' });
    doc.text(formatCurrency(value, data.currency), summaryX + 130, y, { align: 'right' });
    y += 16;
  };

  addSummaryLine('Subtotal:', data.subtotal);
  addSummaryLine('Discount:', -data.totalDiscount);
  addSummaryLine('GST:', data.totalGst);
  addSummaryLine('Shipping:', data.shippingCharges);

  y += 5;
  doc.moveTo(summaryX, y).lineTo(550, y).stroke();
  y += 10;

  doc.fontSize(12).font('Helvetica-Bold');
  doc.text('Grand Total:', summaryX, y, { align: 'right' });
  doc.text(formatCurrency(data.grandTotal, data.currency), summaryX + 130, y, { align: 'right' });

  y += 25;
  doc.fontSize(10).font('Helvetica');
  doc.text(`Payment Method: ${data.paymentMethod.toUpperCase()}`, 50, y);
  doc.text(`Payment Status: ${data.paymentStatus}`, 50, y + 14);
  doc.text(`Order Status: ${data.orderStatus}`, 50, y + 28);
  if (data.trackingNumber) {
    doc.text(`Tracking No: ${data.trackingNumber}`, 50, y + 42);
  }

  y += 70;
  doc.fontSize(8).font('Helvetica')
    .text('Thank you for your order!', 50, y, { align: 'center' })
    .text('This is a computer-generated invoice.', 50, y + 14, { align: 'center' });

  doc.end();
};

const buildInvoiceData = async (order) => {
  const storeSettings = await StoreSetting.getSettings();

  const plainOrder = typeof order?.toObject === 'function'
    ? order.toObject()
    : { ...order };

  const currency = storeSettings.currency || 'INR';

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
  formatCurrency,
  getLineTotal,
};
