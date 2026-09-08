const nodemailer = require('nodemailer');
const { formatCurrency, getLineTotal } = require('./invoiceService');

let cachedTransporter = null;

const getTransporter = () => {
  if (cachedTransporter) return cachedTransporter;

  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    return null;
  }

  const secure = process.env.SMTP_SECURE === 'true' || port === 465;

  cachedTransporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });

  return cachedTransporter;
};

const isMailerConfigured = () => {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
};

const escapeHtml = (str) => {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

const getFromAddress = () => {
  const fromName = process.env.MAIL_FROM_NAME || process.env.MAIL_FROM || 'Jewellery Shop';
  const fromEmail = process.env.MAIL_FROM || process.env.SMTP_USER;
  if (!fromEmail) return undefined;
  return `"${fromName}" <${fromEmail}>`;
};

const buildInquiryEmail = ({ name, email, message, storeName }) => {
  const safeName = escapeHtml(name);
  const safeEmail = escapeHtml(email);
  const safeMessage = escapeHtml(message).replace(/\n/g, '<br/>');
  const safeStore = escapeHtml(storeName || 'Store');

  const subject = `New enquiry from ${name} via ${safeStore} website`;

  const html = `
    <div style="font-family: Arial, Helvetica, sans-serif; max-width: 600px; margin: 0 auto; color: #1f2937;">
      <h2 style="color: #013220; margin-bottom: 16px;">New Contact Enquiry</h2>
      <p>You have received a new enquiry from the <strong>${safeStore}</strong> website contact form.</p>
      <table cellpadding="8" cellspacing="0" border="0" style="border-collapse: collapse; margin-top: 12px;">
        <tr>
          <td style="background:#f3f4f6; font-weight:bold; width:120px;">Name</td>
          <td>${safeName}</td>
        </tr>
        <tr>
          <td style="background:#f3f4f6; font-weight:bold;">Email</td>
          <td><a href="mailto:${safeEmail}">${safeEmail}</a></td>
        </tr>
      </table>
      <h3 style="margin-top: 20px; color:#013220;">Message</h3>
      <div style="white-space: normal; padding: 12px; background: #f9fafb; border-left: 4px solid #013220; border-radius: 4px;">
        ${safeMessage}
      </div>
      <p style="margin-top: 24px; font-size: 12px; color: #6b7280;">
        Reply directly to this email to respond to the customer.
      </p>
    </div>
  `;

  const text = `New Contact Enquiry (${safeStore})\n\nName: ${name}\nEmail: ${email}\n\nMessage:\n${message}`;

  return { subject, html, text };
};

const buildOrderConfirmationEmail = (order) => {
  const plain = typeof order?.toObject === 'function' ? order.toObject() : { ...order };
  const items = (plain.items || []).map((item) => {
    const product = typeof item.product === 'object' && item.product ? item.product : {};
    const qty = Number(item.quantity) || 0;
    const price = Number(item.price) || 0;
    return {
      name: item.name || product.name || 'Product',
      sku: item.sku || product.sku || '',
      quantity: qty,
      unitPrice: price,
      lineTotal: getLineTotal(item),
    };
  });

  const storeName = process.env.STORE_NAME || 'Jewellery Shop';
  const customerName = plain.user?.name || plain.shippingAddress?.fullName || 'Customer';
  const orderNumber = plain.orderNumber || plain._id;
  const orderDate = plain.createdAt ? new Date(plain.createdAt).toLocaleDateString('en-IN') : '';
  const totalAmount = formatCurrency(plain.totalPrice, process.env.STORE_CURRENCY || 'INR');
  const paymentStatus = plain.paymentStatus || 'pending';
  const orderStatus = plain.status || 'new';

  const itemsHtml = items.map((item) => `
    <tr>
      <td style="padding: 6px 8px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(item.name)}</td>
      <td style="padding: 6px 8px; border-bottom: 1px solid #e5e7eb; text-align: center;">${item.quantity}</td>
      <td style="padding: 6px 8px; border-bottom: 1px solid #e5e7eb; text-align: right;">${formatCurrency(item.unitPrice, process.env.STORE_CURRENCY || 'INR')}</td>
      <td style="padding: 6px 8px; border-bottom: 1px solid #e5e7eb; text-align: right;">${formatCurrency(item.lineTotal, process.env.STORE_CURRENCY || 'INR')}</td>
    </tr>
  `).join('');

  const subject = `Order Confirmation #${orderNumber} - ${storeName}`;

  const html = `
    <div style="font-family: Arial, Helvetica, sans-serif; max-width: 600px; margin: 0 auto; color: #1f2937;">
      <h2 style="color: #013220; margin-bottom: 16px;">Thank you for your order!</h2>
      <p>Hi ${escapeHtml(customerName)},</p>
      <p>Your order <strong>#${escapeHtml(String(orderNumber))}</strong> has been placed successfully.</p>

      <table style="width: 100%; border-collapse: collapse; margin-top: 16px; margin-bottom: 16px;">
        <thead>
          <tr style="background: #f3f4f6;">
            <th style="padding: 8px; text-align: left; font-size: 12px;">Product</th>
            <th style="padding: 8px; text-align: center; font-size: 12px;">Qty</th>
            <th style="padding: 8px; text-align: right; font-size: 12px;">Price</th>
            <th style="padding: 8px; text-align: right; font-size: 12px;">Total</th>
          </tr>
        </thead>
        <tbody>
          ${itemsHtml}
        </tbody>
      </table>

      <table style="width: 100%; margin-top: 16px; font-size: 14px;">
        <tr>
          <td style="padding: 4px 0;">Order Number</td>
          <td style="text-align: right;">${escapeHtml(String(orderNumber))}</td>
        </tr>
        <tr>
          <td style="padding: 4px 0;">Order Date</td>
          <td style="text-align: right;">${orderDate}</td>
        </tr>
        <tr>
          <td style="padding: 4px 0;">Payment Method</td>
          <td style="text-align: right;">${escapeHtml(plain.paymentMethod || 'cod')}</td>
        </tr>
        <tr>
          <td style="padding: 4px 0;">Payment Status</td>
          <td style="text-align: right;">${escapeHtml(paymentStatus)}</td>
        </tr>
        <tr>
          <td style="padding: 4px 0;">Order Status</td>
          <td style="text-align: right;">${escapeHtml(orderStatus)}</td>
        </tr>
        <tr style="border-top: 2px solid #e5e7eb;">
          <td style="padding: 8px 0; font-weight: bold;">Total Amount</td>
          <td style="text-align: right; font-weight: bold;">${totalAmount}</td>
        </tr>
      </table>

      ${plain.trackingNumber ? `<p style="margin-top: 16px;"><strong>Tracking Number:</strong> ${escapeHtml(plain.trackingNumber)}</p>` : ''}

      ${plain.isPaid
        ? ''
        : `<p style="margin-top: 16px; color: #ca8a04;">Your payment is being processed. We will update you once confirmed.</p>`
      }

      <p style="margin-top: 20px; font-size: 12px; color: #6b7280;">
        You can download your invoice from your account order page.
      </p>
    </div>
  `;

  const text = `Thank you for your order!\n\nOrder #: ${orderNumber}\nOrder Date: ${orderDate}\nPayment Method: ${plain.paymentMethod || 'cod'}\nPayment Status: ${paymentStatus}\nOrder Status: ${orderStatus}\nTotal: ${totalAmount}\n\nItems:\n${items.map((i) => `  - ${i.name} (${i.quantity}x) = ${formatCurrency(i.lineTotal, process.env.STORE_CURRENCY || 'INR')}`).join('\n')}`;

  return { subject, html, text };
};

const buildStatusNotificationEmail = (order, newStatus) => {
  const plain = typeof order?.toObject === 'function' ? order.toObject() : { ...order };
  const storeName = process.env.STORE_NAME || 'Jewellery Shop';
  const customerName = plain.user?.name || plain.shippingAddress?.fullName || 'Customer';
  const orderNumber = plain.orderNumber || plain._id;
  const statusDisplay = Order.getStatusDisplayName(newStatus);
  const trackingInfo = plain.trackingNumber
    ? `<p style="margin-top: 12px;"><strong>Tracking Number:</strong> ${escapeHtml(plain.trackingNumber)}</p>`
    : '';

  const subject = `Order Update: ${statusDisplay} - Order #${orderNumber}`;

  const html = `
    <div style="font-family: Arial, Helvetica, sans-serif; max-width: 600px; margin: 0 auto; color: #1f2937;">
      <h2 style="color: #013220; margin-bottom: 16px;">Order Status Update</h2>
      <p>Hi ${escapeHtml(customerName)},</p>
      <p>Your order <strong>#${escapeHtml(String(orderNumber))}</strong> status has been updated.</p>
      <div style="background: #f3f4f6; padding: 16px; border-radius: 8px; margin: 16px 0;">
        <strong>New Status:</strong> ${escapeHtml(statusDisplay)}
      </div>
      ${trackingInfo}
      <p style="margin-top: 16px; font-size: 12px; color: #6b7280;">
        You can track your order and download your invoice from your account order page.
      </p>
    </div>
  `;

  const text = `Order Status Update\n\nOrder #: ${orderNumber}\nNew Status: ${statusDisplay}\n\n${plain.trackingNumber ? `Tracking: ${plain.trackingNumber}` : ''}`;

  return { subject, html, text };
};

const sendInquiryEmail = async ({ to, fromName, fromEmail, name, email, message, storeName }) => {
  if (!to) {
    return { delivered: false, error: 'No recipient address configured' };
  }

  const transporter = getTransporter();
  const { subject, html, text } = buildInquiryEmail({ name, email, message, storeName });

  const fromAddress = process.env.MAIL_FROM || (process.env.SMTP_USER ? `"${fromName || storeName || 'Website'}" <${process.env.SMTP_USER}>` : undefined);

  if (!transporter || !fromAddress) {
    console.warn('[mailer] SMTP not configured. Inquiry payload:', { to, subject, from: fromEmail, name, message });
    return { delivered: false, error: 'SMTP not configured' };
  }

  try {
    await transporter.sendMail({
      from: fromAddress,
      to,
      replyTo: email,
      subject,
      text,
      html,
    });
    return { delivered: true };
  } catch (err) {
    console.error('[mailer] Inquiry email failed:', err.message);
    return { delivered: false, error: err.message };
  }
};

const Order = require('../models/Order');

const sendOrderConfirmationEmail = async (order) => {
  try {
    const plain = typeof order?.toObject === 'function' ? order.toObject() : order;
    const to = plain.user?.email || plain.shippingAddress?.email || plain.customerEmail;
    if (!to) {
      return { delivered: false, error: 'No recipient email on order' };
    }
    const transporter = getTransporter();
    const fromAddress = getFromAddress();
    if (!transporter || !fromAddress) {
      console.warn('[mailer] SMTP not configured. Order confirmation payload:', { orderNumber: plain.orderNumber, to });
      return { delivered: false, error: 'SMTP not configured' };
    }
    const { subject, html, text } = buildOrderConfirmationEmail(order);
    await transporter.sendMail({ from: fromAddress, to, subject, text, html });
    return { delivered: true };
  } catch (err) {
    console.error('[mailer] Order confirmation email failed:', err.message);
    return { delivered: false, error: err.message };
  }
};

const sendOrderStatusNotificationEmail = async (order, newStatus) => {
  try {
    const plain = typeof order?.toObject === 'function' ? order.toObject() : order;
    const to = plain.user?.email || plain.shippingAddress?.email || plain.customerEmail;
    if (!to) {
      return { delivered: false, error: 'No recipient email on order' };
    }
    const transporter = getTransporter();
    const fromAddress = getFromAddress();
    if (!transporter || !fromAddress) {
      console.warn('[mailer] SMTP not configured. Status notification payload:', { orderNumber: plain.orderNumber, to, newStatus });
      return { delivered: false, error: 'SMTP not configured' };
    }
    const { subject, html, text } = buildStatusNotificationEmail(order, newStatus);
    await transporter.sendMail({ from: fromAddress, to, subject, text, html });
    return { delivered: true };
  } catch (err) {
    console.error('[mailer] Status notification email failed:', err.message);
    return { delivered: false, error: err.message };
  }
};

module.exports = {
  sendInquiryEmail,
  sendOrderConfirmationEmail,
  sendOrderStatusNotificationEmail,
  isMailerConfigured,
  buildOrderConfirmationEmail,
  buildStatusNotificationEmail,
};
