import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, ArrowUpRight, Loader2, Ticket, Eye, EyeOff } from 'lucide-react';
import { send } from './api';
import { useApp } from './context';
import { Brand, ErrorBox } from './ui';
import type { User } from './types';

export function AuthPage({ register = false }: { register?: boolean }) {
  const { user, config, setUser } = useApp();
  const navigate = useNavigate(),
    location = useLocation();
  const [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [name, setName] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [visible, setVisible] = useState(false);
  if (user) return <Navigate to="/dashboard" replace />;
  const authenticate = async (demo = false) => {
    setBusy(true);
    setError('');
    try {
      const result = await send<{ user: User }>(
        demo ? '/auth/demo' : register ? '/auth/register' : '/auth/login',
        { email, password, name },
      );
      setUser(result.user);
      navigate(location.state?.from || '/dashboard');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="auth-page">
      <div className="auth-main">
        <Link to="/">
          <Brand ticketLogo />
        </Link>
        <div className="auth-form">
          <span className="eyebrow">THE ORGANIZER WORKSPACE</span>
          <h1>{register ? 'Make your next event golden.' : 'Welcome back.'}</h1>
          <p>
            {register
              ? 'Create your organizer account.'
              : 'Your events. Your people. Your next big moment.'}
          </p>
          {error && <ErrorBox>{error}</ErrorBox>}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              authenticate();
            }}
          >
            {register && (
              <label>
                Your name
                <input
                  autoComplete="name"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Alex Morgan"
                />
              </label>
            )}
            <label>
              Email address
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </label>
            <label>
              Password
              <div className="password-input">
                <input
                  type={visible ? 'text' : 'password'}
                  autoComplete={register ? 'new-password' : 'current-password'}
                  minLength={register ? 10 : undefined}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={register ? 'At least 10 characters' : 'Your password'}
                />
                <button
                  type="button"
                  className="icon-button"
                  title={visible ? 'Hide password' : 'Show password'}
                  onClick={() => setVisible(!visible)}
                >
                  {visible ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </label>
            <button className="button primary full" disabled={busy}>
              {busy ? (
                <Loader2 className="spin" size={17} />
              ) : (
                <>
                  {register ? 'Create account' : 'Sign in'}
                  <ArrowRight size={17} />
                </>
              )}
            </button>
          </form>
          {config.demo && (
            <>
              <div className="divider">
                <span>or</span>
              </div>
              <button
                className="button secondary full"
                disabled={busy}
                onClick={() => authenticate(true)}
              >
                <Ticket size={17} />
                Open demo workspace
                <ArrowUpRight size={16} />
              </button>
            </>
          )}
          <p className="auth-switch">
            {register ? 'Already have an account?' : 'New to Golden Events?'}{' '}
            <Link to={register ? '/login' : '/register'}>
              {register ? 'Sign in' : 'Create an account'}
            </Link>
          </p>
        </div>
        <span className="auth-footer">Golden Creation · Dar es Salaam</span>
      </div>
      <aside className="auth-photo">
        <img src="/assets/sunset-sessions.jpg" alt="Fans enjoying an outdoor live music event" />
        <div>
          <span className="eyebrow">GOOD PEOPLE. GREAT MOMENTS.</span>
          <h2>
            Something worth
            <br />
            showing up for.
          </h2>
          <span className="photo-caption">Your next event starts here.</span>
        </div>
      </aside>
    </div>
  );
}
