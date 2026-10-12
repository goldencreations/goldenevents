import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import sharp from 'sharp';
import QRCode from 'qrcode';
import { renderTicketImage } from './ticket-image.js';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { hashPassword, verifyPassword, publicUser, tokenHash, safeEqual } from './auth.js';
import {
  HttpError,
  cleanEvent,
  saveEvent,
  reserveOrder,
  completeOrder,
  checkIn,
  availableSlug,
  normalizePhone,
} from './domain.js';
import { initiatePayment } from './providers.js';
import { verifyEcofySignature } from './ecofy.js';
import { createHealthMonitor } from './health.js';
import { smsAvailable } from './sms.js';
import {
  requestPhoneCode,
  verifyPhoneCode,
  verifiedPhone,
  maskOtpPhone,
  otpOverview,
} from './otp.js';
import { renderPage } from './metadata.js';
import { transaction } from './db.js';
import { scannerEmailAvailable, sendScannerInvitation } from './scanner-mail.js';
import {
  organizerFinance,
  adminFinance,
  reconcileOrder,
  requestPayoutCode,
  cancelPayout,
  reviewPayout,
  requestPayoutQuote,
  requestPayoutDestinationCode,
  verifyPayoutDestination,
  submitPayout,
  payoutVerificationMode,
} from './finance.js';
import {
  scannerEvents,
  manageGate,
  gateTeam,
  inviteScanner,
  createScanner,
  scannerInvitation,
  acceptScanner,
  revokeScanner,
  cancelScannerInvite,
} from './scanners.js';
import {
  sharingMode,
  bookingTickets,
  createInvite,
  cancelInvite,
  pendingInvite,
  requestClaimCode,
  claimTicket,
  maskedPhone,
} from './sharing.js';

export function createApp(db, config, health = createHealthMonitor(db, config)) {
  const app = express();
  app.disable('x-powered-by');
  if (config.production) app.set('trust proxy', 1);
  app.use(
    helmet({
      contentSecurityPolicy: config.production
        ? {
            directives: {
              'img-src': ["'self'", 'data:', 'https://images.unsplash.com'],
              'script-src': ["'self'"],
              'connect-src': ["'self'"],
              'upgrade-insecure-requests': [],
            },
          }
        : false,
    }),
  );
  app.use('/api/webhooks/ecofy', express.raw({ type: 'application/json', limit: '64kb' }));
  app.use(express.json({ limit: '64kb' }), cookieParser());
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use(
    '/api',
    rateLimit({
      windowMs: 60000,
      limit: config.apiRateLimit,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { error: 'Too many requests. Try again shortly.' },
    }),
  );
  const authLimit = rateLimit({
    windowMs: 900000,
    limit: 30,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many sign-in attempts. Try again later.' },
  });
  const checkoutLimit = rateLimit({
    windowMs: 60000,
    limit: 12,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many payment requests. Try again shortly.' },
  });
  const claimLimit = rateLimit({
    windowMs: 900000,
    limit: 40,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many ticket verification attempts. Try again later.' },
  });
  const otpSendLimit = rateLimit({
    windowMs: 60000,
    limit: 3,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many verification requests. Try again shortly.' },
  });
  const otpVerifyLimit = rateLimit({
    windowMs: 60000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many verification attempts. Try again shortly.' },
  });
  app.use((req, res, next) => {
    const host = req.hostname;
    const allowed =
      host === config.baseDomain ||
      host.endsWith(`.${config.baseDomain}`) ||
      (!config.production && ['localhost', '127.0.0.1', '[::1]'].includes(host));
    if (!allowed) return res.status(400).json({ error: 'Unknown hostname.' });
    if (
      req.path.startsWith('/api/') &&
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      !['/api/webhooks/flutterwave', '/api/webhooks/ecofy'].includes(req.path)
    ) {
      let valid = false;
      try {
        const origin = new URL(req.get('origin'));
        valid = origin.host === req.get('host') && ['http:', 'https:'].includes(origin.protocol);
      } catch {
        /* Missing and malformed origins are rejected. */
      }
      if (!valid)
        return res.status(403).json({ error: 'Request origin does not match this application.' });
    }
    next();
  });
  app.use((req, _res, next) => {
    const raw = req.cookies.ge_session;
    req.user = raw
      ? db
          .prepare(
            `SELECT u.*,EXISTS(SELECT 1 FROM scanner_bootstrap b WHERE b.user_id=u.id) AS must_change_password
            FROM sessions s JOIN users u ON s.user_id=u.id WHERE s.token=? AND s.expires_at>?`,
          )
          .get(tokenHash(raw), Date.now())
      : null;
    next();
  });
  const auth = (req, _res, next) => {
    if (!req.user) throw new HttpError(401, 'Sign in to continue.');
    if (req.user.must_change_password && req.path !== '/api/settings/password')
      throw new HttpError(403, 'Change your temporary password before continuing.');
    next();
  };
  const admin = (req, _res, next) => {
    if (req.user?.role !== 'admin') throw new HttpError(403, 'Administrator access required.');
    next();
  };
  const owned = (eventId, user) => {
    const event = db
      .prepare('SELECT * FROM events WHERE id=? AND owner_id=?')
      .get(eventId, user.id);
    if (!event) throw new HttpError(404, 'Event not found.');
    return event;
  };
  const login = (res, user) => {
    const raw = randomBytes(32).toString('hex');
    db.prepare('DELETE FROM sessions WHERE expires_at<?').run(Date.now());
    db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(
      tokenHash(raw),
      user.id,
      Date.now() + 7 * 86400000,
    );
    res.cookie('ge_session', raw, {
      httpOnly: true,
      secure: config.production,
      sameSite: 'lax',
      maxAge: 7 * 86400000,
      path: '/',
    });
    return res.json({
      user: {
        ...publicUser(user),
        must_change_password: !!db
          .prepare('SELECT 1 FROM scanner_bootstrap WHERE user_id=?')
          .get(user.id),
      },
    });
  };
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/api/ready', (_req, res) => {
    const result = health.readiness();
    res.status(result.status === 'ready' ? 200 : 503).json(result);
  });
  app.get('/api/status', async (_req, res) => res.json(await health.collect()));
  app.get('/api/admin/otp', auth, admin, (_req, res) =>
    res.json({ available: smsAvailable(config), ...otpOverview(db) }),
  );
  app.get('/api/config', (_req, res) =>
    res.json({
      baseDomain: config.baseDomain,
      appOrigin: config.appOrigin,
      publicOrigin: config.publicOrigin,
      paymentDriver: config.paymentDriver,
      deliveryDriver: config.deliveryDriver,
      whatsappDriver: process.env.WHATSAPP_DRIVER || 'twilio',
      ticketSharing: sharingMode(config),
      platformFeeBps: config.platformFeeBps,
      payoutDriver: config.payoutDriver,
      demo: config.seedDemo && !config.production,
    }),
  );
  app.get('/api/auth/me', (req, res) => res.json({ user: req.user ? publicUser(req.user) : null }));
  // Scanner-only accounts cannot reach organizer finance, guest exports, or event edits.
  app.use('/api/organizer', auth, (req, _res, next) => {
    if (!['organizer', 'admin'].includes(req.user.role))
      throw new HttpError(403, 'Scanner access only.');
    next();
  });
  app.get('/api/scanner/events', auth, (req, res) =>
    res.json({ events: scannerEvents(db, req.user) }),
  );
  app.post('/api/scanner/check-in', auth, (req, res) => {
    const input = z
      .object({ event_id: z.string().min(1).max(80), code: z.string().trim().min(1).max(512) })
      .safeParse(req.body);
    if (!input.success) throw new HttpError(400, 'Choose an event and enter a ticket code.');
    const ticket = checkIn(db, req.user, input.data.event_id, input.data.code);
    res.json({ ticket: { ...ticket, phone: maskedPhone(ticket.phone) } });
  });
  app.get('/api/gate/events', auth, (req, res) => {
    if (!['organizer', 'admin'].includes(req.user.role))
      throw new HttpError(403, 'Organizer access required.');
    const rows =
      req.user.role === 'admin'
        ? db.prepare('SELECT id,name,starts_at,status FROM events ORDER BY starts_at DESC').all()
        : db
            .prepare(
              'SELECT id,name,starts_at,status FROM events WHERE owner_id=? ORDER BY starts_at DESC',
            )
            .all(req.user.id);
    res.json({ events: rows, email_available: scannerEmailAvailable(config) });
  });
  app.get('/api/gate/events/:id/team', auth, (req, res) =>
    res.json(gateTeam(db, req.user, req.params.id)),
  );
  app.post('/api/gate/events/:id/scanners', auth, authLimit, (req, res) =>
    res.status(201).json(createScanner(db, config, req.user, req.params.id, req.body)),
  );
  app.post('/api/gate/events/:id/invites', auth, authLimit, async (req, res) => {
    const delivery = req.body.delivery || 'link';
    if (!['link', 'email'].includes(delivery))
      throw new HttpError(400, 'Choose link or email delivery.');
    const event = manageGate(db, req.user, req.params.id);
    if (delivery === 'email' && !scannerEmailAvailable(config))
      throw new HttpError(
        503,
        'Email invitations are not configured. Share the invitation link instead.',
      );
    const invitation = inviteScanner(db, config, req.user, req.params.id, req.body);
    if (delivery === 'email') {
      try {
        await sendScannerInvitation(config, invitation, req.body.email.toLowerCase(), event.name);
        invitation.email_delivery = 'sent';
      } catch {
        invitation.email_delivery = 'failed';
      }
    }
    res.status(201).json(invitation);
  });
  app.delete('/api/gate/events/:id/scanners/:userId', auth, (req, res) => {
    revokeScanner(db, req.user, req.params.id, req.params.userId);
    res.json({ ok: true });
  });
  app.delete('/api/gate/events/:id/invites/:inviteId', auth, (req, res) => {
    cancelScannerInvite(db, req.user, req.params.id, req.params.inviteId);
    res.json({ ok: true });
  });
  app.get('/api/scanner-invites/:token', authLimit, (req, res) => {
    const i = scannerInvitation(db, req.params.token);
    res.json({
      name: i.name,
      email: i.email,
      event_name: i.event_name,
      expires_at: i.expires_at,
      existing_account: !!db.prepare('SELECT id FROM users WHERE email=?').get(i.email),
    });
  });
  app.post('/api/scanner-invites/:token/accept', authLimit, (req, res) =>
    login(res, acceptScanner(db, req.params.token, req.user, req.body)),
  );
  app.post('/api/auth/register', authLimit, (req, res) => {
    const parsed = z
      .object({
        name: z.string().trim().min(2).max(80),
        email: z.email().max(200),
        password: z.string().min(10).max(128),
      })
      .safeParse(req.body);
    if (!parsed.success)
      throw new HttpError(
        400,
        'Enter your name, a valid email, and a password of at least 10 characters.',
      );
    const { name, email, password } = parsed.data;
    if (db.prepare('SELECT id FROM users WHERE email=?').get(email.toLowerCase()))
      throw new HttpError(409, 'An account with that email already exists.');
    const user = {
      id: randomUUID(),
      name,
      email: email.toLowerCase(),
      password: hashPassword(password),
      role: 'organizer',
      phone: '',
      organization: '',
      created_at: new Date().toISOString(),
    };
    db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,?,?)').run(...Object.values(user));
    login(res, user);
  });
  app.post('/api/auth/login', authLimit, (req, res) => {
    const { email, password } = req.body;
    if (typeof email !== 'string' || typeof password !== 'string' || password.length > 128)
      throw new HttpError(400, 'Enter your email and password.');
    const user = db.prepare('SELECT * FROM users WHERE email=?').get(email.toLowerCase());
    // Equalize the password work for missing accounts.
    const hash = user?.password || `${'0'.repeat(32)}:${'0'.repeat(128)}`;
    if (!verifyPassword(password, hash) || !user)
      throw new HttpError(401, 'Email or password is incorrect.');
    login(res, user);
  });
  app.post('/api/auth/demo', authLimit, (_req, res) => {
    if (config.production || !config.seedDemo) throw new HttpError(404, 'Not found.');
    const user = db
      .prepare('SELECT * FROM users WHERE email=?')
      .get(process.env.DEMO_EMAIL || 'demo@goldencreation.events');
    if (!user) throw new HttpError(404, 'Demo account is not available.');
    login(res, user);
  });
  app.post('/api/auth/logout', (req, res) => {
    if (req.cookies.ge_session)
      db.prepare('DELETE FROM sessions WHERE token=?').run(tokenHash(req.cookies.ge_session));
    res.clearCookie('ge_session', { path: '/' }).json({ ok: true });
  });
  app.get('/api/settings/phone', auth, (req, res) => {
    if (!['organizer', 'admin'].includes(req.user.role))
      throw new HttpError(403, 'Organizer access required.');
    const phone = verifiedPhone(db, req.user.id);
    res.json({
      available: smsAvailable(config),
      verified: !!phone,
      phone: phone ? maskOtpPhone(phone) : null,
    });
  });
  app.post('/api/settings/phone/code', auth, otpSendLimit, async (req, res) =>
    res.status(202).json(await requestPhoneCode(db, config, req.user, req.body, req.ip)),
  );
  app.post('/api/settings/phone/:id/resend', auth, otpSendLimit, async (req, res) => {
    const row = db
      .prepare(
        "SELECT phone FROM otp_challenges WHERE id=? AND user_id=? AND purpose='phone_verification'",
      )
      .get(req.params.id, req.user.id);
    if (!row) throw new HttpError(404, 'Verification request not found.');
    res
      .status(202)
      .json(
        await requestPhoneCode(
          db,
          config,
          req.user,
          { phone: row.phone, password: req.body.password },
          req.ip,
        ),
      );
  });
  app.post('/api/settings/phone/:id/verify', auth, otpVerifyLimit, (req, res) => {
    const result = verifyPhoneCode(db, config, req.user, req.params.id, req.body.code);
    res.json({
      ...result,
      user: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id)),
    });
  });
  app.put('/api/settings', auth, (req, res) => {
    const parsed = z
      .object({
        name: z.string().trim().min(2).max(80),
        organization: z.string().trim().max(100),
        phone: z.string().max(30),
      })
      .safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, 'Check your account details.');
    const data = parsed.data,
      phone = data.phone ? normalizePhone(data.phone) : '';
    db.prepare('UPDATE users SET name=?,organization=?,phone=? WHERE id=?').run(
      data.name,
      data.organization,
      phone,
      req.user.id,
    );
    res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id)) });
  });
  app.put('/api/settings/password', auth, authLimit, (req, res) => {
    const { current, newPassword } = req.body;
    if (
      typeof current !== 'string' ||
      typeof newPassword !== 'string' ||
      newPassword.length < 10 ||
      newPassword.length > 128 ||
      (req.user.must_change_password && current === newPassword) ||
      !verifyPassword(current, req.user.password)
    )
      throw new HttpError(
        400,
        'Check your current password and use at least 10 characters for the new one.',
      );
    transaction(db, () => {
      db.prepare('UPDATE users SET password=? WHERE id=?').run(
        hashPassword(newPassword),
        req.user.id,
      );
      db.prepare('DELETE FROM scanner_bootstrap WHERE user_id=?').run(req.user.id);
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(req.user.id);
    });
    res.clearCookie('ge_session', { path: '/' }).json({ ok: true });
  });
  app.get('/api/events', (_req, res) =>
    res.json({
      events: db
        .prepare("SELECT * FROM events WHERE status='published' AND starts_at>? ORDER BY starts_at")
        .all(new Date().toISOString())
        .map((e) => cleanEvent(db, e, config)),
    }),
  );
  app.get('/api/events/:slug', (req, res) => {
    const event = db
      .prepare("SELECT * FROM events WHERE slug=? AND status IN ('published','paused','cancelled')")
      .get(req.params.slug);
    if (!event) throw new HttpError(404, 'This event has not been published.');
    res.json({ event: cleanEvent(db, event, config) });
  });
  app.get('/api/organizer/events', auth, (req, res) =>
    res.json({
      events: db
        .prepare('SELECT * FROM events WHERE owner_id=? ORDER BY created_at DESC')
        .all(req.user.id)
        .map((e) => cleanEvent(db, e, config, true)),
    }),
  );
  app.get('/api/organizer/events/:id', auth, (req, res) =>
    res.json({ event: cleanEvent(db, owned(req.params.id, req.user), config, true) }),
  );
  app.get('/api/organizer/slug', auth, (req, res) =>
    res.json({ slug: availableSlug(db, String(req.query.name || 'event')) }),
  );
  app.post('/api/organizer/events', auth, (req, res) =>
    res
      .status(201)
      .json({ event: cleanEvent(db, saveEvent(db, req.user.id, req.body), config, true) }),
  );
  app.put('/api/organizer/events/:id', auth, (req, res) =>
    res.json({
      event: cleanEvent(db, saveEvent(db, req.user.id, req.body, req.params.id), config, true),
    }),
  );
  const uploadDir = path.join(config.dataDir, 'uploads');
  mkdirSync(uploadDir, { recursive: true });
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  });
  app.post('/api/uploads', auth, upload.single('image'), async (req, res) => {
    if (!req.file) throw new HttpError(400, 'Choose a picture.');
    const filename = `${randomUUID()}.webp`;
    try {
      const image = sharp(req.file.buffer, { limitInputPixels: 40000000 });
      const meta = await image.metadata();
      if (!['jpeg', 'png', 'webp'].includes(meta.format)) throw new Error('Unsupported image');
      await image
        .rotate()
        .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 85 })
        .toFile(path.join(uploadDir, filename));
    } catch {
      throw new HttpError(400, 'Upload a JPG, PNG, or WebP picture under 5 MB.');
    }
    res.status(201).json({ url: `/uploads/${filename}` });
  });
  app.use('/uploads', express.static(uploadDir, { maxAge: '7d', immutable: true }));
  app.post('/api/orders', checkoutLimit, async (req, res) => {
    const { order, created } = reserveOrder(db, req.body, config);
    if (created) {
      try {
        await initiatePayment(db, order, config);
      } catch (error) {
        return res.status(error.status || 502).json({ error: error.message, token: order.token });
      }
    }
    res
      .status(created ? 201 : 200)
      .json({ token: order.token, reference: order.reference, status: order.status });
  });
  app.get('/api/orders/:token', (req, res) => {
    const order = db.prepare('SELECT * FROM orders WHERE token=?').get(req.params.token);
    if (!order) throw new HttpError(404, 'Order not found.');
    if (order.status === 'pending' && order.expires_at < Date.now()) {
      db.prepare("UPDATE orders SET status='expired' WHERE id=?").run(order.id);
      order.status = 'expired';
    }
    const { idempotency_key, provider_id, ...safe } = order;
    const event = db.prepare('SELECT * FROM events WHERE id=?').get(order.event_id);
    res.json({
      order: {
        ...safe,
        payment_uncertain:
          order.provider === 'ecofy' &&
          order.status === 'expired' &&
          !['failed', 'cancelled'].includes(order.provider_status),
      },
      event: cleanEvent(db, event, config),
      tickets: bookingTickets(db, order.id, config),
    });
  });
  app.post('/api/orders/:token/tickets/:id/invite', claimLimit, (req, res) => {
    res.status(201).json(createInvite(db, config, req.params.token, req.params.id, req.body));
  });
  app.delete('/api/orders/:token/tickets/:id/invite', (req, res) => {
    cancelInvite(db, req.params.token, req.params.id);
    res.json({ ok: true });
  });
  app.get('/api/claims/:token', (req, res) => {
    const invite = pendingInvite(db, req.params.token);
    const event = db.prepare('SELECT * FROM events WHERE id=?').get(invite.event_id);
    res.json({
      name: invite.name,
      phone: maskedPhone(invite.phone),
      ticket_type: invite.ticket_type,
      event: cleanEvent(db, event, config),
      expires_at: invite.expires_at,
    });
  });
  app.post(
    '/api/claims/:token/code',
    claimLimit,
    (req, res, next) => (sharingMode(config) === 'nextsms' ? otpSendLimit(req, res, next) : next()),
    async (req, res) => {
      const result = await requestClaimCode(db, config, req.params.token, req.ip);
      res.status(result.verification_mode === 'nextsms' ? 202 : 200).json(result);
    },
  );
  app.post(
    '/api/claims/:token/accept',
    claimLimit,
    (req, res, next) =>
      sharingMode(config) === 'nextsms' ? otpVerifyLimit(req, res, next) : next(),
    (req, res) => {
      res.json(claimTicket(db, config, req.params.token, req.body));
    },
  );
  app.post('/api/orders/:token/demo', (req, res) => {
    if (config.production || config.paymentDriver !== 'demo')
      throw new HttpError(404, 'Not found.');
    const order = db
      .prepare('SELECT * FROM orders WHERE token=? AND provider=?')
      .get(req.params.token, 'demo');
    if (!order) throw new HttpError(404, 'Order not found.');
    if (order.status !== 'pending' || order.expires_at < Date.now())
      throw new HttpError(409, 'This payment is no longer pending.');
    if (req.body.action === 'approve') completeOrder(db, order.id, config);
    else if (req.body.action === 'decline')
      db.prepare("UPDATE orders SET status='failed' WHERE id=?").run(order.id);
    else throw new HttpError(400, 'Choose approve or decline.');
    res.json({ ok: true });
  });
  app.post('/api/webhooks/flutterwave', (req, res) => {
    if (
      config.paymentDriver !== 'flutterwave' ||
      !safeEqual(req.get('verif-hash'), process.env.FLW_SECRET_HASH)
    )
      throw new HttpError(401, 'Invalid webhook signature.');
    if (req.body.event === 'charge.completed') {
      const data = req.body.data;
      if (!data?.id || typeof data.tx_ref !== 'string')
        throw new HttpError(400, 'Invalid webhook.');
      db.prepare(
        'INSERT OR IGNORE INTO webhook_jobs (id,transaction_id,reference) VALUES (?,?,?)',
      ).run(`${req.body.event}:${data.id}:${data.status}`, String(data.id), data.tx_ref);
    }
    res.json({ ok: true });
  });
  app.post('/api/webhooks/ecofy', (req, res) => {
    if (
      config.paymentDriver !== 'ecofy' ||
      !verifyEcofySignature(req.get('ecofy-signature'), req.body, config.ecofyWebhookSecret)
    )
      throw new HttpError(401, 'Invalid webhook signature.');
    let payment;
    try {
      payment = JSON.parse(req.body.toString('utf8'));
    } catch {
      throw new HttpError(400, 'Invalid webhook.');
    }
    // Live Ecofy callbacks wrap the payment in a signed event envelope.
    if (typeof payment?.type === 'string') {
      const eventType = payment.type;
      if (!eventType.startsWith('payment.')) return res.json({ ok: true, ignored: true });
      payment = payment.data;
      if (eventType !== `payment.${payment?.status}`)
        throw new HttpError(400, 'Invalid webhook event.');
    }
    if (
      typeof payment?.id !== 'string' ||
      !/^pay_[A-Za-z0-9]+$/.test(payment.id) ||
      typeof payment.reference !== 'string' ||
      payment.reference.length > 100 ||
      !['created', 'pending', 'processing', 'succeeded', 'failed', 'cancelled'].includes(
        payment.status,
      )
    )
      throw new HttpError(400, 'Invalid webhook.');
    db.prepare(
      'INSERT OR IGNORE INTO webhook_jobs (id,transaction_id,reference,provider) VALUES (?,?,?,?)',
    ).run(`ecofy:${payment.id}:${payment.status}`, payment.id, payment.reference, 'ecofy');
    res.json({ ok: true });
  });
  app.get('/api/tickets/:token/image', async (req, res) => {
    const ticket = db
      .prepare(
        `SELECT t.*,tt.name AS ticket_type FROM tickets t
      JOIN orders o ON o.id=t.order_id JOIN ticket_types tt ON tt.id=o.ticket_type_id
      JOIN events e ON e.id=t.event_id WHERE t.token=? AND o.status='paid' AND e.status!='cancelled'`,
      )
      .get(req.params.token);
    if (!ticket) throw new HttpError(404, 'Valid ticket not found.');
    const event = db.prepare('SELECT * FROM events WHERE id=?').get(ticket.event_id);
    res
      .type('png')
      .set('Content-Disposition', `attachment; filename="${ticket.code}-ticket.png"`)
      .send(await renderTicketImage(event, ticket, config));
  });
  app.get('/api/tickets/:token', async (req, res) => {
    const ticket = db
      .prepare(
        'SELECT t.*,o.status,tt.name AS ticket_type FROM tickets t JOIN orders o ON o.id=t.order_id JOIN ticket_types tt ON tt.id=o.ticket_type_id WHERE t.token=?',
      )
      .get(req.params.token);
    if (!ticket) throw new HttpError(404, 'Ticket not found.');
    const event = db.prepare('SELECT * FROM events WHERE id=?').get(ticket.event_id);
    res.json({
      ticket: {
        code: ticket.code,
        token: ticket.token,
        checked_in_at: ticket.checked_in_at,
        ticket_type: ticket.ticket_type,
        holder_name: ticket.holder_name || '',
        holder_phone: ticket.holder_phone ? maskedPhone(ticket.holder_phone) : '',
        valid: ticket.status === 'paid' && event.status !== 'cancelled',
      },
      event: cleanEvent(db, event, config),
      qr: await QRCode.toDataURL(`${config.publicOrigin}/ticket/${ticket.token}`, {
        width: 360,
        margin: 2,
        errorCorrectionLevel: 'M',
      }),
    });
  });
  app.get('/api/organizer/orders', auth, (req, res) => {
    const rows = db
      .prepare(
        'SELECT o.*,e.name AS event_name,e.slug,tt.name AS ticket_type FROM orders o JOIN events e ON e.id=o.event_id JOIN ticket_types tt ON tt.id=o.ticket_type_id WHERE e.owner_id=? ORDER BY o.created_at DESC',
      )
      .all(req.user.id);
    res.json({ orders: rows.map(({ idempotency_key, provider_id, ...safe }) => safe) });
  });
  app.get('/api/organizer/finance', (req, res) => res.json(organizerFinance(db, config, req.user)));
  app.post('/api/organizer/payouts/quote', authLimit, async (req, res) =>
    res.json({ quote: await requestPayoutQuote(db, config, req.user, req.body) }),
  );
  app.post('/api/organizer/payouts/destination/code', authLimit, otpSendLimit, async (req, res) =>
    res
      .status(202)
      .json(await requestPayoutDestinationCode(db, config, req.user, req.body, req.ip)),
  );
  app.post('/api/organizer/payouts/destination/verify', authLimit, otpVerifyLimit, (req, res) =>
    res.json(verifyPayoutDestination(db, config, req.user, req.body)),
  );
  app.post(
    '/api/organizer/payouts/code',
    authLimit,
    (req, res, next) =>
      payoutVerificationMode(config) === 'nextsms' ? otpSendLimit(req, res, next) : next(),
    async (req, res) => {
      const result = await requestPayoutCode(db, config, req.user, req.body, req.ip);
      res.status(result.mode === 'nextsms' ? 202 : 200).json(result);
    },
  );
  app.post('/api/organizer/payouts/:id/confirm', claimLimit, otpVerifyLimit, async (req, res) =>
    res.json({ payout: await submitPayout(db, config, req.user, req.params.id, req.body) }),
  );
  app.post('/api/organizer/payouts/:id/cancel', (req, res) =>
    res.json({ payout: cancelPayout(db, config, req.user, req.params.id) }),
  );
  app.get('/api/organizer/guests', auth, (req, res) =>
    res.json({
      guests: db
        .prepare(
          "SELECT t.code,t.checked_in_at,t.event_id,COALESCE(u.name,'') AS admitted_by,COALESCE(t.holder_phone,o.phone) AS phone,COALESCE(t.holder_name,'') AS holder_name,CASE WHEN t.claimed_at IS NULL THEN o.email ELSE '' END AS email,o.reference,e.name AS event_name,tt.name AS ticket_type FROM tickets t JOIN orders o ON o.id=t.order_id JOIN events e ON e.id=t.event_id JOIN ticket_types tt ON tt.id=o.ticket_type_id LEFT JOIN users u ON u.id=t.checked_in_by WHERE e.owner_id=? AND o.status=? ORDER BY t.created_at DESC",
        )
        .all(req.user.id, 'paid'),
    }),
  );
  app.post('/api/organizer/check-in', auth, (req, res) =>
    res.json({ ticket: checkIn(db, req.user, req.body.event_id, req.body.code) }),
  );
  app.post('/api/organizer/orders/:id/refund', auth, (req, res) => {
    transaction(db, () => {
      const order = db
        .prepare(
          'SELECT o.* FROM orders o JOIN events e ON e.id=o.event_id WHERE o.id=? AND e.owner_id=?',
        )
        .get(req.params.id, req.user.id);
      if (!order) throw new HttpError(404, 'Order not found.');
      if (order.status !== 'paid') throw new HttpError(409, 'Only paid orders can be refunded.');
      if (order.provider !== 'demo' || config.production)
        throw new HttpError(
          503,
          'Live refunds must be completed with your payment provider. No money has been refunded.',
        );
      if (db.prepare('SELECT 1 FROM order_settlements WHERE order_id=?').get(order.id))
        throw new HttpError(
          409,
          'This sale has been released for payout. An administrator must reconcile any refund first.',
        );
      if (['demo', 'ecofy'].includes(config.payoutDriver)) {
        const finance = organizerFinance(db, config, req.user);
        const credit = finance.orders.find((o) => o.id === order.id);
        if (credit?.released && finance.available < credit.net)
          throw new HttpError(
            409,
            'This sale backs a payout. Resolve the payout before refunding it.',
          );
      }
      if (
        db
          .prepare('SELECT id FROM tickets WHERE order_id=? AND checked_in_at IS NOT NULL')
          .get(order.id)
      )
        throw new HttpError(409, 'An admitted order cannot be refunded.');
      db.prepare("UPDATE orders SET status='refunded' WHERE id=?").run(order.id);
      db.prepare(
        "UPDATE deliveries SET status='cancelled' WHERE order_id=? AND status IN ('queued','outbox','failed')",
      ).run(order.id);
    });
    res.json({ ok: true });
  });
  app.get('/api/organizer/deliveries', auth, (req, res) =>
    res.json({
      deliveries: db
        .prepare(
          'SELECT d.*,o.reference,e.name AS event_name FROM deliveries d JOIN orders o ON o.id=d.order_id JOIN events e ON e.id=o.event_id WHERE e.owner_id=? ORDER BY d.created_at DESC',
        )
        .all(req.user.id),
    }),
  );
  app.post('/api/organizer/deliveries/:id/retry', auth, (req, res) => {
    const delivery = db
      .prepare(
        'SELECT d.*,o.status AS order_status FROM deliveries d JOIN orders o ON o.id=d.order_id JOIN events e ON e.id=o.event_id WHERE d.id=? AND e.owner_id=?',
      )
      .get(req.params.id, req.user.id);
    if (!delivery) throw new HttpError(404, 'Message not found.');
    if (delivery.order_status !== 'paid')
      throw new HttpError(409, 'This order no longer has valid tickets.');
    db.prepare(
      "UPDATE deliveries SET status='queued',attempts=0,error=NULL,next_attempt=0 WHERE id=?",
    ).run(delivery.id);
    res.json({ ok: true });
  });
  app.get('/api/organizer/stats', auth, (req, res) => {
    const stats = db
      .prepare(
        "SELECT COALESCE(SUM(CASE WHEN o.status='paid' THEN o.amount ELSE 0 END),0) AS revenue,COALESCE(SUM(CASE WHEN o.status='paid' THEN o.quantity ELSE 0 END),0) AS sold,COUNT(CASE WHEN o.status='paid' THEN 1 END) AS paid_orders,COUNT(CASE WHEN o.status='pending' THEN 1 END) AS pending,COUNT(CASE WHEN o.status='review' THEN 1 END) AS review FROM orders o JOIN events e ON e.id=o.event_id WHERE e.owner_id=?",
      )
      .get(req.user.id);
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(Date.now() - (6 - i) * 86400000);
      return d.toLocaleDateString('en-CA', { timeZone: 'Africa/Dar_es_Salaam' });
    });
    const orders = db
      .prepare(
        "SELECT o.created_at,o.amount,o.quantity FROM orders o JOIN events e ON e.id=o.event_id WHERE e.owner_id=? AND o.status='paid'",
      )
      .all(req.user.id);
    const chart = days.map((day) => {
      const matches = orders.filter(
        (o) =>
          new Date(o.created_at).toLocaleDateString('en-CA', {
            timeZone: 'Africa/Dar_es_Salaam',
          }) === day,
      );
      return {
        date: day,
        revenue: matches.reduce((n, o) => n + o.amount, 0),
        tickets: matches.reduce((n, o) => n + o.quantity, 0),
      };
    });
    res.json({
      ...stats,
      events: db.prepare('SELECT COUNT(*) AS n FROM events WHERE owner_id=?').get(req.user.id).n,
      live_events: db
        .prepare(
          "SELECT COUNT(*) AS n FROM events WHERE owner_id=? AND status='published' AND starts_at>?",
        )
        .get(req.user.id, new Date().toISOString()).n,
      checked_in: db
        .prepare(
          "SELECT COUNT(*) AS n FROM tickets t JOIN events e ON e.id=t.event_id JOIN orders o ON o.id=t.order_id WHERE e.owner_id=? AND t.checked_in_at IS NOT NULL AND o.status='paid'",
        )
        .get(req.user.id).n,
      chart,
    });
  });
  app.get('/api/admin', auth, admin, (_req, res) =>
    res.json({
      users: db
        .prepare('SELECT id,name,email,role,created_at FROM users ORDER BY created_at DESC')
        .all(),
      events: db
        .prepare('SELECT e.*,u.name AS owner_name FROM events e JOIN users u ON u.id=e.owner_id')
        .all()
        .map((e) => cleanEvent(db, e, config, true)),
      review: db
        .prepare(
          "SELECT o.reference,o.amount,o.phone,e.name AS event_name FROM orders o JOIN events e ON e.id=o.event_id WHERE o.status='review'",
        )
        .all(),
    }),
  );
  app.get('/api/admin/finance', auth, admin, (req, res) =>
    res.json(adminFinance(db, config, req.user)),
  );
  app.post('/api/admin/finance/orders/:id/reconcile', auth, admin, (req, res) =>
    res.json({ settlement: reconcileOrder(db, config, req.user, req.params.id, req.body) }),
  );
  app.post('/api/admin/payouts/:id/review', auth, admin, (req, res) =>
    res.json({ payout: reviewPayout(db, config, req.user, req.params.id, req.body) }),
  );
  app.post('/api/admin/events/:id/status', auth, admin, (req, res) => {
    if (!['paused', 'published', 'cancelled'].includes(req.body.status))
      throw new HttpError(400, 'Choose a valid event status.');
    const result = db
      .prepare('UPDATE events SET status=? WHERE id=?')
      .run(req.body.status, req.params.id);
    if (!result.changes) throw new HttpError(404, 'Event not found.');
    res.json({ ok: true });
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpoint not found.' }));
  const dist = path.resolve('dist');
  if (existsSync(path.join(dist, 'index.html'))) {
    const template = readFileSync(path.join(dist, 'index.html'), 'utf8');
    app.use(express.static(dist, { index: false }));
    app.get('/{*path}', (req, res) => {
      const hostname = req.hostname;
      const prefix = hostname.endsWith(`.${config.baseDomain}`)
        ? hostname.slice(0, -config.baseDomain.length - 1)
        : '';
      const slug =
        req.path.match(/^\/e\/([a-z0-9-]+)\/?$/)?.[1] ||
        (req.path === '/' && prefix && !['app', 'www'].includes(prefix) ? prefix : '');
      const event = slug
        ? db
            .prepare(
              "SELECT * FROM events WHERE slug=? AND status IN ('published','paused','cancelled')",
            )
            .get(slug)
        : null;
      const privatePage =
        /^\/(?:ticket|order|claim|scanner-invite|dashboard|login|register)(?:\/|$)/.test(req.path);
      res
        .status(slug && !event ? 404 : 200)
        .type('html')
        .send(renderPage(template, event, config, privatePage));
    });
  }
  app.use((error, _req, res, _next) => {
    const status = error instanceof multer.MulterError ? 400 : error.status || 500;
    if (status === 500) console.error(error);
    res
      .status(status)
      .json({
        error: status === 500 ? 'Something went wrong. Please try again.' : error.message,
        ...(error instanceof HttpError && error.payoutAdjustment
          ? { payout_adjustment: error.payoutAdjustment }
          : {}),
      });
  });
  return app;
}
