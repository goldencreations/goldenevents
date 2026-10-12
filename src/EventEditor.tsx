import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowUpRight,
  ImagePlus,
  Plus,
  Trash2,
  Loader2,
  CalendarDays,
  MapPin,
  Copy,
  Check,
  ExternalLink,
  X,
} from 'lucide-react';
import { api, send, dateLabel, timeLabel, money } from './api';
import { useApp } from './context';
import { Shell } from './Dashboard';
import { ErrorBox, Spinner, EventImage, Modal } from './ui';
import type { Event, TicketType } from './types';

const localDate = (iso: string) => {
  const date = new Date(new Date(iso).getTime() + 3 * 3600000);
  return date.toISOString().slice(0, 16);
};
export function EventEditor() {
  const { id } = useParams(),
    navigate = useNavigate(),
    { config, notify } = useApp();
  const [name, setName] = useState(''),
    [description, setDescription] = useState(''),
    [starts, setStarts] = useState(''),
    [venue, setVenue] = useState(''),
    [city, setCity] = useState('Dar es Salaam'),
    [category, setCategory] = useState('Music'),
    [image, setImage] = useState(''),
    [tickets, setTickets] = useState<TicketType[]>([
      { name: 'Regular', price: 20000, capacity: 100 },
    ]),
    [slug, setSlug] = useState('your-event'),
    [status, setStatus] = useState('draft'),
    [loading, setLoading] = useState(!!id),
    [busy, setBusy] = useState(false),
    [uploading, setUploading] = useState(false),
    [error, setError] = useState(''),
    [success, setSuccess] = useState<Event | null>(null),
    [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!id) return;
    api<{ event: Event }>(`/organizer/events/${id}`)
      .then(({ event }) => {
        setName(event.name);
        setDescription(event.description);
        setStarts(localDate(event.starts_at));
        setVenue(event.venue);
        setCity(event.city);
        setCategory(event.category);
        setImage(event.image);
        setTickets(event.tickets);
        setSlug(event.slug);
        setStatus(event.status);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);
  useEffect(() => {
    if (id) return;
    let active = true;
    const timer = setTimeout(
      () =>
        api<{ slug: string }>(`/organizer/slug?name=${encodeURIComponent(name || 'your-event')}`)
          .then((data) => {
            if (active) setSlug(data.slug);
          })
          .catch(() => {}),
      250,
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [name, id]);
  const upload = async (file?: File) => {
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      const data = new FormData();
      data.append('image', file);
      const result = await api<{ url: string }>('/uploads', { method: 'POST', body: data });
      setImage(result.url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  };
  const updateTicket = (index: number, patch: Partial<TicketType>) =>
    setTickets(tickets.map((t, i) => (i === index ? { ...t, ...patch } : t)));
  const save = async (nextStatus: string) => {
    setError('');
    setBusy(true);
    try {
      if (!starts) throw new Error('Choose an event date and time.');
      const event = {
        name,
        description,
        starts_at: new Date(`${starts}:00+03:00`).toISOString(),
        venue,
        city,
        category,
        image,
        status: nextStatus,
        tickets: tickets.map(({ id, name, price, capacity }) => ({ id, name, price, capacity })),
      };
      const result = await send<{ event: Event }>(
        id ? `/organizer/events/${id}` : '/organizer/events',
        event,
        id ? 'PUT' : 'POST',
      );
      if (nextStatus === 'published' && !id) setSuccess(result.event);
      else {
        notify(nextStatus === 'draft' ? 'Draft saved.' : 'Event saved.');
        navigate(`/dashboard/events/${result.event.id}`);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const previewDate = starts ? new Date(`${starts}:00+03:00`).toISOString() : '';
  return (
    <Shell title={id ? 'Edit event' : 'Create event'}>
      <Link className="back-link" to={id ? `/dashboard/events/${id}` : '/dashboard/events'}>
        <ArrowLeft size={15} />
        Back to events
      </Link>
      <div className="page-heading">
        <div>
          <h1>{id ? 'Edit your event' : 'Create an event'}</h1>
          <p>{id ? 'Event details' : 'A new moment, ready to happen.'}</p>
        </div>
        <span className="editor-step">
          <span>1</span> Event details <ArrowUpRight size={15} />
          <span>2</span> Your link
        </span>
      </div>
      {loading ? (
        <Spinner />
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save(id ? status : 'published');
          }}
        >
          <div className="editor-layout">
            <div className="editor-form">
              {error && <ErrorBox>{error}</ErrorBox>}
              <section className="form-section">
                <div className="form-section-heading">
                  <span className="section-number">01</span>
                  <h2>The essentials</h2>
                </div>
                <label>
                  Event name
                  <input
                    required
                    minLength={3}
                    maxLength={100}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Something people will remember"
                  />
                </label>
                <div className="slug-preview">
                  <span className="live-dot" />
                  <span>
                    {slug}.{config.baseDomain}
                  </span>
                </div>
                <label>
                  About the event
                  <textarea
                    required
                    minLength={10}
                    maxLength={4000}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="The music, the people, the occasion..."
                    rows={4}
                  />
                </label>
                <div className="form-row">
                  <label>
                    Date & time <span className="field-note">EAT</span>
                    <input
                      type="datetime-local"
                      required
                      value={starts}
                      onChange={(e) => setStarts(e.target.value)}
                    />
                  </label>
                  <label>
                    Category
                    <select value={category} onChange={(e) => setCategory(e.target.value)}>
                      {['Music', 'Nightlife', 'Community', 'Business', 'Arts', 'Sports'].map(
                        (x) => (
                          <option key={x}>{x}</option>
                        ),
                      )}
                    </select>
                  </label>
                </div>
                <div className="form-row">
                  <label>
                    Venue
                    <input
                      required
                      minLength={2}
                      maxLength={120}
                      value={venue}
                      onChange={(e) => setVenue(e.target.value)}
                      placeholder="Venue name or address"
                    />
                  </label>
                  <label>
                    City
                    <input
                      required
                      minLength={2}
                      maxLength={80}
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      placeholder="Dar es Salaam"
                    />
                  </label>
                </div>
              </section>
              <section className="form-section">
                <div className="form-section-heading">
                  <span className="section-number">02</span>
                  <h2>Event picture</h2>
                  <span className="optional-label">Optional</span>
                </div>
                {image ? (
                  <div className="uploaded-image">
                    <img src={image} alt="Event cover" />
                    <button
                      className="icon-button"
                      type="button"
                      title="Remove picture"
                      onClick={() => setImage('')}
                    >
                      <X size={18} />
                    </button>
                    <label className="replace-image">
                      Replace picture
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        onChange={(e) => upload(e.target.files?.[0])}
                        disabled={uploading}
                      />
                    </label>
                  </div>
                ) : (
                  <label
                    className="upload-area"
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      upload(e.dataTransfer.files[0]);
                    }}
                  >
                    {uploading ? <Loader2 size={28} className="spin" /> : <ImagePlus size={29} />}
                    <strong>{uploading ? 'Uploading picture...' : 'Choose a picture'}</strong>
                    <span>JPG, PNG, or WebP · Up to 5 MB</span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={(e) => upload(e.target.files?.[0])}
                      disabled={uploading}
                    />
                  </label>
                )}
              </section>
              <section className="form-section">
                <div className="form-section-heading">
                  <span className="section-number">03</span>
                  <h2>Tickets</h2>
                  <button
                    className="text-link"
                    type="button"
                    disabled={tickets.length >= 8}
                    onClick={() =>
                      setTickets([...tickets, { name: 'VIP', price: 50000, capacity: 50 }])
                    }
                  >
                    <Plus size={15} />
                    Add type
                  </button>
                </div>
                <p className="finance-note">
                  Golden Events keeps {config.platformFeeBps / 100}% of each new sale. Provider fees
                  are separate; your earnings and payout balance appear under Revenue.
                </p>
                <div className="ticket-editor-labels">
                  <span>Ticket name</span>
                  <span>Price (TZS)</span>
                  <span>Quantity</span>
                  <span />
                </div>
                {tickets.map((ticket, index) => (
                  <div className="ticket-editor-row" key={ticket.id || index}>
                    <label className="sr-only" htmlFor={`ticket-name-${index}`}>
                      Ticket name {index + 1}
                    </label>
                    <input
                      id={`ticket-name-${index}`}
                      required
                      value={ticket.name}
                      maxLength={40}
                      onChange={(e) => updateTicket(index, { name: e.target.value })}
                    />
                    <label className="sr-only" htmlFor={`ticket-price-${index}`}>
                      Ticket price {index + 1}
                    </label>
                    <input
                      id={`ticket-price-${index}`}
                      type="number"
                      min={100}
                      max={10000000}
                      step={100}
                      required
                      value={ticket.price}
                      onChange={(e) => updateTicket(index, { price: Number(e.target.value) })}
                    />
                    <label className="sr-only" htmlFor={`ticket-capacity-${index}`}>
                      Ticket quantity {index + 1}
                    </label>
                    <input
                      id={`ticket-capacity-${index}`}
                      type="number"
                      min={1}
                      max={100000}
                      required
                      value={ticket.capacity}
                      onChange={(e) => updateTicket(index, { capacity: Number(e.target.value) })}
                    />
                    <button
                      type="button"
                      className="icon-button"
                      disabled={tickets.length === 1}
                      aria-label={`Remove ${ticket.name} ticket type`}
                      title="Remove ticket type"
                      onClick={() => setTickets(tickets.filter((_, i) => i !== index))}
                    >
                      <Trash2 size={17} />
                    </button>
                  </div>
                ))}
              </section>
              <div className="editor-actions">
                {!id && (
                  <button
                    type="button"
                    className="button secondary"
                    disabled={busy || uploading}
                    onClick={() => {
                      const form = document.querySelector('form');
                      if (form?.reportValidity()) save('draft');
                    }}
                  >
                    Save draft
                  </button>
                )}
                <button className="button primary" disabled={busy || uploading}>
                  {busy ? (
                    <Loader2 className="spin" size={17} />
                  ) : (
                    <>
                      {id ? 'Save changes' : 'Publish event'}
                      <ArrowUpRight size={17} />
                    </>
                  )}
                </button>
              </div>
            </div>
            <aside className="editor-preview">
              <div className="preview-heading">
                <span className="eyebrow">EVENT PREVIEW</span>
                <span className="preview-pill">
                  <span />
                  Live preview
                </span>
              </div>
              <div className="preview-surface">
                <EventImage
                  event={{ image, name: name || 'Your event', category }}
                  className="preview-image"
                />
                <div className="preview-body">
                  <span className="eyebrow">{category}</span>
                  <h2>{name || 'Your event name'}</h2>
                  <p>
                    <CalendarDays size={15} />
                    {previewDate
                      ? `${dateLabel(previewDate, { year: undefined })} · ${timeLabel(previewDate)}`
                      : 'Date & time'}
                  </p>
                  <p>
                    <MapPin size={15} />
                    {venue || 'Your venue'}, {city}
                  </p>
                  <div className="preview-ticket-price">
                    <span>Tickets from</span>
                    <strong>TZS {money(Math.min(...tickets.map((t) => t.price)))}</strong>
                  </div>
                  <div className="preview-pay">
                    <span>+255</span>
                    <span>Mobile money number</span>
                  </div>
                  <div className="preview-pay-button">
                    Get a ticket
                    <ArrowUpRight size={16} />
                  </div>
                </div>
              </div>
              <div className="preview-link">
                <span>Your event link</span>
                <strong>
                  {slug}.{config.baseDomain}
                </strong>
              </div>
            </aside>
          </div>
        </form>
      )}
      {success && (
        <Modal
          title="Your event is live."
          onClose={() => navigate(`/dashboard/events/${success.id}`)}
        >
          <div className="publish-success">
            <span className="success-icon">
              <Check size={30} />
            </span>
            <h3>{success.name}</h3>
            <p>
              {dateLabel(success.starts_at)} · {success.venue}
            </p>
            <div className="published-link">{new URL(success.url).host}</div>
            <button
              className="button primary full"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(success.url);
                  setCopied(true);
                } catch {
                  notify('Select and copy the event address.');
                }
              }}
            >
              {copied ? <Check size={16} /> : <Copy size={16} />}{' '}
              {copied ? 'Link copied' : 'Copy event link'}
            </button>
            <a
              className="button secondary full"
              href={success.url}
              target="_blank"
              rel="noreferrer"
            >
              Open event
              <ExternalLink size={16} />
            </a>
            <button
              className="text-link"
              onClick={() => navigate(`/dashboard/events/${success.id}`)}
            >
              Go to event dashboard
              <ArrowRightIcon />
            </button>
          </div>
        </Modal>
      )}
    </Shell>
  );
}
function ArrowRightIcon() {
  return <ArrowUpRight size={15} />;
}
