import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { api, dateLabel, timeLabel } from './api';
import { ErrorBox } from './ui';
type Activity = {
  available: boolean;
  counts: Record<string, number>;
  p95_latency_ms: number | null;
  recent: {
    id: string;
    phone: string;
    purpose: string;
    status: string;
    attempts: number;
    created_at: number;
    error_code: string | null;
  }[];
};
export function OtpActivity() {
  const [data, setData] = useState<Activity | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const load = async () => {
    setBusy(true);
    try {
      setData(await api<Activity>('/admin/otp'));
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  return (
    <section className="finance-section">
      <div className="section-heading">
        <h2>SMS verification</h2>
        <button
          className="icon-button"
          title="Refresh verification activity"
          aria-label="Refresh verification activity"
          onClick={load}
          disabled={busy}
        >
          <RefreshCw size={17} />
        </button>
      </div>
      {error && <ErrorBox>{error}</ErrorBox>}
      {data && (
        <>
          <div className="admin-counts">
            <span>{data.available ? 'Connected' : 'Not configured'}</span>
            <span>
              <strong>{(data.counts.sent || 0) + (data.counts.verified || 0)}</strong> active /
              verified
            </span>
            <span>
              <strong>{data.counts.delivery_failed || 0}</strong> unconfirmed sends
            </span>
            <span>
              <strong>{data.counts.locked || 0}</strong> locked
            </span>
            <span>
              Last hour · p95{' '}
              {data.p95_latency_ms === null
                ? 'not observed'
                : `${(data.p95_latency_ms / 1000).toFixed(1)}s`}
            </span>
          </div>
          {data.recent.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Phone</th>
                    <th>Purpose</th>
                    <th>Status</th>
                    <th>Wrong guesses</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent.map((row) => (
                    <tr key={row.id}>
                      <td>
                        {dateLabel(new Date(row.created_at).toISOString())}
                        <small className="finance-cell-note">
                          {timeLabel(new Date(row.created_at).toISOString())}
                        </small>
                      </td>
                      <td>{row.phone}</td>
                      <td>{row.purpose.replaceAll('_', ' ')}</td>
                      <td>{row.status.replaceAll('_', ' ')}</td>
                      <td>{row.attempts}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
