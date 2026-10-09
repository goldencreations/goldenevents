import { useEffect, useState } from 'react';
import {
  Activity,
  ArrowUpRight,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  HelpCircle,
} from 'lucide-react';
import { Brand } from './ui';

type State = 'operational' | 'degraded' | 'down' | 'unknown' | 'not_configured';
type Snapshot = {
  status: State;
  checked_at: string;
  components: { id: string; label: string; status: State; detail: string; checked_at: string }[];
  days: {
    day: string;
    checks: number;
    operational: number;
    degraded: number;
    down: number;
    unknown: number;
  }[];
  incidents: { component: string; label: string; started_at: number; resolved_at: number | null }[];
};
const labels: Record<State, string> = {
  operational: 'Operational',
  degraded: 'Degraded',
  down: 'Unavailable',
  unknown: 'Not verified',
  not_configured: 'Not configured',
};
const titles: Record<State, string> = {
  operational: 'Configured services are operational',
  degraded: 'Some services need attention',
  down: 'A service is unavailable',
  unknown: 'Some checks are not verified',
  not_configured: 'Services are not configured',
};
const time = (value: number | string) =>
  new Date(value).toLocaleString('en-GB', {
    timeZone: 'Africa/Dar_es_Salaam',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

export function StatusPage() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  async function load(signal?: AbortSignal) {
    setBusy(true);
    try {
      const response = await fetch('/api/status', {
        cache: 'no-store',
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(8000)])
          : AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error('Status unavailable');
      const data = await response.json();
      if (
        !Array.isArray(data.components) ||
        !Array.isArray(data.days) ||
        !Array.isArray(data.incidents) ||
        !Number.isFinite(Date.parse(data.checked_at)) ||
        !(data.status in labels)
      )
        throw new Error('Invalid status');
      setSnapshot(data);
      setUnreachable(false);
    } catch {
      if (!signal?.aborted) setUnreachable(true);
    } finally {
      if (!signal?.aborted) setBusy(false);
    }
  }
  useEffect(() => {
    document.title = 'System Status | Golden Events';
    const abort = new AbortController();
    load(abort.signal);
    const timer = setInterval(() => {
      setNow(Date.now());
      load();
    }, 30000);
    return () => {
      abort.abort();
      clearInterval(timer);
    };
  }, []);
  const stale = !!snapshot && now - Date.parse(snapshot.checked_at) > 90000;
  const status: State = unreachable || stale ? 'unknown' : snapshot?.status || 'unknown';
  const days = Array.from({ length: 30 }, (_, index) => {
    const day = new Date(now + 10800000 - (29 - index) * 86400000).toISOString().slice(0, 10);
    const record = snapshot?.days.find((item) => item.day === day);
    const state: State | 'no_data' = !record
      ? 'no_data'
      : record.down
        ? 'down'
        : record.degraded
          ? 'degraded'
          : record.unknown
            ? 'unknown'
            : 'operational';
    return { day, record, state };
  });
  const Icon =
    status === 'operational' ? CheckCircle2 : status === 'unknown' ? HelpCircle : AlertTriangle;
  return (
    <div className="service-status-page">
      <header className="service-status-header">
        <a href="/" aria-label="Golden Events home">
          <Brand />
        </a>
        <a href="/">
          Events <ArrowUpRight size={15} />
        </a>
      </header>
      <main className="service-status-main">
        <div className="service-status-title">
          <div>
            <span className="eyebrow">GOLDEN EVENTS</span>
            <h1>System status</h1>
          </div>
          <button
            className="icon-button"
            onClick={() => load()}
            disabled={busy}
            title="Refresh status"
            aria-label="Refresh status"
          >
            <RefreshCw size={18} className={busy ? 'spin' : ''} />
          </button>
        </div>
        <section className={`service-status-summary service-state-${status}`} aria-live="polite">
          <Icon size={25} />
          <div>
            <h2>
              {unreachable
                ? 'Status checks are unreachable'
                : stale
                  ? 'Status updates are delayed'
                  : snapshot
                    ? titles[status]
                    : 'Checking services'}
            </h2>
            <p>
              {snapshot
                ? `Last checked ${time(snapshot.checked_at)} EAT`
                : 'No current check available'}
            </p>
          </div>
        </section>
        <div className="service-monitor-meta">
          <span>
            <Activity size={14} /> On-server monitoring
          </span>
          <span>External monitoring: Not connected</span>
          <span>Alerts: Off</span>
        </div>
        <section className="service-status-list" aria-label="Service checks">
          {(snapshot?.components || []).map((item) => (
            <div className="service-status-row" key={item.id}>
              <div>
                <h2>{item.label}</h2>
                <p>
                  {unreachable || stale
                    ? 'Last known check; current state is unverified.'
                    : item.detail}
                </p>
              </div>
              <span
                className={`service-state-label service-state-${unreachable || stale ? 'unknown' : item.status}`}
              >
                <i />
                {labels[unreachable || stale ? 'unknown' : item.status]}
              </span>
            </div>
          ))}
          {!snapshot && (
            <div className="service-status-empty">
              {unreachable
                ? 'The application could not be reached. Service states are unknown.'
                : 'Waiting for the first check.'}
            </div>
          )}
        </section>
        <section className="service-status-history">
          <div className="service-section-heading">
            <h2>Recorded availability</h2>
            <span>30 days</span>
          </div>
          <div
            className="service-history-bars"
            role="img"
            aria-label="Thirty days of recorded checks; grey periods have no recorded data"
          >
            {days.map(({ day, record, state }) => (
              <span
                key={day}
                className={`service-history-bar service-state-${state}`}
                title={`${day}: ${record ? `${record.checks} checks; ${record.operational} operational, ${record.degraded} degraded, ${record.down} unavailable, ${record.unknown} unverified` : 'No recorded checks'}`}
              />
            ))}
          </div>
          <div className="service-history-legend">
            <span>30 days ago</span>
            <span>
              <i className="service-state-no_data" /> No recorded data
            </span>
            <span>Today</span>
          </div>
          <p className="service-status-disclosure">
            Recorded checks only. Gaps are unobserved periods, not confirmed uptime.
          </p>
        </section>
        <section className="service-status-incidents">
          <div className="service-section-heading">
            <h2>Recent issues</h2>
            <span>Last 30 days</span>
          </div>
          {snapshot?.incidents.length ? (
            snapshot.incidents.map((item) => (
              <div className="service-incident" key={`${item.component}-${item.started_at}`}>
                <div>
                  <h3>{item.label}</h3>
                  <p>
                    {time(item.started_at)} EAT
                    {item.resolved_at ? ` to ${time(item.resolved_at)} EAT` : ''}
                  </p>
                </div>
                <span
                  className={`service-state-label service-state-${item.resolved_at ? 'operational' : 'degraded'}`}
                >
                  {item.resolved_at ? 'Resolved' : 'Investigating'}
                </span>
              </div>
            ))
          ) : (
            <p className="service-status-empty">
              {snapshot ? 'No issues recorded.' : 'Issue history unavailable.'}
            </p>
          )}
        </section>
      </main>
      <footer className="service-status-footer">
        <span>Golden Events</span>
        <span>Africa/Dar es Salaam · EAT</span>
      </footer>
    </div>
  );
}
