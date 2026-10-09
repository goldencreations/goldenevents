import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  CalendarDays,
  ShoppingBag,
  Users,
  ChartNoAxesCombined,
  Send,
  Settings,
  ShieldCheck,
  Plus,
  Search,
  Menu,
  X,
  ArrowUpRight,
  ArrowRight,
  Ticket,
  Banknote,
  ScanLine,
  LogOut,
  Download,
  Copy,
  ExternalLink,
  Mail,
  Smartphone,
  MessageCircle,
  RefreshCw,
  Loader2,
  Check,
  ChevronDown,
  Clock,
  MapPin,
} from 'lucide-react';
import { api, send, money, dateLabel, timeLabel, shortPhone, downloadCSV } from './api';
import { useApp } from './context';
import { Brand, Spinner, ErrorBox, Status, Empty, EventCard, EventImage, Modal } from './ui';
import type { Event, Order, Guest, Delivery, Stats, User } from './types';

const navigation = [
  { to: '/dashboard', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/dashboard/events', label: 'Events', icon: CalendarDays },
  { to: '/dashboard/orders', label: 'Orders', icon: ShoppingBag },
  { to: '/dashboard/guests', label: 'Guests', icon: Users },
  { to: '/dashboard/revenue', label: 'Revenue', icon: ChartNoAxesCombined },
  { to: '/dashboard/delivery', label: 'Delivery', icon: Send },
];

export function Shell({ children, title = 'Overview' }: { children: ReactNode; title?: string }) {
  const { user, config, setUser } = useApp(),
    navigate = useNavigate(),
    location = useLocation();
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(''),
    [found, setFound] = useState<Event[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setOpen(false);
    setQuery('');
  }, [location.pathname]);
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);
  useEffect(() => {
    if (!query.trim()) {
      setFound([]);
      return;
    }
    let active = true;
    const timer = setTimeout(
      () =>
        api<{ events: Event[] }>('/organizer/events')
          .then((data) => {
            if (active)
              setFound(
                data.events
                  .filter((e) => e.name.toLowerCase().includes(query.toLowerCase()))
                  .slice(0, 5),
              );
          })
          .catch(() => setFound([])),
      200,
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query]);
  const logout = async () => {
    await send('/auth/logout', {});
    setUser(null);
    navigate('/login');
  };
  return (
    <div className="workspace">
      {open && (
        <button
          className="sidebar-scrim"
          aria-label="Close navigation"
          onClick={() => setOpen(false)}
        />
      )}
      <aside className={`sidebar ${open ? 'is-open' : ''}`}>
        <Link to="/dashboard" className="sidebar-brand">
          <Brand />
        </Link>
        <div className="workspace-selector">
          <span className="workspace-avatar">
            {(user?.organization || 'Golden Creation').slice(0, 1)}
          </span>
          <span>
            {user?.organization || 'My workspace'}
            <small>Organizer workspace</small>
          </span>
          <ChevronDown size={15} />
        </div>
        <span className="nav-section">WORKSPACE</span>
        <nav>
          {navigation.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end}>
              <Icon size={18} />
              {label}
              {label === 'Events' && <span className="nav-dot" />}
            </NavLink>
          ))}
          <NavLink to="/dashboard/scan">
            <ScanLine size={18} />
            Gate scanner
          </NavLink>
        </nav>
        <div className="sidebar-bottom">
          <NavLink to="/dashboard/settings">
            <Settings size={18} />
            Settings
          </NavLink>
          {user?.role === 'admin' && (
            <NavLink to="/dashboard/admin">
              <ShieldCheck size={18} />
              Administration
            </NavLink>
          )}
          <Link to="/">
            <ExternalLink size={18} />
            Explore events
          </Link>
          {config.demo && (
            <div className="demo-label">
              <span />
              Demo workspace
            </div>
          )}
          <div className="profile">
            <span className="profile-avatar">
              {user?.name
                .split(' ')
                .map((x) => x[0])
                .slice(0, 2)
                .join('')}
            </span>
            <span>
              {user?.name}
              <small>{user?.role === 'admin' ? 'Administrator' : 'Organizer'}</small>
            </span>
            <button className="icon-button" title="Sign out" aria-label="Sign out" onClick={logout}>
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <div className="workspace-main">
        <header className="topbar">
          <div className="breadcrumbs">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setOpen(true)}
            >
              <Menu size={21} />
            </button>
            <span>Workspace</span>
            <span className="breadcrumb-slash">/</span>
            <strong>{title}</strong>
          </div>
          <div className="topbar-right">
            <div className="global-search">
              <Search size={16} />
              <input
                ref={searchRef}
                aria-label="Search events"
                placeholder="Search events..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query && (
                <div className="search-results">
                  {found.length ? (
                    found.map((event) => (
                      <Link
                        key={event.id}
                        to={`/dashboard/events/${event.id}`}
                        onClick={() => setQuery('')}
                      >
                        <CalendarDays size={16} />
                        <span>
                          {event.name}
                          <small>{dateLabel(event.starts_at)}</small>
                        </span>
                        <ArrowUpRight size={15} />
                      </Link>
                    ))
                  ) : (
                    <span>No matching events</span>
                  )}
                </div>
              )}
            </div>
            <Link
              className="icon-button notification-button"
              to="/dashboard/delivery"
              title="Ticket delivery"
              aria-label="Ticket delivery"
            >
              <Send size={18} />
            </Link>
            <span className="topbar-avatar">{user?.name.slice(0, 1)}</span>
          </div>
        </header>
        <main className="dashboard-content">{children}</main>
        <footer className="workspace-footer">
          <span>© {new Date().getFullYear()} Golden Creation</span>
          <span>
            <i />
            All times in East Africa Time
          </span>
        </footer>
      </div>
    </div>
  );
}

export function Dashboard() {
  const location = useLocation(),
    { user } = useApp();
  const path = location.pathname.replace('/dashboard', '');
  const title = path.startsWith('/events')
    ? 'Events'
    : path === '/orders'
      ? 'Orders'
      : path === '/guests'
        ? 'Guests'
        : path === '/revenue'
          ? 'Revenue'
          : path === '/delivery'
            ? 'Delivery'
            : path === '/settings'
              ? 'Settings'
              : path === '/admin'
                ? 'Administration'
                : 'Overview';
  const [data, setData] = useState<{
      events: Event[];
      orders: Order[];
      stats: Stats;
      guests: Guest[];
      deliveries: Delivery[];
    } | null>(null),
    [error, setError] = useState('');
  const load = async () => {
    try {
      const [events, orders, stats, guests, deliveries] = await Promise.all([
        api<{ events: Event[] }>('/organizer/events'),
        api<{ orders: Order[] }>('/organizer/orders'),
        api<Stats>('/organizer/stats'),
        api<{ guests: Guest[] }>('/organizer/guests'),
        api<{ deliveries: Delivery[] }>('/organizer/deliveries'),
      ]);
      setData({
        events: events.events,
        orders: orders.orders,
        stats,
        guests: guests.guests,
        deliveries: deliveries.deliveries,
      });
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    load();
  }, [location.pathname]);
  const detailId = path.match(/^\/events\/([^/]+)$/)?.[1];
  return (
    <Shell title={title}>
      {error ? (
        <ErrorBox>
          {error}
          <button onClick={load}>Retry</button>
        </ErrorBox>
      ) : !data ? (
        <Spinner />
      ) : path === '/orders' ? (
        <OrdersPage orders={data.orders} events={data.events} reload={load} />
      ) : path === '/guests' ? (
        <GuestsPage guests={data.guests} events={data.events} />
      ) : path === '/revenue' ? (
        <RevenuePage stats={data.stats} orders={data.orders} />
      ) : path === '/delivery' ? (
        <DeliveryPage deliveries={data.deliveries} reload={load} />
      ) : path === '/settings' ? (
        <SettingsPage />
      ) : path === '/admin' ? (
        <AdminPage />
      ) : detailId ? (
        <EventDetail
          event={data.events.find((e) => e.id === detailId)}
          orders={data.orders}
          reload={load}
        />
      ) : path === '/events' ? (
        <EventsPage events={data.events} />
      ) : (
        <Overview {...data} name={user?.name.split(' ')[0] || 'there'} />
      )}
    </Shell>
  );
}

function PageHeading({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      <div className="heading-actions">{children}</div>
    </div>
  );
}
function StatGrid({ stats }: { stats: Stats }) {
  const cards = [
    {
      label: 'Gross ticket sales',
      value: `TZS ${money(stats.revenue)}`,
      icon: Banknote,
      color: 'mint',
      note: `${stats.paid_orders} paid orders`,
    },
    {
      label: 'Tickets sold',
      value: money(stats.sold),
      icon: Ticket,
      color: 'yellow',
      note: 'Across all your events',
    },
    {
      label: 'Live events',
      value: String(stats.live_events),
      icon: CalendarDays,
      color: 'peach',
      note: `${stats.events} events in your workspace`,
    },
    {
      label: 'Guests checked in',
      value: money(stats.checked_in),
      icon: Users,
      color: 'blue',
      note: `${Math.max(0, stats.sold - stats.checked_in)} yet to arrive`,
    },
  ];
  return (
    <div className="stat-grid">
      {cards.map(({ label, value, icon: Icon, color, note }) => (
        <div className="stat" key={label}>
          <div className="stat-head">
            <span>{label}</span>
            <span className={`stat-icon ${color}`}>
              <Icon size={18} />
            </span>
          </div>
          <strong>{value}</strong>
          <small>{note}</small>
        </div>
      ))}
    </div>
  );
}
function SalesChart({ stats }: { stats: Stats }) {
  const max = Math.max(1, ...stats.chart.map((d) => d.revenue)),
    total = stats.chart.reduce((s, d) => s + d.revenue, 0);
  return (
    <div className="sales-chart">
      <div className="section-heading">
        <div>
          <h2>Sales this week</h2>
          <p>
            <strong>TZS {money(total)}</strong>
            <span className="muted"> · Last 7 days</span>
          </p>
        </div>
        <Link to="/dashboard/revenue">
          View report
          <ArrowUpRight size={15} />
        </Link>
      </div>
      <div className="chart-area">
        <div className="chart-axis">
          <span>{money(max)}</span>
          <span>{money(Math.round(max / 2))}</span>
          <span>0</span>
        </div>
        <div className="chart-bars">
          {stats.chart.map((day) => (
            <div className="chart-column" key={day.date}>
              <div className="bar-track">
                <div
                  className="chart-bar"
                  style={{ height: `${Math.max(2, (day.revenue / max) * 100)}%` }}
                  title={`TZS ${money(day.revenue)} · ${day.tickets} tickets`}
                />
              </div>
              <span>
                {new Date(`${day.date}T12:00:00Z`).toLocaleDateString('en-GB', {
                  weekday: 'short',
                })}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
function Overview({
  name,
  events,
  orders,
  stats,
}: {
  name: string;
  events: Event[];
  orders: Order[];
  stats: Stats;
}) {
  const upcoming = events
    .filter((e) => e.status === 'published' && new Date(e.starts_at) > new Date())
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const next = upcoming[0];
  const hour = Number(
    new Date().toLocaleTimeString('en-GB', {
      timeZone: 'Africa/Dar_es_Salaam',
      hour: '2-digit',
      hour12: false,
    }),
  );
  return (
    <>
      <PageHeading
        title={`Good ${hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'}, ${name}`}
        subtitle={dateLabel(new Date().toISOString(), { weekday: 'long' })}
      >
        <Link className="button primary" to="/dashboard/events/new">
          <Plus size={17} />
          Create event
        </Link>
      </PageHeading>
      <StatGrid stats={stats} />
      {stats.review > 0 && (
        <ErrorBox>
          {stats.review} payment{stats.review > 1 ? 's' : ''} need review. Open Orders to resolve
          them.
        </ErrorBox>
      )}
      <div className="overview-middle">
        <SalesChart stats={stats} />
        <div className="next-event">
          <div className="section-heading">
            <h2>Up next</h2>
            <Link to="/dashboard/events">
              All events
              <ArrowUpRight size={15} />
            </Link>
          </div>
          {next ? (
            <>
              <Link to={`/dashboard/events/${next.id}`} className="next-event-photo">
                <EventImage event={next} />
                <span className="date-stamp">
                  <strong>
                    {new Date(next.starts_at).toLocaleDateString('en-GB', {
                      day: '2-digit',
                      timeZone: 'Africa/Dar_es_Salaam',
                    })}
                  </strong>
                  <span>
                    {new Date(next.starts_at).toLocaleDateString('en-GB', {
                      month: 'short',
                      timeZone: 'Africa/Dar_es_Salaam',
                    })}
                  </span>
                </span>
              </Link>
              <div className="next-event-info">
                <div>
                  <span className="eyebrow">{next.category}</span>
                  <h3>{next.name}</h3>
                  <p>
                    <MapPin size={13} />
                    {next.venue}
                  </p>
                </div>
                <Link
                  className="icon-button round-arrow"
                  to={`/dashboard/events/${next.id}`}
                  title="Manage event"
                >
                  <ArrowUpRight size={20} />
                </Link>
              </div>
              <div className="capacity-line">
                <span>{next.sold} tickets sold</span>
                <span>{next.tickets.reduce((n, t) => n + t.capacity, 0)} capacity</span>
              </div>
              <div className="progress">
                <span
                  style={{
                    width: `${((next.sold || 0) / next.tickets.reduce((n, t) => n + t.capacity, 0)) * 100}%`,
                  }}
                />
              </div>
            </>
          ) : (
            <Empty title="Your next event starts here">
              <Link to="/dashboard/events/new" className="text-link">
                Create an event
                <ArrowRight size={15} />
              </Link>
            </Empty>
          )}
        </div>
      </div>
      <div className="section-heading table-section-heading">
        <h2>
          Recent orders <span className="count-pill">{orders.length}</span>
        </h2>
        <Link to="/dashboard/orders">
          View all orders
          <ArrowUpRight size={15} />
        </Link>
      </div>
      <OrdersTable orders={orders.slice(0, 5)} />
      <div className="section-heading event-section-heading">
        <h2>Your events</h2>
        <Link to="/dashboard/events">
          View all events
          <ArrowUpRight size={15} />
        </Link>
      </div>
      <div className="event-grid">
        {events.slice(0, 3).map((event) => (
          <EventCard key={event.id} event={event} organizer />
        ))}
        {!events.length && <Empty title="No events yet" />}
      </div>
    </>
  );
}
function EventsPage({ events }: { events: Event[] }) {
  const [tab, setTab] = useState('all'),
    [search, setSearch] = useState('');
  const filtered = events.filter(
    (e) =>
      (tab === 'all' || e.status === tab) &&
      `${e.name} ${e.venue}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <PageHeading title="Events" subtitle={`${events.length} events in your workspace`}>
        <Link className="button primary" to="/dashboard/events/new">
          <Plus size={17} />
          Create event
        </Link>
      </PageHeading>
      <div className="list-toolbar">
        <div className="tabs" role="tablist" aria-label="Event status">
          {[
            ['all', 'All events'],
            ['published', 'Live'],
            ['draft', 'Drafts'],
            ['paused', 'Paused'],
            ['cancelled', 'Cancelled'],
          ].map(([key, label]) => (
            <button
              role="tab"
              aria-selected={tab === key}
              className={tab === key ? 'active' : ''}
              key={key}
              onClick={() => setTab(key)}
            >
              {label}
              <span>{events.filter((e) => key === 'all' || e.status === key).length}</span>
            </button>
          ))}
        </div>
        <div className="filter-search">
          <Search size={16} />
          <input
            placeholder="Find an event"
            aria-label="Find an event"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>
      {filtered.length ? (
        <div className="event-grid">
          {filtered.map((event) => (
            <EventCard key={event.id} event={event} organizer />
          ))}
        </div>
      ) : (
        <Empty title="No events here yet">
          <Link to="/dashboard/events/new" className="button primary">
            <Plus size={16} />
            Create event
          </Link>
        </Empty>
      )}
    </>
  );
}
function OrdersTable({ orders, onSelect }: { orders: Order[]; onSelect?: (order: Order) => void }) {
  return orders.length ? (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Order</th>
            <th>Event</th>
            <th>Customer</th>
            <th>Tickets</th>
            <th>Amount</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr key={order.id}>
              <td>
                <strong className="mono">{order.reference}</strong>
                <small>
                  {dateLabel(order.created_at, { year: undefined })} · {timeLabel(order.created_at)}
                </small>
              </td>
              <td>
                <strong>{order.event_name}</strong>
                <small>{order.ticket_type}</small>
              </td>
              <td>
                {shortPhone(order.phone)}
                <small>{order.email || '—'}</small>
              </td>
              <td>{order.quantity}</td>
              <td className="nowrap">TZS {money(order.amount)}</td>
              <td>
                <Status status={order.status} />
              </td>
              <td>
                {onSelect ? (
                  <button
                    className="icon-button"
                    title="View order"
                    aria-label={`View order ${order.reference}`}
                    onClick={() => onSelect(order)}
                  >
                    <ArrowUpRight size={17} />
                  </button>
                ) : (
                  <Link className="icon-button" to="/dashboard/orders" title="View orders">
                    <ArrowUpRight size={17} />
                  </Link>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty title="No orders yet" />
  );
}
function OrdersPage({
  orders,
  events,
  reload,
}: {
  orders: Order[];
  events: Event[];
  reload: () => void;
}) {
  const { notify } = useApp();
  const [search, setSearch] = useState(''),
    [event, setEvent] = useState('all'),
    [status, setStatus] = useState('all'),
    [selected, setSelected] = useState<Order | null>(null),
    [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const filtered = orders.filter(
    (o) =>
      (event === 'all' || o.event_id === event) &&
      (status === 'all' || o.status === status) &&
      `${o.reference} ${o.phone} ${o.email}`.toLowerCase().includes(search.toLowerCase()),
  );
  const refund = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await send(`/organizer/orders/${selected.id}/refund`, {});
      setSelected(null);
      setConfirm(false);
      reload();
      notify('Demo order refunded. Tickets are no longer valid.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeading
        title="Orders"
        subtitle={`${orders.length} orders · ${orders.filter((o) => o.status === 'paid').length} paid`}
      >
        <button
          className="button secondary"
          onClick={() =>
            downloadCSV('golden-orders.csv', [
              ['Reference', 'Event', 'Phone', 'Email', 'Tickets', 'Amount TZS', 'Status', 'Date'],
              ...filtered.map((o) => [
                o.reference,
                o.event_name,
                o.phone,
                o.email,
                o.quantity,
                o.amount,
                o.status,
                o.created_at,
              ]),
            ])
          }
        >
          <Download size={16} />
          Export
        </button>
      </PageHeading>
      <div className="filters">
        <div className="filter-search">
          <Search size={16} />
          <input
            aria-label="Search orders"
            placeholder="Search reference or customer"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          aria-label="Filter orders by event"
          value={event}
          onChange={(e) => setEvent(e.target.value)}
        >
          <option value="all">All events</option>
          {events.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter orders by status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="all">All statuses</option>
          {['paid', 'pending', 'failed', 'expired', 'refunded', 'review'].map((s) => (
            <option key={s} value={s}>
              {s[0].toUpperCase() + s.slice(1)}
            </option>
          ))}
        </select>
      </div>
      <OrdersTable
        orders={filtered}
        onSelect={(order) => {
          setSelected(order);
          setError('');
          setConfirm(false);
        }}
      />
      {selected && (
        <Modal title={selected.reference} onClose={() => setSelected(null)}>
          <div className="order-details">
            <Status status={selected.status} />
            <h3>{selected.event_name}</h3>
            <dl>
              <dt>Ticket</dt>
              <dd>
                {selected.quantity} × {selected.ticket_type}
              </dd>
              <dt>Amount</dt>
              <dd>TZS {money(selected.amount)}</dd>
              <dt>Phone</dt>
              <dd>{selected.phone}</dd>
              <dt>Payment</dt>
              <dd>{selected.provider === 'demo' ? 'Demo payment' : 'Mobile money'}</dd>
            </dl>
            {error && <ErrorBox>{error}</ErrorBox>}
            <Link className="button primary full" to={`/order/${selected.token}`} target="_blank">
              Open customer order
              <ExternalLink size={16} />
            </Link>
            {selected.status === 'paid' &&
              (confirm ? (
                <div className="refund-confirm">
                  <p>Refund this demo order and invalidate its tickets?</p>
                  <button className="button danger" onClick={refund} disabled={busy}>
                    {busy ? <Loader2 size={16} className="spin" /> : 'Confirm refund'}
                  </button>
                  <button className="button" onClick={() => setConfirm(false)}>
                    Keep order
                  </button>
                </div>
              ) : (
                <button className="button secondary full" onClick={() => setConfirm(true)}>
                  {selected.provider === 'demo' ? 'Refund demo order' : 'Request refund'}
                </button>
              ))}
          </div>
        </Modal>
      )}
    </>
  );
}
function GuestsPage({ guests, events }: { guests: Guest[]; events: Event[] }) {
  const [query, setQuery] = useState(''),
    [event, setEvent] = useState('all'),
    [status, setStatus] = useState('all');
  const filtered = guests.filter(
    (g) =>
      (event === 'all' || g.event_id === event) &&
      (status === 'all' || (status === 'in') === !!g.checked_in_at) &&
      `${g.code} ${g.holder_name} ${g.phone} ${g.email} ${g.reference}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <>
      <PageHeading
        title="Guests"
        subtitle={`${guests.length} tickets · ${guests.filter((g) => g.checked_in_at).length} checked in`}
      >
        <button
          className="button secondary"
          onClick={() =>
            downloadCSV('golden-guests.csv', [
              ['Code', 'Event', 'Guest', 'Phone', 'Email', 'Ticket', 'Booking', 'Checked in'],
              ...filtered.map((g) => [
                g.code,
                g.event_name,
                g.holder_name,
                g.phone,
                g.email,
                g.ticket_type,
                g.reference,
                g.checked_in_at || '',
              ]),
            ])
          }
        >
          <Download size={16} />
          Export
        </button>
        <Link className="button primary" to="/dashboard/scan">
          <ScanLine size={17} />
          Open scanner
        </Link>
      </PageHeading>
      <div className="filters">
        <div className="filter-search">
          <Search size={16} />
          <input
            aria-label="Search guests"
            placeholder="Search guest, phone or ticket code"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <select aria-label="Guest event" value={event} onChange={(e) => setEvent(e.target.value)}>
          <option value="all">All events</option>
          {events.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Guest admission"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="all">All guests</option>
          <option value="in">Checked in</option>
          <option value="out">Not arrived</option>
        </select>
      </div>
      {filtered.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Ticket code</th>
                <th>Guest</th>
                <th>Event</th>
                <th>Ticket</th>
                <th>Admission</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((g) => (
                <tr key={g.code}>
                  <td className="mono">{g.code}</td>
                  <td>
                    {g.holder_name || shortPhone(g.phone)}
                    <small>{g.holder_name ? shortPhone(g.phone) : g.email || '—'}</small>
                  </td>
                  <td>{g.event_name}</td>
                  <td>{g.ticket_type}</td>
                  <td>
                    <Status status={g.checked_in_at ? 'checked_in' : 'not_arrived'} />
                    {g.checked_in_at && <small>{timeLabel(g.checked_in_at)}</small>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty title="No matching guests" />
      )}
    </>
  );
}
function RevenuePage({ stats, orders }: { stats: Stats; orders: Order[] }) {
  const { config } = useApp();
  const paid = orders.filter((o) => o.status === 'paid'),
    refunded = orders.filter((o) => o.status === 'refunded');
  return (
    <>
      <PageHeading title="Revenue" subtitle="Ticket sales and payment activity">
        <button
          className="button secondary"
          onClick={() =>
            downloadCSV('golden-revenue.csv', [
              ['Reference', 'Event', 'Gross TZS', 'Status', 'Date'],
              ...orders.map((o) => [o.reference, o.event_name, o.amount, o.status, o.created_at]),
            ])
          }
        >
          <Download size={16} />
          Export report
        </button>
      </PageHeading>
      <StatGrid stats={stats} />
      {config.demo && (
        <div className="notice">
          <Banknote size={19} />
          <span>These are simulated sales. No money has been collected or paid out.</span>
        </div>
      )}
      <SalesChart stats={stats} />
      <div className="revenue-summary">
        <div>
          <span>Paid orders</span>
          <strong>{paid.length}</strong>
        </div>
        <div>
          <span>Gross ticket sales</span>
          <strong>TZS {money(stats.revenue)}</strong>
        </div>
        <div>
          <span>Refunded orders</span>
          <strong>TZS {money(refunded.reduce((n, o) => n + o.amount, 0))}</strong>
        </div>
        <div>
          <span>Organizer payouts</span>
          <strong className="muted">Not connected</strong>
        </div>
      </div>
      <div className="section-heading table-section-heading">
        <h2>Payment history</h2>
      </div>
      <OrdersTable orders={orders} />
    </>
  );
}
function DeliveryPage({ deliveries, reload }: { deliveries: Delivery[]; reload: () => void }) {
  const { config, notify } = useApp();
  const [filter, setFilter] = useState('all'),
    [selected, setSelected] = useState<Delivery | null>(null),
    [error, setError] = useState('');
  const icons = { sms: Smartphone, email: Mail, whatsapp: MessageCircle };
  const retry = async (d: Delivery) => {
    try {
      await send(`/organizer/deliveries/${d.id}/retry`, {});
      notify('Message queued again.');
      reload();
      setSelected(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <>
      <PageHeading title="Ticket delivery" subtitle={`${deliveries.length} messages`}>
        <button className="button secondary" onClick={reload}>
          <RefreshCw size={16} />
          Refresh
        </button>
      </PageHeading>
      {config.deliveryDriver === 'outbox' && (
        <div className="notice">
          <Send size={19} />
          <span>
            Messages are saved to the local outbox. Email, SMS, and WhatsApp sending is not
            connected.
          </span>
        </div>
      )}
      <div className="tabs delivery-tabs" role="tablist" aria-label="Delivery channel">
        {['all', 'sms', 'email', 'whatsapp'].map((channel) => (
          <button
            role="tab"
            aria-selected={filter === channel}
            className={filter === channel ? 'active' : ''}
            key={channel}
            onClick={() => setFilter(channel)}
          >
            {channel === 'all'
              ? 'All channels'
              : channel === 'sms'
                ? 'SMS'
                : channel === 'whatsapp'
                  ? 'WhatsApp'
                  : 'Email'}
          </button>
        ))}
      </div>
      {deliveries.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Channel</th>
                <th>Recipient</th>
                <th>Event</th>
                <th>Status</th>
                <th>Date</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {deliveries
                .filter((d) => filter === 'all' || d.channel === filter)
                .map((d) => {
                  const Icon = icons[d.channel as keyof typeof icons] || Send;
                  return (
                    <tr key={d.id}>
                      <td>
                        <span className="channel">
                          <Icon size={16} />
                          {d.channel === 'sms'
                            ? 'SMS'
                            : d.channel === 'whatsapp'
                              ? 'WhatsApp'
                              : 'Email'}
                        </span>
                      </td>
                      <td>
                        {d.recipient}
                        <small>{d.reference}</small>
                      </td>
                      <td>{d.event_name}</td>
                      <td>
                        <Status status={d.status} />
                      </td>
                      <td>{dateLabel(d.created_at, { year: undefined })}</td>
                      <td>
                        <button
                          className="icon-button"
                          title="View message"
                          aria-label={`View message to ${d.recipient}`}
                          onClick={() => {
                            setSelected(d);
                            setError('');
                          }}
                        >
                          <ArrowUpRight size={17} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty title="No ticket messages yet" />
      )}
      {selected && (
        <Modal title="Ticket message" onClose={() => setSelected(null)}>
          <div className="message-preview">
            <Status status={selected.status} />
            <p className="muted">To {selected.recipient}</p>
            <blockquote>{selected.body}</blockquote>
            {selected.error && <ErrorBox>{selected.error}</ErrorBox>}
            {error && <ErrorBox>{error}</ErrorBox>}
            <button className="button secondary full" onClick={() => retry(selected)}>
              <RefreshCw size={16} />
              Queue again
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
function EventDetail({
  event,
  orders,
  reload,
}: {
  event?: Event;
  orders: Order[];
  reload: () => void;
}) {
  const { notify } = useApp();
  const [error, setError] = useState(''),
    [confirm, setConfirm] = useState(false);
  if (!event) return <Empty title="Event not found" />;
  const setStatus = async (status: string) => {
    try {
      await send(`/organizer/events/${event.id}`, { ...event, status }, 'PUT');
      setConfirm(false);
      reload();
      notify(
        status === 'cancelled'
          ? 'Event cancelled.'
          : status === 'published'
            ? 'Event is live.'
            : 'Ticket sales paused.',
      );
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const capacity = event.tickets.reduce((n, t) => n + t.capacity, 0);
  return (
    <>
      <div className="back-row">
        <Link to="/dashboard/events">← Events</Link>
        <Status status={event.status} />
      </div>
      <PageHeading
        title={event.name}
        subtitle={`${dateLabel(event.starts_at)} · ${timeLabel(event.starts_at)} EAT`}
      >
        <Link className="button secondary" to={`/dashboard/events/${event.id}/edit`}>
          Edit event
        </Link>
        {event.status === 'published' ? (
          <button className="button secondary" onClick={() => setStatus('paused')}>
            Pause sales
          </button>
        ) : (
          event.status !== 'cancelled' && (
            <button className="button primary" onClick={() => setStatus('published')}>
              Publish event
              <ArrowUpRight size={16} />
            </button>
          )
        )}
        <Link className="button primary" to={`/dashboard/scan?event=${event.id}`}>
          <ScanLine size={17} />
          Scan tickets
        </Link>
      </PageHeading>
      {error && <ErrorBox>{error}</ErrorBox>}
      <div className="event-detail-layout">
        <div>
          <EventImage event={event} className="detail-photo" />
          <div className="event-description">
            <h2>About the event</h2>
            <p>{event.description}</p>
            <span>
              <MapPin size={16} />
              {event.venue}, {event.city}
            </span>
          </div>
        </div>
        <aside className="event-detail-aside">
          <div className="event-link-panel">
            <h2>Event link</h2>
            <a href={event.url} target="_blank" rel="noreferrer">
              {new URL(event.url).host}
              <ExternalLink size={15} />
            </a>
            <button
              className="button secondary full"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(event.url);
                  notify('Event link copied.');
                } catch {
                  notify('Copy the event address above.');
                }
              }}
            >
              <Copy size={16} />
              Copy link
            </button>
            {event.status !== 'draft' && (
              <a className="text-link" href={event.url} target="_blank" rel="noreferrer">
                Open event page
                <ArrowUpRight size={15} />
              </a>
            )}
          </div>
          <div className="event-sales-panel">
            <h2>Ticket sales</h2>
            <div className="big-total">TZS {money(event.revenue || 0)}</div>
            <div className="capacity-line">
              <span>{event.sold} sold</span>
              <span>{capacity} capacity</span>
            </div>
            <div className="progress">
              <span style={{ width: `${((event.sold || 0) / capacity) * 100}%` }} />
            </div>
            {event.tickets.map((t) => (
              <div className="ticket-type-summary" key={t.id}>
                <span>
                  {t.name}
                  <small>{t.available} available</small>
                </span>
                <strong>TZS {money(t.price)}</strong>
              </div>
            ))}
          </div>
          <div className="event-attendance-panel">
            <Users size={20} />
            <span>
              <strong>{event.checked_in || 0}</strong> guests checked in
            </span>
          </div>
        </aside>
      </div>
      <div className="section-heading table-section-heading">
        <h2>Event orders</h2>
        <Link to="/dashboard/orders">
          Manage orders
          <ArrowUpRight size={15} />
        </Link>
      </div>
      <OrdersTable orders={orders.filter((o) => o.event_id === event.id)} />
      {event.status !== 'cancelled' && (
        <div className="event-danger-zone">
          <button className="text-danger" onClick={() => setConfirm(true)}>
            Cancel event
          </button>
        </div>
      )}
      {confirm && (
        <Modal title="Cancel this event?" onClose={() => setConfirm(false)}>
          <p className="modal-copy">
            Ticket sales will stop and existing tickets will become invalid. Paid orders still need
            to be refunded separately.
          </p>
          <div className="modal-actions">
            <button className="button secondary" onClick={() => setConfirm(false)}>
              Keep event
            </button>
            <button className="button danger" onClick={() => setStatus('cancelled')}>
              Cancel event
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
function SettingsPage() {
  const { user, setUser, config, notify } = useApp();
  const navigate = useNavigate();
  const [name, setName] = useState(user?.name || ''),
    [org, setOrg] = useState(user?.organization || ''),
    [phone, setPhone] = useState(user?.phone || ''),
    [current, setCurrent] = useState(''),
    [password, setPassword] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const data = await send<{ user: User }>(
        '/settings',
        { name, organization: org, phone },
        'PUT',
      );
      setUser(data.user);
      notify('Account details saved.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const changePassword = async () => {
    setBusy(true);
    setError('');
    try {
      await send('/settings/password', { current, newPassword: password }, 'PUT');
      setUser(null);
      navigate('/login');
      notify('Password updated. Sign in again.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeading title="Settings" />
      {error && <ErrorBox>{error}</ErrorBox>}
      <div className="settings-section">
        <div>
          <h2>Account</h2>
          <p className="muted">Your organizer details</p>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <label>
            Full name
            <input required value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            Organization
            <input value={org} onChange={(e) => setOrg(e.target.value)} />
          </label>
          <label>
            Email address
            <input value={user?.email} disabled type="email" />
          </label>
          <label>
            Contact number
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="0712 345 678"
            />
          </label>
          <button className="button primary" disabled={busy}>
            Save changes
            <Check size={16} />
          </button>
        </form>
      </div>
      <div className="settings-section">
        <div>
          <h2>Password</h2>
          <p className="muted">Changing your password signs out all sessions.</p>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            changePassword();
          }}
        >
          <label>
            Current password
            <input
              type="password"
              autoComplete="current-password"
              required
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </label>
          <label>
            New password
            <input
              type="password"
              autoComplete="new-password"
              minLength={10}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button className="button secondary" disabled={busy}>
            Update password
          </button>
        </form>
      </div>
      <div className="settings-section">
        <div>
          <h2>Connections</h2>
        </div>
        <div className="connection-list">
          <div>
            <Smartphone size={21} />
            <span>
              Mobile money
              <small>
                {config.paymentDriver === 'demo'
                  ? 'Demo payments'
                  : config.paymentDriver === 'disabled'
                    ? 'Not connected'
                    : 'Flutterwave'}
              </small>
            </span>
            <Status
              status={
                config.paymentDriver === 'demo'
                  ? 'demo'
                  : config.paymentDriver === 'disabled'
                    ? 'paused'
                    : 'published'
              }
            />
          </div>
          <div>
            <Send size={21} />
            <span>
              Ticket delivery
              <small>
                {config.deliveryDriver === 'outbox'
                  ? 'Local outbox · sending not connected'
                  : 'SMTP and Twilio'}
              </small>
            </span>
            <Status status={config.deliveryDriver === 'outbox' ? 'outbox' : 'published'} />
          </div>
          <div>
            <Banknote size={21} />
            <span>
              Organizer payouts<small>Not connected</small>
            </span>
            <Status status="paused" />
          </div>
        </div>
      </div>
    </>
  );
}
function AdminPage() {
  const [data, setData] = useState<{
      users: User[];
      events: Event[];
      review: { reference: string; amount: number; phone: string; event_name: string }[];
    } | null>(null),
    [error, setError] = useState('');
  const { notify } = useApp();
  const load = () =>
    api<typeof data>('/admin')
      .then(setData)
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);
  const update = async (event: Event) => {
    try {
      await send(`/admin/events/${event.id}/status`, {
        status: event.status === 'published' ? 'paused' : 'published',
      });
      load();
      notify('Event status updated.');
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <>
      <PageHeading title="Administration" subtitle="Platform accounts and events" />
      {error && <ErrorBox>{error}</ErrorBox>}
      {!data ? (
        <Spinner />
      ) : (
        <>
          <div className="admin-counts">
            <span>
              <strong>{data.users.length}</strong> accounts
            </span>
            <span>
              <strong>{data.events.length}</strong> events
            </span>
            <span>
              <strong>{data.review.length}</strong> payments to review
            </span>
          </div>
          {data.review.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Review reference</th>
                    <th>Event</th>
                    <th>Phone</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {data.review.map((o) => (
                    <tr key={o.reference}>
                      <td>{o.reference}</td>
                      <td>{o.event_name}</td>
                      <td>{o.phone}</td>
                      <td>TZS {money(o.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="section-heading table-section-heading">
            <h2>Accounts</h2>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                </tr>
              </thead>
              <tbody>
                {data.users.map((u) => (
                  <tr key={u.id}>
                    <td>{u.name}</td>
                    <td>{u.email}</td>
                    <td>{u.role}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="section-heading table-section-heading">
            <h2>All events</h2>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Link</th>
                  <th>Status</th>
                  <th>Sales</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.events.map((e) => (
                  <tr key={e.id}>
                    <td>{e.name}</td>
                    <td>{e.slug}</td>
                    <td>
                      <Status status={e.status} />
                    </td>
                    <td>TZS {money(e.revenue || 0)}</td>
                    <td>
                      {e.status !== 'cancelled' && (
                        <button className="button small secondary" onClick={() => update(e)}>
                          {e.status === 'published' ? 'Pause' : 'Publish'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
