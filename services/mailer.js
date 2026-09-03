const nodemailer = require('nodemailer');

let cachedTransporter = null;

const getTransporter = () => {
  if (cachedTransporter) return cachedTransporter;

  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    console.error('[mailer] SMTP configuration missing. Set SMTP_HOST, SMTP_USER, and SMTP_PASS in .env');
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

const buildInquiryEmail = ({ name, email, phone, message, storeName, submittedAt }) => {
  const safeName = escapeHtml(name);
  const safeEmail = escapeHtml(email);
  const safePhone = escapeHtml(phone || '');
  const safeMessage = escapeHtml(message).replace(/\n/g, '<br/>');
  const safeStore = escapeHtml(storeName || 'Store');
  const safeDate = escapeHtml(submittedAt || new Date().toISOString());

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
        <tr>
          <td style="background:#f3f4f6; font-weight:bold;">Phone</td>
          <td>${safePhone || 'N/A'}</td>
        </tr>
        <tr>
          <td style="background:#f3f4f6; font-weight:bold;">Subject</td>
          <td>${escapeHtml(subject)}</td>
        </tr>
        <tr>
          <td style="background:#f3f4f6; font-weight:bold;">Date</td>
          <td>${safeDate}</td>
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

  const text = `New Contact Enquiry (${safeStore})\n\nDate: ${safeDate}\nName: ${name}\nEmail: ${email}\nPhone: ${safePhone || 'N/A'}\nSubject: ${subject}\n\nMessage:\n${message}`;

  return { subject, html, text };
};

const sendInquiryEmail = async ({ to, fromName, fromEmail, name, email, phone, message, storeName }) => {
  if (!to) {
    console.error('[mailer] No recipient address configured for inquiry email');
    return { delivered: false, error: 'No recipient address configured' };
  }

  const transporter = getTransporter();
  const submittedAt = new Date().toISOString();
  const { subject, html, text } = buildInquiryEmail({ name, email, phone, message, storeName, submittedAt });

  const fromAddress = process.env.MAIL_FROM || (process.env.SMTP_USER ? `"${fromName || storeName || 'Website'}" <${process.env.SMTP_USER}>` : undefined);

  if (!transporter || !fromAddress) {
    console.warn('[mailer] SMTP not configured. Inquiry payload:', { to, subject, from: fromEmail, name, email, phone, message });
    return { delivered: false, error: 'SMTP not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS in .env' };
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
    console.error('[mailer] Inquiry email failed to send:', err.message);
    if (err.code) {
      console.error(`[mailer] SMTP error code: ${err.code}`);
    }
    return { delivered: false, error: err.message };
  }
};

module.exports = {
  sendInquiryEmail,
  isMailerConfigured,
};
