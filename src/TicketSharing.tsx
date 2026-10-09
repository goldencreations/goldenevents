import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Check, Copy, Loader2, Send, Share2, ShieldCheck, Ticket, X } from 'lucide-react';
import { api, send, dateLabel, timeLabel } from './api';
import { useApp } from './context';
import { ErrorBox, EventImage, Spinner } from './ui';
import { PublicHeader, PublicFooter, TicketContent } from './PublicPages';
import type { BookingTicket, Event } from './types';

export function TicketDistribution({
  orderToken,
  tickets,
  refresh,
}: {
  orderToken: string;
  tickets: BookingTicket[];
  refresh: () => Promise<unknown>;
}) {
  const { config, notify } = useApp();
  const [expanded, setExpanded] = useState(tickets[0]?.id || '');
  const [selected, setSelected] = useState<BookingTicket | null>(null);
  const [name, setName] = useState(''),
    [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (selected) dialog.current?.showModal();
    else dialog.current?.close();
  }, [selected]);
  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      notify('Invitation link copied.');
    } catch {
      notify('Could not copy. Open the invitation and use its address.');
    }
  };
  return (
    <section className="ticket-distribution" aria-label="Your booking tickets">
      {tickets.map((ticket, index) => (
        <div className="distribution-item" key={ticket.id} data-testid="booking-ticket">
          <div className="distribution-row">
            <span className={`distribution-icon ${ticket.claimed ? 'claimed' : ''}`}>
              {ticket.claimed ? <Check size={18} /> : <Ticket size={18} />}
            </span>
            <div className="distribution-person">
              <strong>{ticket.claimed ? ticket.holder_name : `Ticket ${index + 1}`}</strong>
              <span>
                {ticket.checked_in_at
                  ? 'Admitted'
                  : ticket.claimed
                    ? 'Claimed'
                    : ticket.invite
                      ? `Waiting for ${ticket.invite.name}`
                      : 'Ready'}
              </span>
              {(ticket.claimed || ticket.invite) && (
                <small>{ticket.holder_phone || ticket.invite?.phone}</small>
              )}
            </div>
            <div className="distribution-tools">
              {!ticket.claimed && !ticket.invite && (
                <button
                  className="icon-button"
                  title="View ticket"
                  aria-label={`View ticket ${index + 1}`}
                  aria-expanded={expanded === ticket.id}
                  onClick={() => setExpanded(expanded === ticket.id ? '' : ticket.id)}
                >
                  <Ticket size={18} />
                </button>
              )}
              {!ticket.claimed && !ticket.checked_in_at && !ticket.invite && (
                <button
                  className="icon-button"
                  title={
                    config.ticketSharing === 'disabled'
                      ? 'SMS verification unavailable'
                      : 'Send to a friend'
                  }
                  aria-label={`Send ticket ${index + 1} to a friend`}
                  disabled={config.ticketSharing === 'disabled'}
                  onClick={() => {
                    setSelected(ticket);
                    setName('');
                    setPhone('');
                    setError('');
                  }}
                >
                  <Send size={18} />
                </button>
              )}
              {ticket.invite && !ticket.checked_in_at && (
                <>
                  <button
                    className="icon-button"
                    title="Copy invitation"
                    aria-label={`Copy invitation for ticket ${index + 1}`}
                    onClick={() => copy(ticket.invite!.url)}
                  >
                    <Copy size={17} />
                  </button>
                  <a
                    className="icon-button"
                    title="Share invitation on WhatsApp"
                    aria-label={`Share ticket ${index + 1} on WhatsApp`}
                    href={`https://wa.me/?text=${encodeURIComponent(`Your event ticket: ${ticket.invite.url}`)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Share2 size={17} />
                  </a>
                  <button
                    className="icon-button"
                    title="Cancel invitation"
                    aria-label={`Cancel invitation for ticket ${index + 1}`}
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      setError('');
                      try {
                        await send(
                          `/orders/${orderToken}/tickets/${ticket.id}/invite`,
                          {},
                          'DELETE',
                        );
                        await refresh();
                        notify('Invitation cancelled. The ticket is yours again.');
                      } catch (e) {
                        setError((e as Error).message);
                        await refresh();
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    <X size={17} />
                  </button>
                </>
              )}
            </div>
          </div>
          {ticket.invite && !ticket.checked_in_at && (
            <div className="invitation-address">
              <a href={ticket.invite.url} target="_blank" rel="noopener noreferrer">
                Open invitation
              </a>
              <span>
                Expires{' '}
                {dateLabel(new Date(ticket.invite.expires_at).toISOString(), { year: undefined })}
              </span>
            </div>
          )}
          {expanded === ticket.id && ticket.token && !ticket.invite && (
            <TicketContent token={ticket.token} compact />
          )}
        </div>
      ))}
      {error && !selected && <ErrorBox>{error}</ErrorBox>}
      <dialog
        ref={dialog}
        className="modal handover-modal"
        onCancel={(e) => {
          if (busy) e.preventDefault();
          else setSelected(null);
        }}
        onClose={() => setSelected(null)}
      >
        <div className="modal-head">
          <h2>Send to a friend</h2>
          <button
            className="icon-button"
            title="Close"
            aria-label="Close invitation"
            disabled={busy}
            onClick={() => setSelected(null)}
          >
            <X size={19} />
          </button>
        </div>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!selected || busy) return;
            setBusy(true);
            setError('');
            try {
              await send(`/orders/${orderToken}/tickets/${selected.id}/invite`, { name, phone });
              await refresh();
              setSelected(null);
              notify('Invitation ready to share.');
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Friend's name
            <input
              required
              minLength={2}
              maxLength={80}
              autoComplete="off"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Friend's mobile number
            <input
              required
              type="tel"
              maxLength={30}
              autoComplete="off"
              placeholder="0712 345 678"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </label>
          {error && <ErrorBox>{error}</ErrorBox>}
          <button className="button primary full" disabled={busy}>
            {busy ? <Loader2 className="spin" size={17} /> : <Send size={17} />}Create invitation
          </button>
        </form>
      </dialog>
    </section>
  );
}

type ClaimData = {
  name: string;
  phone: string;
  ticket_type: string;
  event: Event;
  expires_at: number;
};

export function ClaimPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<ClaimData | null>(null);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  const [busy, setBusy] = useState(false),
    [requested, setRequested] = useState(false);
  const [code, setCode] = useState(''),
    [demoCode, setDemoCode] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const claimKey = useRef(crypto.randomUUID());
  useEffect(() => {
    setLoading(true);
    setError('');
    api<ClaimData>(`/claims/${token}`)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);
  useEffect(() => {
    if (!cooldown) return;
    const timer = setTimeout(() => setCooldown((n) => Math.max(0, n - 1)), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);
  const requestCode = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await send<{ demo_code?: string }>(`/claims/${token}/code`, {});
      setRequested(true);
      setDemoCode(result.demo_code || '');
      setCode('');
      setCooldown(60);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="public-page">
      <PublicHeader />
      <main className="claim-page">
        {loading ? (
          <Spinner />
        ) : !data ? (
          <div className="claim-unavailable">
            <h1>Invitation unavailable</h1>
            <ErrorBox>{error}</ErrorBox>
          </div>
        ) : (
          <section className="claim-tool">
            <EventImage event={data.event} className="claim-cover" />
            <div className="claim-body">
              <span className="eyebrow">{data.ticket_type}</span>
              <h1>{data.event.name}</h1>
              <p className="claim-event-date">
                {dateLabel(data.event.starts_at)} · {timeLabel(data.event.starts_at)} EAT
              </p>
              <div className="claim-recipient">
                <ShieldCheck size={21} />
                <div>
                  <strong>{data.name}</strong>
                  <span>{data.phone}</span>
                </div>
              </div>
              {!requested ? (
                <button className="button primary full" disabled={busy} onClick={requestCode}>
                  {busy ? <Loader2 className="spin" size={18} /> : <ShieldCheck size={18} />}Verify
                  my number
                </button>
              ) : (
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (busy) return;
                    setBusy(true);
                    setError('');
                    try {
                      const result = await send<{ token: string }>(`/claims/${token}/accept`, {
                        code,
                        claim_key: claimKey.current,
                      });
                      navigate(`/ticket/${result.token}`, { replace: true });
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {demoCode && (
                    <div className="demo-claim-code">
                      <span>DEMO ONLY · NO SMS SENT</span>
                      <strong data-testid="demo-claim-code">{demoCode}</strong>
                    </div>
                  )}
                  <label>
                    Verification code
                    <input
                      autoFocus
                      required
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    />
                  </label>
                  <button className="button primary full" disabled={busy || code.length !== 6}>
                    {busy ? <Loader2 className="spin" size={18} /> : <Ticket size={18} />}Claim my
                    ticket
                  </button>
                  <button
                    type="button"
                    className="text-link claim-resend"
                    disabled={busy || cooldown > 0}
                    onClick={requestCode}
                  >
                    {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
                  </button>
                </form>
              )}
              {error && <ErrorBox>{error}</ErrorBox>}
            </div>
          </section>
        )}
      </main>
      <PublicFooter />
    </div>
  );
}
