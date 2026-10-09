import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowUpRight,
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  MapPin,
  Clock,
  Minus,
  Plus,
  Smartphone,
  Check,
  ShieldCheck,
  Loader2,
  Search,
  Ticket,
  Download,
  Printer,
  Copy,
  AlertCircle,
  ExternalLink,
} from 'lucide-react';
import { api, send, ApiError, money, dateLabel, timeLabel, shortPhone } from './api';
import { useApp } from './context';
import { Brand, Spinner, ErrorBox, Status, Empty, EventCard, EventImage } from './ui';
import type { Event, Order } from './types';

function PublicHeader() {
  const { user, config } = useApp();
  return (
    <header className="public-header">
      <a href={config.publicOrigin}>
        <Brand />
      </a>
      <nav>
        <a href={config.publicOrigin}>Explore events</a>
        <a
          className="button secondary"
          href={`${config.appOrigin}${user ? '/dashboard' : '/login'}`}
        >
          {user ? 'My workspace' : 'Create an event'}
          <ArrowUpRight size={16} />
        </a>
      </nav>
    </header>
  );
}
function PublicFooter() {
  return (
    <footer className="public-footer">
      <Brand />
      <span>© {new Date().getFullYear()} Golden Creation</span>
      <span>Dar es Salaam, Tanzania</span>
    </footer>
  );
}
export function Explore() {
  const [events, setEvents] = useState<Event[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [query, setQuery] = useState(''),
    [category, setCategory] = useState('All');
  useEffect(() => {
    api<{ events: Event[] }>('/events')
      .then((d) => setEvents(d.events))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  const filtered = events.filter(
    (e) =>
      (category === 'All' || e.category === category) &&
      `${e.name} ${e.city} ${e.venue}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="public-page">
      <PublicHeader />
      <main className="explore-main">
        <div className="explore-heading">
          <div>
            <span className="eyebrow">DAR ES SALAAM & BEYOND</span>
            <h1>Find your next moment.</h1>
          </div>
          <div className="explore-search">
            <Search size={19} />
            <input
              aria-label="Search public events"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Event, venue, or city"
            />
          </div>
        </div>
        <div className="tabs explore-tabs" role="tablist" aria-label="Event category">
          {['All', 'Music', 'Nightlife', 'Community', 'Business', 'Arts', 'Sports'].map((c) => (
            <button
              key={c}
              role="tab"
              aria-selected={category === c}
              className={category === c ? 'active' : ''}
              onClick={() => setCategory(c)}
            >
              {c === 'All' ? 'All events' : c}
            </button>
          ))}
        </div>
        {loading ? (
          <Spinner />
        ) : error ? (
          <ErrorBox>{error}</ErrorBox>
        ) : filtered.length ? (
          <div className="event-grid public-event-grid">
            {filtered.map((e) => (
              <EventCard key={e.id} event={e} />
            ))}
          </div>
        ) : (
          <Empty title="No events found" />
        )}
      </main>
      <PublicFooter />
    </div>
  );
}

export function EventPage({ hostSlug }: { hostSlug?: string }) {
  const params = useParams(),
    slug = hostSlug || params.slug,
    { config } = useApp();
  const [searchParams, setSearchParams] = useSearchParams();
  const orderToken = searchParams.get('order') || '';
  const setOrderToken = (token: string) =>
    setSearchParams(token ? { order: token } : {}, { replace: true });
  const [event, setEvent] = useState<Event | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [typeId, setTypeId] = useState(''),
    [quantity, setQuantity] = useState(1),
    [phone, setPhone] = useState(''),
    [email, setEmail] = useState(''),
    [whatsapp, setWhatsapp] = useState(false),
    [extras, setExtras] = useState(false),
    [busy, setBusy] = useState(false);
  const key = useRef(crypto.randomUUID());
  useEffect(() => {
    setLoading(true);
    setError('');
    api<{ event: Event }>(`/events/${slug}`)
      .then(({ event }) => {
        setEvent(event);
        document.title = `${event.name} | Golden Events`;
        setTypeId(
          event.tickets.find((t) => (t.available || 0) > 0)?.id || event.tickets[0].id || '',
        );
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [slug]);
  useEffect(() => {
    key.current = crypto.randomUUID();
  }, [typeId, quantity, phone, email, whatsapp]);
  const selected = event?.tickets.find((t) => t.id === typeId),
    amount = (selected?.price || 0) * quantity;
  const buy = async () => {
    if (!event) return;
    setBusy(true);
    setError('');
    try {
      const result = await send<{ token: string }>('/orders', {
        event_id: event.id,
        ticket_type_id: typeId,
        quantity,
        phone,
        email,
        whatsapp,
        idempotency_key: key.current,
      });
      setOrderToken(result.token);
    } catch (e) {
      if (e instanceof ApiError && typeof e.data.token === 'string') setOrderToken(e.data.token);
      else setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const closed =
    event &&
    (event.status !== 'published' ||
      new Date(event.starts_at) <= new Date() ||
      !selected?.available);
  return (
    <div className="public-page">
      <PublicHeader />
      {loading ? (
        <Spinner />
      ) : !event ? (
        <main className="public-empty">
          <ErrorBox>{error}</ErrorBox>
          <a className="text-link" href={config.publicOrigin}>
            Explore other events
            <ArrowRight size={16} />
          </a>
        </main>
      ) : (
        <main className="event-public-main">
          <a className="back-link" href={config.publicOrigin}>
            <ArrowLeft size={15} />
            All events
          </a>
          <div className="event-public-layout">
            <div className="event-public-details">
              <EventImage event={event} className="event-public-cover" />
              <div className="event-title-row">
                <span className="category-label">{event.category}</span>
                {event.status !== 'published' && <Status status={event.status} />}
              </div>
              <h1>{event.name}</h1>
              <div className="event-facts">
                <div>
                  <span className="fact-icon">
                    <CalendarDays size={21} />
                  </span>
                  <span>
                    <strong>
                      {dateLabel(event.starts_at, { weekday: 'short', year: undefined })}
                    </strong>
                    <small>{timeLabel(event.starts_at)} EAT</small>
                  </span>
                </div>
                <div>
                  <span className="fact-icon peach">
                    <MapPin size={21} />
                  </span>
                  <span>
                    <strong>{event.venue}</strong>
                    <small>{event.city}</small>
                  </span>
                </div>
              </div>
              <section className="public-about">
                <h2>About the event</h2>
                <p>{event.description}</p>
              </section>
              <div className="event-hosted">
                <span className="hosted-avatar">{event.name[0]}</span>
                <span>
                  Hosted on<strong>Golden Events</strong>
                </span>
                <button
                  className="icon-button"
                  title="Share event"
                  aria-label="Share event"
                  onClick={async () => {
                    try {
                      if (navigator.share)
                        await navigator.share({ title: event.name, url: event.url });
                      else {
                        await navigator.clipboard.writeText(event.url);
                        window.alert('Event link copied.');
                      }
                    } catch {}
                  }}
                >
                  <ExternalLink size={18} />
                </button>
              </div>
            </div>
            <aside className="checkout-aside">
              {orderToken ? (
                <OrderContent
                  token={orderToken}
                  onRetry={() => {
                    setOrderToken('');
                    key.current = crypto.randomUUID();
                  }}
                />
              ) : (
                <div className="checkout">
                  <div className="checkout-heading">
                    <span className="checkout-icon">
                      <Ticket size={22} />
                    </span>
                    <h2>Be there.</h2>
                    <p>Choose your ticket.</p>
                  </div>
                  {event.status === 'cancelled' ? (
                    <ErrorBox>This event has been cancelled.</ErrorBox>
                  ) : event.status === 'paused' ? (
                    <div className="notice">Ticket sales are temporarily paused.</div>
                  ) : new Date(event.starts_at) <= new Date() ? (
                    <div className="notice">Ticket sales have ended.</div>
                  ) : (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        buy();
                      }}
                    >
                      <fieldset className="ticket-options">
                        <legend className="sr-only">Ticket type</legend>
                        {event.tickets.map((t) => (
                          <label
                            className={`ticket-option ${typeId === t.id ? 'selected' : ''} ${!t.available ? 'sold-out' : ''}`}
                            key={t.id}
                          >
                            <input
                              type="radio"
                              name="ticketType"
                              checked={typeId === t.id}
                              disabled={!t.available}
                              onChange={() => {
                                setTypeId(t.id!);
                                setQuantity(1);
                              }}
                            />
                            <span>
                              <strong>{t.name}</strong>
                              <small>{t.available ? 'Entry for one person' : 'Sold out'}</small>
                            </span>
                            <strong>TZS {money(t.price)}</strong>
                          </label>
                        ))}
                      </fieldset>
                      <div className="quantity-row">
                        <label htmlFor="quantity-count">Quantity</label>
                        <div className="stepper">
                          <button
                            type="button"
                            aria-label="Remove one ticket"
                            disabled={quantity <= 1}
                            onClick={() => setQuantity(quantity - 1)}
                          >
                            <Minus size={15} />
                          </button>
                          <output id="quantity-count">{quantity}</output>
                          <button
                            type="button"
                            aria-label="Add one ticket"
                            disabled={quantity >= Math.min(10, selected?.available || 1)}
                            onClick={() => setQuantity(quantity + 1)}
                          >
                            <Plus size={15} />
                          </button>
                        </div>
                      </div>
                      <label>
                        Mobile money number
                        <div className="phone-input">
                          <span>+255</span>
                          <input
                            type="tel"
                            inputMode="tel"
                            autoComplete="tel-national"
                            required
                            pattern="[0-9+ ()-]{9,18}"
                            value={phone}
                            onChange={(e) => setPhone(e.target.value)}
                            placeholder="0712 345 678"
                            aria-label="Mobile money number"
                          />
                        </div>
                      </label>
                      <div className="payment-networks">
                        <span className="network-mpesa">M-Pesa</span>
                        <span className="network-airtel">Airtel Money</span>
                        <span className="network-mixx">Mixx by Yas</span>
                        <span className="network-halo">HaloPesa</span>
                      </div>
                      {config.paymentDriver === 'flutterwave' ? (
                        <label>
                          Email address
                          <input
                            required
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="you@example.com"
                          />
                        </label>
                      ) : (
                        <>
                          <button
                            className="optional-toggle"
                            type="button"
                            onClick={() => setExtras(!extras)}
                          >
                            {extras ? <Minus size={14} /> : <Plus size={14} />}Email or WhatsApp
                            ticket
                          </button>
                          {extras && (
                            <div className="optional-delivery">
                              <label>
                                Email address <span className="field-note">Optional</span>
                                <input
                                  type="email"
                                  value={email}
                                  onChange={(e) => setEmail(e.target.value)}
                                  placeholder="you@example.com"
                                />
                              </label>
                              <label className="checkbox-label">
                                <input
                                  type="checkbox"
                                  checked={whatsapp}
                                  onChange={(e) => setWhatsapp(e.target.checked)}
                                />
                                Send my ticket to this number on WhatsApp
                              </label>
                            </div>
                          )}
                        </>
                      )}
                      {config.paymentDriver === 'flutterwave' && (
                        <label className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={whatsapp}
                            onChange={(e) => setWhatsapp(e.target.checked)}
                          />
                          Send my ticket on WhatsApp
                        </label>
                      )}
                      {error && <ErrorBox>{error}</ErrorBox>}
                      <div className="checkout-total">
                        <span>
                          Total <small>No added platform fee</small>
                        </span>
                        <strong>TZS {money(amount)}</strong>
                      </div>
                      <button
                        className="button primary full pay-button"
                        disabled={busy || !!closed || config.paymentDriver === 'disabled'}
                      >
                        {busy ? (
                          <Loader2 className="spin" size={18} />
                        ) : (
                          <>
                            Pay TZS {money(amount)}
                            <ArrowRight size={18} />
                          </>
                        )}
                      </button>
                      <div className="checkout-security">
                        <ShieldCheck size={14} />
                        <span>
                          {config.paymentDriver === 'demo'
                            ? 'Demo checkout · no money charged'
                            : 'Authorize payment with your mobile money provider'}
                        </span>
                      </div>
                    </form>
                  )}
                  <div className="checkout-powered">
                    Powered by <Brand />
                  </div>
                </div>
              )}
            </aside>
          </div>
        </main>
      )}
      <PublicFooter />
    </div>
  );
}

type OrderData = {
  order: Order;
  event: Event;
  tickets: { token: string; code: string; checked_in_at: string | null }[];
};
export function OrderContent({ token, onRetry }: { token: string; onRetry?: () => void }) {
  const { config } = useApp();
  const [data, setData] = useState<OrderData | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [remaining, setRemaining] = useState(0);
  const load = () =>
    api<OrderData>(`/orders/${token}`)
      .then((result) => {
        setData(result);
        setRemaining(Math.max(0, Math.ceil((result.order.expires_at - Date.now()) / 1000)));
        setError('');
      })
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
    if (data && data.order.status !== 'pending') return;
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, [token, data?.order.status]);
  useEffect(() => {
    if (data?.order.status !== 'pending') return;
    const timer = setInterval(() => setRemaining((x) => Math.max(0, x - 1)), 1000);
    return () => clearInterval(timer);
  }, [data?.order.status]);
  const demo = async (action: string) => {
    setBusy(true);
    try {
      await send(`/orders/${token}/demo`, { action });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (!data)
    return (
      <div className="checkout">
        <Spinner />
        {error && <ErrorBox>{error}</ErrorBox>}
      </div>
    );
  const { order, event, tickets } = data;
  const pending = order.status === 'pending',
    paid = order.status === 'paid';
  return (
    <div className="order-content">
      {pending ? (
        <div className="checkout payment-waiting">
          <span className="waiting-icon">
            <Smartphone size={34} />
          </span>
          <h2>Check your phone.</h2>
          <p>{shortPhone(order.phone)}</p>
          <strong className="payment-amount">TZS {money(order.amount)}</strong>
          <span className="reservation-timer">
            <Clock size={14} />
            {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')} remaining
          </span>
          {config.paymentDriver === 'demo' && order.provider === 'demo' ? (
            <div className="demo-payment">
              <span className="eyebrow">DEMO PAYMENT</span>
              <button
                className="button primary full"
                disabled={busy}
                onClick={() => demo('approve')}
              >
                {busy ? (
                  <Loader2 className="spin" size={17} />
                ) : (
                  <>
                    <Check size={17} />
                    Approve demo payment
                  </>
                )}
              </button>
              <button className="text-link" disabled={busy} onClick={() => demo('decline')}>
                Decline payment
              </button>
              <small>No money will be charged.</small>
            </div>
          ) : (
            <p className="muted">
              Authorize the payment request with your mobile money provider. This page updates when
              payment is confirmed.
            </p>
          )}
          <span className="order-reference">{order.reference}</span>
        </div>
      ) : paid ? (
        <>
          <div className="paid-heading">
            <span className="success-icon">
              <Check size={23} />
            </span>
            <div>
              <h2>You’re going.</h2>
              <p>
                {tickets.length} ticket{tickets.length > 1 ? 's' : ''} confirmed
              </p>
            </div>
          </div>
          {tickets.map((t) => (
            <TicketContent key={t.token} token={t.token} compact />
          ))}
          <div className="ticket-confirmation-note">
            <Smartphone size={15} />
            {config.deliveryDriver === 'outbox'
              ? 'Ticket messages saved in the demo outbox.'
              : 'Your ticket messages have been queued for delivery.'}
          </div>
        </>
      ) : (
        <div className="checkout payment-ended">
          <AlertCircle size={36} />
          <h2>
            {order.status === 'failed'
              ? 'Payment declined'
              : order.status === 'expired'
                ? 'Reservation expired'
                : order.status === 'refunded'
                  ? 'Order refunded'
                  : 'Payment needs review'}
          </h2>
          <p>
            {order.status === 'review'
              ? 'Payment was received, but tickets could not be issued. The organizer needs to resolve this order.'
              : order.status === 'refunded'
                ? 'These tickets are no longer valid.'
                : 'No ticket has been issued for this order.'}
          </p>
          {['failed', 'expired'].includes(order.status) &&
            (onRetry ? (
              <button className="button primary full" onClick={onRetry}>
                Try again
                <ArrowRight size={16} />
              </button>
            ) : (
              <Link className="button primary full" to={`/e/${event.slug}`}>
                Back to event
                <ArrowLeft size={16} />
              </Link>
            ))}
          <span className="order-reference">{order.reference}</span>
        </div>
      )}
      {error && <ErrorBox>{error}</ErrorBox>}
    </div>
  );
}
export function OrderPage() {
  const { token } = useParams();
  return (
    <div className="public-page">
      <PublicHeader />
      <main className="order-page">
        <OrderContent token={token!} />
      </main>
      <PublicFooter />
    </div>
  );
}
type TicketData = {
  ticket: {
    code: string;
    token: string;
    checked_in_at: string | null;
    ticket_type: string;
    valid: boolean;
  };
  event: Event;
  qr: string;
};
function TicketContent({ token, compact = false }: { token: string; compact?: boolean }) {
  const [data, setData] = useState<TicketData | null>(null),
    [error, setError] = useState('');
  const { notify } = useApp();
  useEffect(() => {
    api<TicketData>(`/tickets/${token}`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [token]);
  if (error) return <ErrorBox>{error}</ErrorBox>;
  if (!data) return <Spinner label="Loading ticket" />;
  const { ticket, event, qr } = data;
  return (
    <article
      className={`golden-ticket ${compact ? 'compact-ticket' : ''} ${!ticket.valid ? 'invalid-ticket' : ''}`}
    >
      <div className="ticket-art">
        <EventImage event={event} />
        <div>
          <span className="eyebrow">{ticket.ticket_type}</span>
          <h2>{event.name}</h2>
        </div>
      </div>
      <div className="ticket-info">
        <div>
          <CalendarDays size={15} />
          <span>
            {dateLabel(event.starts_at)} · {timeLabel(event.starts_at)} EAT
          </span>
        </div>
        <div>
          <MapPin size={15} />
          <span>
            {event.venue}, {event.city}
          </span>
        </div>
      </div>
      <div className="ticket-perforation" />
      <div className="ticket-qr">
        {ticket.valid ? (
          <img src={qr} alt={`QR ticket ${ticket.code}`} width={220} height={220} />
        ) : (
          <div className="invalid-qr">
            <AlertCircle size={40} />
            Ticket invalid
          </div>
        )}
        <strong className="mono">{ticket.code}</strong>
        <span>
          {!ticket.valid
            ? 'Not valid for entry'
            : ticket.checked_in_at
              ? `Admitted at ${timeLabel(ticket.checked_in_at)}`
              : 'Valid for one admission'}
        </span>
      </div>
      <div className="ticket-actions">
        <button
          className="icon-button"
          title="Print ticket"
          aria-label="Print ticket"
          onClick={() => window.print()}
        >
          <Printer size={18} />
        </button>
        <a
          className="icon-button"
          href={qr}
          download={`${ticket.code}-QR.png`}
          title="Download ticket QR"
          aria-label="Download ticket QR"
        >
          <Download size={18} />
        </a>
        <button
          className="icon-button"
          title="Copy ticket link"
          aria-label="Copy ticket link"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(`${window.location.origin}/ticket/${token}`);
              notify('Ticket link copied.');
            } catch {
              notify('Copy the ticket address from your browser.');
            }
          }}
        >
          <Copy size={18} />
        </button>
        {compact && (
          <Link className="text-link" to={`/ticket/${token}`} target="_blank">
            Open ticket
            <ArrowUpRight size={14} />
          </Link>
        )}
      </div>
    </article>
  );
}
export function TicketPage() {
  const { token } = useParams();
  return (
    <div className="public-page ticket-page">
      <PublicHeader />
      <main className="single-ticket">
        <TicketContent token={token!} />
      </main>
      <PublicFooter />
    </div>
  );
}
