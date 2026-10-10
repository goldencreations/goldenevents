import { statfsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { metaWhatsAppConfigured } from './whatsapp.js';

const bad = (status) => ['down', 'degraded'].includes(status);
export function overallHealth(components) {
  if (components.some((component) => component.status === 'down')) return 'down';
  if (components.some((component) => component.status === 'degraded')) return 'degraded';
  if (components.some((component) => component.status === 'unknown')) return 'unknown';
  return 'operational';
}

export function createHealthMonitor(db, config, options = {}) {
  const clock = options.clock || Date.now;
  const fetcher = options.fetch || fetch;
  const filesystem = options.statfs || statfsSync;
  let databaseCache, providerCache, snapshotCache, pending, timer;
  let lastRecorded = -1;
  const unrecorded = new Map();
  const component = (id, label, status, detail, checkedAt = clock()) => ({
    id,
    label,
    status,
    detail,
    checked_at: new Date(checkedAt).toISOString(),
  });

  function database() {
    const now = clock();
    if (databaseCache && now - databaseCache.at < 10000) return databaseCache.result;
    let status = 'operational';
    try {
      db.prepare('SELECT id FROM events LIMIT 1').get();
      db.prepare(
        'INSERT INTO health_probe (id,checked_at) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET checked_at=excluded.checked_at',
      ).run(now);
    } catch {
      status = 'down';
    }
    const result = component(
      'database',
      'Database',
      status,
      status === 'operational' ? 'Read and write checks passed.' : 'Database checks failed.',
    );
    databaseCache = { at: now, result };
    return result;
  }

  function worker() {
    const health = config.workerHealth;
    const now = clock();
    if (!health?.startedAt)
      return component(
        'worker',
        'Background processing',
        'unknown',
        'Worker heartbeat not available.',
      );
    if (!health.lastCompleted && now - health.startedAt < 30000)
      return component('worker', 'Background processing', 'unknown', 'Starting up.');
    const failed = health.lastFailed && health.lastFailed >= (health.lastCompleted || 0);
    const stale = !health.lastCompleted || now - health.lastCompleted > 120000;
    return component(
      'worker',
      'Background processing',
      failed || stale ? 'degraded' : 'operational',
      failed || stale ? 'Background processing needs attention.' : 'Worker heartbeat is current.',
    );
  }

  function readiness() {
    const checks = [database(), worker()];
    return {
      status: checks.some((check) => bad(check.status)) ? 'not_ready' : 'ready',
      checked_at: new Date(clock()).toISOString(),
      components: checks,
    };
  }

  async function provider() {
    if (config.paymentDriver === 'disabled')
      return component('payments', 'Payments', 'not_configured', 'Checkout is disabled.');
    if (config.paymentDriver === 'demo')
      return component(
        'payments',
        'Payments',
        'not_configured',
        'Demo payments only; no live collection.',
      );
    if (config.paymentDriver !== 'ecofy')
      return component(
        'payments',
        'Payments',
        'unknown',
        'Provider reachability is not monitored.',
      );
    const now = clock();
    if (providerCache && now - providerCache.at < 60000) return providerCache.result;
    let healthy = false;
    try {
      const response = await fetcher(`${config.ecofyBaseUrl}/healthz`, {
        redirect: 'error',
        signal: AbortSignal.timeout(4000),
        headers: { Accept: 'application/json' },
      });
      healthy = response.ok && (await response.json()).status === 'ok';
    } catch {
      /* Reachability failures are reported without exposing upstream responses. */
    }
    const result = component(
      'payments',
      'Ecofy API',
      healthy ? 'operational' : 'degraded',
      healthy
        ? 'API reachable. Payment authorizations are not tested by this check.'
        : 'Payment provider health check failed.',
    );
    providerCache = { at: now, result };
    return result;
  }

  function delivery(channel, label) {
    const twilio = !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
    const configured =
      (channel === 'whatsapp' && metaWhatsAppConfigured()) ||
      (config.deliveryDriver === 'live' &&
        (channel === 'email'
          ? !!(process.env.SMTP_HOST && process.env.SMTP_FROM)
          : channel === 'sms'
            ? twilio && !!process.env.TWILIO_SMS_FROM
            : twilio &&
              !!(process.env.TWILIO_WHATSAPP_FROM && process.env.TWILIO_WHATSAPP_CONTENT_SID)));
    if (!configured)
      return component(channel, label, 'not_configured', 'Automatic delivery is not configured.');
    if (database().status !== 'operational')
      return component(channel, label, 'unknown', 'Delivery queue could not be checked.');
    const issue = db
      .prepare(
        "SELECT 1 FROM deliveries WHERE channel=? AND (status='failed' OR (status='queued' AND created_at<?)) LIMIT 1",
      )
      .get(channel, new Date(clock() - 600000).toISOString());
    return component(
      channel,
      label,
      issue ? 'degraded' : 'unknown',
      issue
        ? 'Some ticket messages need attention.'
        : 'Configured; end-to-end delivery is not monitored.',
    );
  }

  function paymentQueue() {
    if (!['ecofy', 'flutterwave'].includes(config.paymentDriver))
      return component(
        'payment_queue',
        'Payment processing',
        'not_configured',
        'Live payment processing is not enabled.',
      );
    if (database().status !== 'operational')
      return component(
        'payment_queue',
        'Payment processing',
        'unknown',
        'Payment queue could not be checked.',
      );
    const failed = db
      .prepare("SELECT 1 FROM webhook_jobs WHERE provider=? AND status='failed' LIMIT 1")
      .get(config.paymentDriver);
    const review = db
      .prepare("SELECT 1 FROM orders WHERE provider=? AND status='review' LIMIT 1")
      .get(config.paymentDriver);
    const delayed = db
      .prepare(
        "SELECT 1 FROM webhook_jobs WHERE provider=? AND status='queued' AND next_attempt>0 AND next_attempt<? LIMIT 1",
      )
      .get(config.paymentDriver, clock() - 600000);
    const uncertain =
      config.paymentDriver === 'ecofy' &&
      db
        .prepare(
          "SELECT 1 FROM ecofy_jobs j JOIN orders o ON o.id=j.order_id WHERE o.status IN ('pending','expired') AND o.created_at<? LIMIT 1",
        )
        .get(new Date(clock() - 600000).toISOString());
    const problem = failed || review || delayed || uncertain || bad(worker().status);
    return component(
      'payment_queue',
      'Payment processing',
      problem ? 'degraded' : 'operational',
      problem
        ? 'Payment processing or unresolved bookings need attention.'
        : 'Worker heartbeat and payment queues checked; no test charge performed.',
    );
  }

  function record(snapshot) {
    const now = clock();
    for (const item of snapshot.components) {
      if (bad(item.status) && !unrecorded.has(item.id))
        unrecorded.set(item.id, { component: item.id, label: item.label, started_at: now });
    }
    try {
      for (const issue of unrecorded.values()) {
        db.prepare(
          'INSERT OR IGNORE INTO health_incidents (id,component,label,started_at) VALUES (?,?,?,?)',
        ).run(randomUUID(), issue.component, issue.label, issue.started_at);
      }
      unrecorded.clear();
      for (const item of snapshot.components) {
        if (item.status === 'operational' || item.status === 'not_configured')
          db.prepare(
            'UPDATE health_incidents SET resolved_at=? WHERE component=? AND resolved_at IS NULL',
          ).run(now, item.id);
      }
      const bucket = Math.floor(now / 60000) * 60000;
      if (bucket !== lastRecorded) {
        db.prepare('INSERT OR IGNORE INTO health_samples (checked_at,status) VALUES (?,?)').run(
          bucket,
          snapshot.status,
        );
        db.prepare('DELETE FROM health_samples WHERE checked_at<?').run(now - 30 * 86400000);
        db.prepare(
          'DELETE FROM health_incidents WHERE resolved_at IS NOT NULL AND resolved_at<?',
        ).run(now - 30 * 86400000);
        lastRecorded = bucket;
      }
    } catch {
      /* Retain issue start times in memory while the database is unavailable. */
    }
  }

  function history() {
    try {
      return {
        days: db
          .prepare(
            `SELECT date(checked_at/1000+10800,'unixepoch') AS day,
           COUNT(*) AS checks, SUM(status='operational') AS operational,
           SUM(status='degraded') AS degraded, SUM(status='down') AS down,
           SUM(status='unknown') AS unknown FROM health_samples GROUP BY day ORDER BY day`,
          )
          .all(),
        incidents: db
          .prepare(
            'SELECT component,label,started_at,resolved_at FROM health_incidents ORDER BY started_at DESC LIMIT 20',
          )
          .all(),
      };
    } catch {
      return { days: [], incidents: [] };
    }
  }

  async function collect() {
    if (snapshotCache && clock() - snapshotCache.at < 15000) return snapshotCache.result;
    if (pending) return pending;
    pending = (async () => {
      const components = [
        component('api', 'Website API', 'operational', 'Application is responding.'),
        database(),
        worker(),
      ];
      try {
        const space = filesystem(config.dataDir);
        const low = Number(space.bavail) * Number(space.bsize) < 100 * 1024 * 1024;
        components.push(
          component(
            'storage',
            'Storage',
            low ? 'degraded' : 'operational',
            low ? 'Available storage is running low.' : 'Storage capacity check passed.',
          ),
        );
      } catch {
        components.push(component('storage', 'Storage', 'unknown', 'Storage check unavailable.'));
      }
      components.push(await provider());
      try {
        components.push(paymentQueue());
      } catch {
        components.push(
          component(
            'payment_queue',
            'Payment processing',
            'unknown',
            'Payment queue could not be checked.',
          ),
        );
      }
      for (const [channel, label] of [
        ['sms', 'SMS delivery'],
        ['email', 'Email delivery'],
        ['whatsapp', 'WhatsApp delivery'],
      ]) {
        try {
          components.push(delivery(channel, label));
        } catch {
          components.push(
            component(channel, label, 'unknown', 'Delivery queue could not be checked.'),
          );
        }
      }
      const snapshot = {
        status: overallHealth(components),
        checked_at: new Date(clock()).toISOString(),
        components,
        monitor: 'on_server',
        external_monitoring: false,
        alerts: false,
      };
      record(snapshot);
      const result = { ...snapshot, ...history() };
      snapshotCache = { at: clock(), result };
      return result;
    })();
    try {
      return await pending;
    } finally {
      pending = null;
    }
  }

  function start() {
    if (timer) return;
    collect().catch(() => {});
    timer = setInterval(() => collect().catch(() => {}), 60000);
    timer.unref();
  }
  function stop() {
    clearInterval(timer);
    timer = null;
  }
  return { readiness, collect, start, stop };
}
