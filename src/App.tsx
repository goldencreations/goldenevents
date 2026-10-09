import { lazy, Suspense, useEffect, useState } from 'react';
import { Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import { Check, ArrowLeft } from 'lucide-react';
import { api } from './api';
import type { User, Config } from './types';
import { AppContext } from './context';
import { Spinner, Brand, ErrorBox } from './ui';
const AuthPage = lazy(() => import('./AuthPage').then((m) => ({ default: m.AuthPage })));
const Dashboard = lazy(() => import('./Dashboard').then((m) => ({ default: m.Dashboard })));
const EventEditor = lazy(() => import('./EventEditor').then((m) => ({ default: m.EventEditor })));
const Scanner = lazy(() => import('./Scanner').then((m) => ({ default: m.Scanner })));
const Explore = lazy(() => import('./PublicPages').then((m) => ({ default: m.Explore })));
const EventPage = lazy(() => import('./PublicPages').then((m) => ({ default: m.EventPage })));
const OrderPage = lazy(() => import('./PublicPages').then((m) => ({ default: m.OrderPage })));
const TicketPage = lazy(() => import('./PublicPages').then((m) => ({ default: m.TicketPage })));
const ClaimPage = lazy(() => import('./TicketSharing').then((m) => ({ default: m.ClaimPage })));
const StatusPage = lazy(() => import('./StatusPage').then((m) => ({ default: m.StatusPage })));

export function App() {
  const location = useLocation();
  if (['/status', '/status/'].includes(location.pathname))
    return (
      <Suspense fallback={<Spinner label="Checking service status" />}>
        <StatusPage />
      </Suspense>
    );
  return <EventApp />;
}

function EventApp() {
  const [user, setUser] = useState<User | null>(null),
    [config, setConfig] = useState<Config | null>(null),
    [error, setError] = useState(''),
    [toast, setToast] = useState('');
  const location = useLocation();
  useEffect(() => {
    Promise.all([api<{ user: User | null }>('/auth/me'), api<Config>('/config')])
      .then(([auth, settings]) => {
        setUser(auth.user);
        setConfig(settings);
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 4000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);
  if (error)
    return (
      <div className="startup">
        <Brand />
        <ErrorBox>{error}</ErrorBox>
        <button onClick={() => window.location.reload()}>Try again</button>
      </div>
    );
  if (!config) return <Spinner label="Opening Golden Events" />;
  const host = window.location.hostname;
  const prefix = host.endsWith(`.${config.baseDomain}`)
    ? host.slice(0, -config.baseDomain.length - 1)
    : '';
  const isEventHost = !!prefix && !['app', 'www'].includes(prefix);
  const root = isEventHost ? (
    <EventPage hostSlug={prefix} />
  ) : prefix === 'app' ? (
    <Navigate to="/dashboard" replace />
  ) : (
    <Explore />
  );
  const protectedPage = (children: React.ReactNode) =>
    user ? children : <Navigate to="/login" state={{ from: location.pathname }} replace />;
  return (
    <AppContext.Provider value={{ user, config, setUser, notify: setToast }}>
      <Suspense fallback={<Spinner label="Opening page" />}>
        <Routes>
          <Route path="/" element={root} />
          <Route path="/login" element={<AuthPage />} />
          <Route path="/register" element={<AuthPage register />} />
          <Route path="/e/:slug" element={<EventPage />} />
          <Route path="/order/:token" element={<OrderPage />} />
          <Route path="/ticket/:token" element={<TicketPage />} />
          <Route path="/claim/:token" element={<ClaimPage />} />
          <Route path="/dashboard/events/new" element={protectedPage(<EventEditor />)} />
          <Route path="/dashboard/events/:id/edit" element={protectedPage(<EventEditor />)} />
          <Route path="/dashboard/scan" element={protectedPage(<Scanner />)} />
          <Route path="/dashboard/*" element={protectedPage(<Dashboard />)} />
          <Route
            path="*"
            element={
              <div className="not-found">
                <Brand />
                <h1>Page not found</h1>
                <Link className="button" to="/">
                  <ArrowLeft size={17} />
                  Back to events
                </Link>
              </div>
            }
          />
        </Routes>
      </Suspense>
      {toast && (
        <div className="toast" role="status">
          <Check size={18} />
          {toast}
        </div>
      )}
    </AppContext.Provider>
  );
}
