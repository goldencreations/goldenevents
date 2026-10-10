import { useEffect, useRef, type ReactNode } from 'react';
import { Ticket, X, Loader2, ArrowUpRight, CalendarDays, MapPin } from 'lucide-react';
import { Link } from 'react-router-dom';
import { dateLabel, money } from './api';
import type { Event } from './types';

export function Brand({ light = false, ticketLogo = false }: {
  light?: boolean;
  ticketLogo?: boolean;
}) {
  if (ticketLogo) {
    return (
      <span className={`brand brand-ticket-logo ${light ? 'brand-light' : ''}`}>
        <img src="/assets/golden-ticket-symbol.png" alt="" />
        <span className="brand-wordmark">
          <span className="brand-wordmark-name">Golden</span>
          <small>events</small>
        </span>
      </span>
    );
  }

  return (
    <span className={`brand ${light ? 'brand-light' : ''}`}>
      <span className="brand-mark">
        <Ticket size={22} strokeWidth={2.4} />
      </span>
      <span>
        golden<span className="brand-dot">.</span>
        <small>EVENTS</small>
      </span>
    </span>
  );
}
export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <Loader2 className="spin" size={22} />
      <span>{label}</span>
    </div>
  );
}
export function ErrorBox({ children }: { children: ReactNode }) {
  return (
    <div className="error-box" role="alert">
      {children}
    </div>
  );
}
export function Status({ status }: { status: string }) {
  return (
    <span className={`status status-${status}`}>
      <i />
      {status === 'published'
        ? 'Live'
        : status === 'outbox'
          ? 'Saved to outbox'
          : status.replace('_', ' ')}
    </span>
  );
}
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <Ticket size={30} />
      <h3>{title}</h3>
      {children}
    </div>
  );
}
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-head">
        <h2>{title}</h2>
        <button className="icon-button" title="Close" aria-label="Close" onClick={onClose}>
          <X size={19} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function eventImageSource(image: string) {
  return image.includes('photo-1470229722913')
    ? '/assets/niffer-party.jpg'
    : image.includes('photo-1501386761578')
      ? '/assets/sunset-sessions.jpg'
      : image.includes('photo-1513364776144')
        ? '/assets/creative-table.jpg'
        : image;
}
export function EventImage({
  event,
  className = '',
}: {
  event: Pick<Event, 'image' | 'name' | 'category'>;
  className?: string;
}) {
  const local = eventImageSource(event.image);
  return local ? (
    <img className={className} src={local} alt={event.name} loading="lazy" />
  ) : (
    <div className={`image-placeholder ${className}`}>
      <Ticket size={40} />
      <span>{event.name || 'Your event'}</span>
    </div>
  );
}
export function EventCard({ event, organizer = false }: { event: Event; organizer?: boolean }) {
  return (
    <article className="event-card">
      <Link
        to={organizer ? `/dashboard/events/${event.id}` : `/e/${event.slug}`}
        className="event-card-image"
      >
        <EventImage event={event} />
        <span className="image-chip">{event.category}</span>
        {organizer && (
          <span className="image-status">
            <Status status={event.status} />
          </span>
        )}
      </Link>
      <div className="event-card-body">
        <div className="event-card-date">
          <CalendarDays size={14} />
          {dateLabel(event.starts_at, { year: undefined })}
          <span>
            {organizer
              ? `${event.sold || 0} sold`
              : `From TZS ${money(Math.min(...event.tickets.map((t) => t.price)))}`}
          </span>
        </div>
        <Link
          className="event-card-title"
          to={organizer ? `/dashboard/events/${event.id}` : `/e/${event.slug}`}
        >
          {event.name}
          <ArrowUpRight size={19} />
        </Link>
        <p>
          <MapPin size={14} />
          {event.venue}, {event.city}
        </p>
        {organizer && (
          <div className="event-card-footer">
            <span title={event.url}>{new URL(event.url).hostname}</span>
            <Link to={`/dashboard/events/${event.id}`}>
              Manage <ArrowUpRight size={13} />
            </Link>
          </div>
        )}
      </div>
    </article>
  );
}
