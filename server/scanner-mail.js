import nodemailer from 'nodemailer';
import { HttpError } from './domain.js';

export function scannerEmailAvailable(config) {
  return (
    config.deliveryDriver === 'live' &&
    !!process.env.SMTP_HOST &&
    !!process.env.SMTP_FROM &&
    (!process.env.SMTP_USER || !!process.env.SMTP_PASSWORD)
  );
}

export async function sendScannerInvitation(config, invitation, recipient, eventName) {
  if (!scannerEmailAvailable(config))
    throw new HttpError(
      503,
      'Email invitations are not configured. Share the invitation link instead.',
    );
  const smtp = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
      : undefined,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 15000,
  });
  try {
    const result = await smtp.sendMail({
      from: process.env.SMTP_FROM,
      to: recipient,
      subject: 'Your Golden Creations gate invitation',
      text: `You have been invited to scan tickets for ${eventName}.\n\nAccept your invitation:\n${invitation.url}\n\nThis invitation expires in 7 days. If you already have an account, sign in with this email address.`,
    });
    if (!result.accepted?.length) throw new Error('Recipient not accepted');
  } finally {
    smtp.close();
  }
}
