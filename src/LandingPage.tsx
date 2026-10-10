import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  ArrowUpRight,
  AudioLines,
  CalendarDays,
  Check,
  MapPin,
  Menu,
  Music2,
  Search,
  Ticket,
  X,
} from 'lucide-react';
import { api, dateLabel, money } from './api';
import { useApp } from './context';
import { Brand, Empty, ErrorBox, EventImage, Spinner } from './ui';
import type { Event } from './types';
import './landing.css';
import { LandingHero } from './LandingHero';

const categories = ['All', 'Music', 'Nightlife', 'Community', 'Business', 'Arts', 'Sports'];

function ListingCard({ event }: { event: Event }) {
  const price = event.tickets.length
    ? Math.min(...event.tickets.map((ticket) => ticket.price))
    : null;
  return (
    <article className="landing-event">
      <Link
        to={`/e/${event.slug}`}
        className="landing-event-cover"
        aria-label={`View ${event.name}`}
      >
        <EventImage event={event} />
        <span className="landing-event-category">{event.category}</span>
        <span className="landing-event-arrow">
          <ArrowUpRight size={20} />
        </span>
      </Link>
      <div className="landing-event-info">
        <span className="landing-event-date">
          <CalendarDays size={14} />
          {dateLabel(event.starts_at, { year: undefined })}
        </span>
        <h3>
          <Link to={`/e/${event.slug}`}>{event.name}</Link>
        </h3>
        <p>
          <MapPin size={14} />
          <span>
            {event.venue}, {event.city}
          </span>
        </p>
        <div className="landing-event-price">
          <span>
            {price === null ? 'See event for details' : price === 0 ? 'Free entry' : 'Tickets from'}
          </span>
          {price !== null && price > 0 && (
            <strong>
              <small>TZS</small> {money(price)}
            </strong>
          )}
        </div>
      </div>
    </article>
  );
}

export function Explore() {
  const { user, config } = useApp();
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  const [city, setCity] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const workspaceUrl = `${config.appOrigin}${user ? '/dashboard' : '/login'}`;

  useEffect(() => {
    const page = pageRef.current;
    if (
      !page ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
      !('IntersectionObserver' in window)
    )
      return;

    page.classList.add('scroll-reveal-enabled');
    const observed = new WeakSet<Element>();
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('scroll-reveal-visible');
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.08, rootMargin: '0px 0px -40px 0px' },
    );
    const observeTargets = (root: ParentNode) => {
      root.querySelectorAll<HTMLElement>('[data-scroll-reveal]').forEach((target) => {
        if (observed.has(target)) return;
        observed.add(target);
        observer.observe(target);
      });
    };
    observeTargets(page);

    const mutations = new MutationObserver((records) => {
      records.forEach((record) => {
        record.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          if (node.matches('[data-scroll-reveal]') && !observed.has(node)) {
            observed.add(node);
            observer.observe(node);
          }
          observeTargets(node);
        });
      });
    });
    mutations.observe(page, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      mutations.disconnect();
    };
  }, []);

  useEffect(() => {
    document.title = 'Golden Events — Good times. Great stories.';
    let active = true;
    api<{ events: Event[] }>('/events')
      .then((data) => {
        if (active) setEvents(data.events);
      })
      .catch((reason) => {
        if (active) setError(reason.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const filtered = events.filter(
    (event) =>
      (category === 'All' || event.category === category) &&
      (!city || event.city === city) &&
      `${event.name} ${event.city} ${event.venue}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  const cities = [...new Set(events.map((event) => event.city))].filter(Boolean);
  const browse = (nextCategory = 'All', nextCity = '') => {
    setCategory(nextCategory);
    setCity(nextCity);
    setQuery('');
    document.getElementById('events')?.scrollIntoView({ block: 'start' });
  };

  return (
    <div className="landing-page" id="top" ref={pageRef}>
      <a className="landing-skip" href="#events">
        Skip to events
      </a>
      <header
        className="landing-header landing-header-v2 landing-container"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && menuOpen) {
            setMenuOpen(false);
            menuRef.current?.focus();
          }
        }}
      >
        <Link to="/" aria-label="Golden Events home" className="landing-logo-link">
          <Brand ticketLogo />
        </Link>
        <nav className="landing-desktop-nav" aria-label="Main navigation">
          <a href="#events">Discover events</a>
          <a href="#experiences">Experiences</a>
          <a href="#organizers">For organizers</a>
        </nav>
        <div className="landing-header-actions">
          <button
            className="landing-icon-button landing-search-toggle"
            aria-label="Search events"
            onClick={() => {
              document.getElementById('events')?.scrollIntoView();
              searchRef.current?.focus({ preventScroll: true });
            }}
          >
            <Search size={20} />
          </button>
          <a className="landing-button landing-button-outline" href={workspaceUrl}>
            {user ? 'My workspace' : 'Create an event'}
            <ArrowUpRight size={17} />
          </a>
          <button
            ref={menuRef}
            className="landing-icon-button landing-menu-toggle"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            aria-controls="landing-mobile-nav"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            {menuOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
        {menuOpen && (
          <nav
            id="landing-mobile-nav"
            className="landing-mobile-nav"
            aria-label="Mobile navigation"
          >
            <a href="#events" onClick={() => setMenuOpen(false)}>
              Discover events
              <ArrowUpRight size={18} />
            </a>
            <a href="#experiences" onClick={() => setMenuOpen(false)}>
              Experiences
              <ArrowUpRight size={18} />
            </a>
            <a href="#organizers" onClick={() => setMenuOpen(false)}>
              For organizers
              <ArrowUpRight size={18} />
            </a>
          </nav>
        )}
      </header>

      <main>
        <LandingHero workspaceUrl={workspaceUrl} browse={browse} />

        <section
          className="landing-experiences landing-container"
          id="experiences"
          data-scroll-reveal
          aria-labelledby="experiences-title"
        >
          <div className="landing-section-heading">
            <div>
              <span className="landing-label">01 / FIND YOUR THING</span>
              <h2 id="experiences-title">
                Whatever your mood.
                <br />
                There’s a moment for it.
              </h2>
            </div>
            <p>
              Turn an ordinary day into a story worth telling.
              <br />
              Start with what moves you.
            </p>
          </div>
          <div className="landing-category-grid">
            <button className="landing-category category-blue" onClick={() => browse('Music')}>
              <span className="category-symbol">
                <Music2 size={30} />
              </span>
              <AudioLines className="category-watermark" aria-hidden="true" />
              <span className="category-bottom">
                <span>
                  <strong>Feel the music.</strong>
                  <small>Live sets. Big voices. Your kind of sound.</small>
                </span>
                <ArrowUpRight size={25} />
              </span>
            </button>
            <button
              className="landing-category category-yellow"
              onClick={() => browse('Nightlife')}
            >
              <span className="category-symbol">
                <AudioLines size={30} />
              </span>
              <AudioLines className="category-watermark" aria-hidden="true" />
              <span className="category-bottom">
                <span>
                  <strong>Own the night.</strong>
                  <small>Good company. Late nights. One more song.</small>
                </span>
                <ArrowUpRight size={25} />
              </span>
            </button>
            <button className="landing-category category-peach" onClick={() => browse('Community')}>
              <span className="category-symbol">
                <Ticket size={30} />
              </span>
              <Ticket className="category-watermark" aria-hidden="true" />
              <span className="category-bottom">
                <span>
                  <strong>Come together.</strong>
                  <small>Fresh faces. Shared passions. Real connection.</small>
                </span>
                <ArrowUpRight size={25} />
              </span>
            </button>
          </div>
        </section>

        <section
          className="landing-listings"
          id="events"
          data-scroll-reveal
          aria-labelledby="events-title"
        >
          <div className="landing-container">
            <div className="landing-section-heading">
              <div>
                <span className="landing-label">02 / OUT OF THE GROUP CHAT</span>
                <h2 id="events-title">
                  Your next “you had
                  <br />
                  to be there.”
                </h2>
              </div>
              <div className="landing-search">
                <Search size={19} />
                <input
                  ref={searchRef}
                  aria-label="Search public events"
                  placeholder="Event, venue, or city"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
                {query && (
                  <button
                    className="landing-icon-button"
                    aria-label="Clear search"
                    onClick={() => setQuery('')}
                  >
                    <X size={16} />
                  </button>
                )}
              </div>
            </div>
            <div className="landing-filters" role="group" aria-label="Event category">
              {categories.map((item) => (
                <button
                  key={item}
                  aria-pressed={category === item}
                  onClick={() => setCategory(item)}
                >
                  {item === 'All' ? 'All events' : item}
                </button>
              ))}
            </div>
            {city && (
              <button
                className="landing-city-filter"
                onClick={() => setCity('')}
                aria-label={`Clear ${city} city filter`}
              >
                <MapPin size={14} />
                {city}
                <X size={14} />
              </button>
            )}
            <p className="sr-only" role="status">
              {loading ? 'Loading events' : `${filtered.length} events found`}
            </p>
            {loading ? (
              <Spinner label="Finding your next moment" />
            ) : error ? (
              <ErrorBox>{error}</ErrorBox>
            ) : filtered.length ? (
              <div className="landing-listing-grid">
                {filtered.map((event) => (
                  <ListingCard event={event} key={event.id} />
                ))}
                <a href={workspaceUrl} className="landing-host-card">
                  <span className="landing-label">MAKE SOMETHING HAPPEN</span>
                  <h3>
                    Your crowd.
                    <br />
                    Your idea.
                    <br />
                    Your event.
                  </h3>
                  <Ticket size={100} strokeWidth={1} aria-hidden="true" />
                  <span>
                    Create an event
                    <span className="landing-round-arrow">
                      <ArrowUpRight size={20} />
                    </span>
                  </span>
                </a>
              </div>
            ) : (
              <div className="landing-empty">
                <Empty title="No events found">
                  <p>Try another category, city, or search. Your next moment is out there.</p>
                </Empty>
                <button
                  className="landing-button landing-button-outline"
                  onClick={() => {
                    setCategory('All');
                    setCity('');
                    setQuery('');
                  }}
                >
                  Show all events
                  <ArrowRight size={16} />
                </button>
              </div>
            )}
          </div>
        </section>

        <section
          className="landing-organizers"
          id="organizers"
          data-scroll-reveal
          aria-labelledby="organizer-title"
        >
          <div className="landing-container landing-organizer-grid">
            <div className="landing-organizer-photo">
              <img
                src="/assets/sunset-sessions.jpg"
                alt="An enthusiastic crowd enjoying a live music event"
                loading="lazy"
                width={700}
                height={800}
              />
              <span className="organizer-photo-label">
                <span>
                  MADE FOR PEOPLE.
                  <br />
                  BROUGHT TO LIFE BY YOU.
                </span>
                <ArrowUpRight size={28} />
              </span>
            </div>
            <div className="landing-organizer-copy">
              <span className="landing-label">03 / FOR THE MOMENT MAKERS</span>
              <h2 id="organizer-title">
                You bring
                <br />
                the spark.
                <br />
                <span>
                  We’ll bring
                  <br />
                  the tickets.
                </span>
              </h2>
              <p>
                From an intimate gathering to a sold-out night. Create your event, share the link,
                and welcome your people.
              </p>
              <a className="landing-button landing-button-orange" href={workspaceUrl}>
                Let’s make it happen
                <ArrowUpRight size={18} />
              </a>
              <div className="organizer-features">
                <span>
                  <Check size={15} />
                  Mobile money payments
                </span>
                <span>
                  <Check size={15} />
                  QR code check-in
                </span>
              </div>
            </div>
          </div>
        </section>

        {cities.length > 0 && (
          <section
            className="landing-cities landing-container"
            data-scroll-reveal
            aria-labelledby="cities-title"
          >
            <div>
              <span className="landing-label">04 / A LITTLE CLOSER TO YOU</span>
              <h2 id="cities-title">
                Good things.
                <br />
                Right around you.
              </h2>
              <p>
                Discover the people and places
                <br />
                making your city come alive.
              </p>
            </div>
            <div className="landing-city-list">
              {cities.map((name, index) => (
                <button key={name} onClick={() => browse('All', name)}>
                  <span className="city-number">0{index + 1}</span>
                  <span>
                    <strong>{name}</strong>
                    <small>
                      {events.filter((event) => event.city === name).length} upcoming events ·
                      Tanzania
                    </small>
                  </span>
                  <ArrowUpRight size={27} />
                </button>
              ))}
              <span className="landing-city-note">
                <MapPin size={15} />
                Local energy. Unforgettable experiences.
              </span>
            </div>
          </section>
        )}
      </main>

      <footer className="landing-footer" data-scroll-reveal>
        <div className="landing-container">
          <div className="landing-footer-top">
            <span className="landing-label">MAKE ROOM FOR A GOOD TIME.</span>
            <span>DAR ES SALAAM, TANZANIA</span>
          </div>
          <div className="landing-footer-invitation">
            <h2>
              See you
              <br />
              <span>out there.</span>
            </h2>
            <a href="#events" className="landing-footer-ticket">
              <Ticket size={25} />
              <span>
                Your next story
                <br />
                <strong>starts with a ticket.</strong>
              </span>
              <ArrowUpRight size={28} />
            </a>
          </div>
          <div className="landing-colophon">
            <Link to="/" aria-label="Golden Events home">
              <Brand light ticketLogo />
            </Link>
            <span>© {new Date().getFullYear()} Golden Creation</span>
            <a href={`${config.publicOrigin}/status`}>
              System status
              <ArrowUpRight size={14} />
            </a>
            <a href="#top" className="landing-back-top">
              Back to top
              <ArrowUpRight size={16} />
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
