import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ScanLine, Camera, CameraOff, Check, X, ArrowLeft, Loader2 } from 'lucide-react';
import type { IScannerControls } from '@zxing/browser';
import { api, send, dateLabel, shortPhone } from './api';
import { Shell } from './Dashboard';
import { ErrorBox, Spinner } from './ui';
import type { Event } from './types';
import { useApp } from './context';
type Admission = {
  code: string;
  ticket_type: string;
  phone: string;
  holder_name: string;
  reference: string;
};

export function Scanner() {
  const { user } = useApp();
  const [params] = useSearchParams();
  const [events, setEvents] = useState<Event[]>([]),
    [eventId, setEventId] = useState(params.get('event') || ''),
    [code, setCode] = useState(''),
    [camera, setCamera] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [result, setResult] = useState<Admission | null>(null),
    [history, setHistory] = useState<Admission[]>([]),
    [loading, setLoading] = useState(true);
  const video = useRef<HTMLVideoElement>(null),
    controls = useRef<IScannerControls | null>(null),
    scanBusy = useRef(false),
    lastScan = useRef('');
  useEffect(() => {
    api<{ events: Event[] }>('/scanner/events')
      .then((d) => {
        setEvents(d.events.filter((e) => e.status !== 'cancelled'));
        if (!d.events.some((e) => e.id === eventId))
          setEventId(d.events.find((e) => e.status === 'published')?.id || d.events[0]?.id || '');
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    return () => controls.current?.stop();
  }, []);
  const admit = async (value: string) => {
    if (scanBusy.current || !eventId) return;
    scanBusy.current = true;
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const data = await send<{ ticket: Admission }>('/scanner/check-in', {
        event_id: eventId,
        code: value,
      });
      setResult(data.ticket);
      setHistory((h) => [data.ticket, ...h].slice(0, 10));
      setCode('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      scanBusy.current = false;
    }
  };
  useEffect(() => {
    if (!camera || !video.current) return;
    let disposed = false;
    import('@zxing/browser')
      .then(async ({ BrowserQRCodeReader }) => {
        if (disposed || !video.current) return;
        const reader = new BrowserQRCodeReader();
        const c = await reader.decodeFromVideoDevice(undefined, video.current, (result) => {
          if (!disposed && result && !scanBusy.current && result.getText() !== lastScan.current) {
            lastScan.current = result.getText();
            admit(result.getText());
          }
        });
        if (disposed) c.stop();
        else controls.current = c;
      })
      .catch(() => {
        setError('Camera is unavailable. Allow camera access or enter the ticket code below.');
        setCamera(false);
      });
    return () => {
      disposed = true;
      controls.current?.stop();
      controls.current = null;
    };
  }, [camera, eventId]);
  return (
    <Shell title="Gate scanner">
      {user?.role !== 'scanner' && (
        <Link to="/dashboard/guests" className="back-link">
          <ArrowLeft size={15} />
          Guest list
        </Link>
      )}
      <div className="page-heading">
        <div>
          <h1>Gate scanner</h1>
          <p>{history.length} admitted this session</p>
        </div>
      </div>
      {loading ? (
        <Spinner />
      ) : (
        <div className="scanner-layout">
          <div className="scanner-tool">
            <label>
              Event
              <select
                value={eventId}
                disabled={busy}
                onChange={(e) => {
                  setEventId(e.target.value);
                  setResult(null);
                  setError('');
                  lastScan.current = '';
                  setHistory([]);
                  setCamera(false);
                }}
                aria-label="Event to scan"
              >
                {events.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name} · {dateLabel(e.starts_at)}
                  </option>
                ))}
                {!events.length && <option value="">No events available</option>}
              </select>
            </label>
            <div className={`camera-view ${camera ? 'camera-active' : ''}`}>
              {camera ? (
                <>
                  <video ref={video} muted playsInline />
                  <div className="scan-frame" />
                </>
              ) : (
                <>
                  <ScanLine size={60} />
                  <span>Ready at the door.</span>
                </>
              )}
            </div>
            <button
              className="button secondary full"
              disabled={!eventId}
              onClick={() => {
                lastScan.current = '';
                setCamera(!camera);
              }}
            >
              {camera ? <CameraOff size={18} /> : <Camera size={18} />}{' '}
              {camera ? 'Stop camera' : 'Start camera'}
            </button>
            <div className="divider">
              <span>or enter a code</span>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                admit(code);
              }}
            >
              <label>
                Ticket code or ticket link
                <input
                  required
                  autoComplete="off"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="GE-A1B2C3D4"
                />
              </label>
              <button className="button primary full" disabled={busy || !eventId}>
                {busy ? (
                  <Loader2 className="spin" size={17} />
                ) : (
                  <>
                    <Check size={17} />
                    Admit guest
                  </>
                )}
              </button>
            </form>
          </div>
          <div className="scanner-results">
            {error && (
              <div className="scan-result scan-error" role="alert">
                <span>
                  <X size={28} />
                </span>
                <h2>Entry not approved</h2>
                <p>{error}</p>
              </div>
            )}
            {result && (
              <div className="scan-result scan-success" role="status">
                <span>
                  <Check size={31} />
                </span>
                <h2>You’re in.</h2>
                {result.holder_name && <strong>{result.holder_name}</strong>}
                <p>
                  {result.ticket_type} · {shortPhone(result.phone)}
                </p>
                <strong className="mono">{result.code}</strong>
                <p>{result.reference}</p>
              </div>
            )}
            <div className="section-heading">
              <h2>Recent admissions</h2>
              <span className="count-pill">{history.length}</span>
            </div>
            {history.length ? (
              <ul className="admission-list">
                {history.map((h, i) => (
                  <li key={`${h.code}-${i}`}>
                    <span className="admission-check">
                      <Check size={17} />
                    </span>
                    <span>
                      <strong>{h.holder_name || h.code}</strong>
                      <small>
                        {h.ticket_type} · {shortPhone(h.phone)}
                      </small>
                    </span>
                    <span>Admitted</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">No tickets scanned this session.</p>
            )}
          </div>
        </div>
      )}
    </Shell>
  );
}
