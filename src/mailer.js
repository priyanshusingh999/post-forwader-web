const nodemailer = require('nodemailer');

function isMailerConfigured() {
  return Boolean(
    process.env.SMTP_HOST
    && process.env.SMTP_PORT
    && process.env.SMTP_USER
    && process.env.SMTP_PASS
    && (process.env.SMTP_FROM || process.env.SMTP_USER),
  );
}

function getTransport() {
  if (!isMailerConfigured()) {
    const error = new Error('SMTP is not configured');
    error.code = 'SMTP_NOT_CONFIGURED';
    throw error;
  }

  const port = Number(process.env.SMTP_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    const error = new Error('SMTP_PORT must be a valid port number');
    error.code = 'SMTP_INVALID_CONFIG';
    throw error;
  }

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: process.env.SMTP_SECURE === 'true' || port === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

function accountUrl(path, token) {
  const baseUrl = process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`;
  let url;
  try {
    url = new URL(path, baseUrl);
  } catch {
    const error = new Error('APP_URL must be an absolute HTTP or HTTPS URL');
    error.code = 'SMTP_INVALID_CONFIG';
    throw error;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    const error = new Error('APP_URL must use HTTP or HTTPS');
    error.code = 'SMTP_INVALID_CONFIG';
    throw error;
  }
  url.searchParams.set('token', token);
  return url.toString();
}

async function sendAccountEmail({ to, subject, text }) {
  const transport = getTransport();
  await transport.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject,
    text,
  });
}

async function sendVerificationEmail(to, token) {
  const link = accountUrl('/verify-email.html', token);
  await sendAccountEmail({
    to,
    subject: 'Verify your Post Forwarder account',
    text: [
      'Welcome to Post Forwarder.',
      '',
      `Verify your email address using this link: ${link}`,
      '',
      'This link expires in 24 hours. If you did not create this account, you can ignore this email.',
    ].join('\n'),
  });
}

async function sendPasswordResetEmail(to, token) {
  const link = accountUrl('/reset-password.html', token);
  await sendAccountEmail({
    to,
    subject: 'Reset your Post Forwarder password',
    text: [
      'We received a request to reset your Post Forwarder password.',
      '',
      `Choose a new password using this link: ${link}`,
      '',
      'This link expires in 1 hour. If you did not request a reset, you can ignore this email.',
    ].join('\n'),
  });
}

module.exports = {
  isMailerConfigured,
  sendVerificationEmail,
  sendPasswordResetEmail,
};
