import { useEffect, useState } from 'react';
import { Link, useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Copy,
  UserPlus,
  UserRound,
  ShieldCheck,
  X,
  Loader2,
  ArrowRight,
  ScanLine,
  Eye,
  EyeOff,
} from 'lucide-react';
import { api, send, dateLabel } from './api';
import { useApp } from './context';
import { Shell } from './Dashboard';
import { Brand, Empty, ErrorBox, Spinner } from './ui';
import type { User } from './types';

type Member = { id: string; name: string; email: string; source: string; expires_at?: number };
type GateEvent = { id: string; name: string; starts_at: string; status: string };
type Team = { scanners: Member[]; invites: Member[] };
type CreatedAccount = {
  account: { id: string; name: string; email: string };
  created: boolean;
  temporary_password?: string;
  login_url: string;
};

export function GateTeam() {
  const [params] = useSearchParams();
  const { user, notify } = useApp();
  const [events, setEvents] = useState<GateEvent[]>([]),
    [eventId, setEventId] = useState('');
  const [team, setTeam] = useState<Team | null>(null),
    [error, setError] = useState('');
  const [name, setName] = useState(''),
    [email, setEmail] = useState(''),
    [busy, setBusy] = useState(false);
  const [link, setLink] = useState(''),
    [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<'create' | 'invite'>('create');
  const [emailAvailable, setEmailAvailable] = useState(false),
    [sendEmail, setSendEmail] = useState(false);
  const [account, setAccount] = useState<CreatedAccount | null>(null),
    [showPassword, setShowPassword] = useState(false),
    [emailDelivery, setEmailDelivery] = useState('');
  useEffect(() => {
    api<{ events: GateEvent[]; email_available: boolean }>('/gate/events')
      .then((d) => {
        setEvents(d.events);
        setEmailAvailable(d.email_available);
        setEventId(
          d.events.find((e) => e.id === params.get('event'))?.id ||
            d.events.find((e) => e.status === 'published')?.id ||
            d.events[0]?.id ||
            '',
        );
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    setTeam(null);
    setLink('');
    setAccount(null);
    setShowPassword(false);
    setEmailDelivery('');
    setError('');
    if (!eventId) return;
    let active = true;
    api<Team>(`/gate/events/${eventId}/team`)
      .then((d) => {
        if (active) setTeam(d);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [eventId]);
  const reload = async (id: string) => {
    const result = await api<Team>(`/gate/events/${id}/team`);
    setTeam(result);
  };
  const remove = async (member: Member, pending: boolean) => {
    setBusy(true);
    setError('');
    try {
      await send(
        `/gate/events/${eventId}/${pending ? 'invites' : 'scanners'}/${member.id}`,
        {},
        'DELETE',
      );
      setLink('');
      setAccount(null);
      await reload(eventId);
      notify(pending ? 'Invitation cancelled.' : 'Scanner access revoked.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Shell title="Gate team">
      <div className="page-heading">
        <div>
          <h1>Gate team</h1>
          <p>
            {user?.role === 'admin'
              ? 'Golden Creations staff & event crews'
              : 'Your crew at the door'}
          </p>
        </div>
        <Link className="button secondary" to="/dashboard/scan">
          <ScanLine size={17} />
          Gate scanner
        </Link>
      </div>
      {error && <ErrorBox>{error}</ErrorBox>}
      {loading ? (
        <Spinner />
      ) : !events.length ? (
        <Empty title="No events yet" />
      ) : (
        <>
          <label className="gate-event-select">
            Event
            <select
              aria-label="Team event"
              value={eventId}
              disabled={busy}
              onChange={(e) => setEventId(e.target.value)}
            >
              {events.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} · {dateLabel(e.starts_at)}
                </option>
              ))}
            </select>
          </label>
          <div className="gate-team-layout">
            <section className="gate-roster">
              <div className="section-heading">
                <h2>Assigned scanners</h2>
                <span className="count-pill">{team?.scanners.length || 0}</span>
              </div>
              {!team && !error ? (
                <Spinner />
              ) : team?.scanners.length ? (
                team.scanners.map((m) => (
                  <div className="gate-member" key={m.id}>
                    <span className="gate-person-icon">
                      <UserRound size={19} />
                    </span>
                    <div>
                      <strong>{m.name}</strong>
                      <span>{m.email}</span>
                      <small>
                        {m.source === 'golden' ? 'Golden Creations' : 'Organizer crew'} · Active
                      </small>
                    </div>
                    <button
                      className="icon-button"
                      disabled={busy}
                      title={`Revoke access for ${m.name}`}
                      aria-label={`Revoke access for ${m.name}`}
                      onClick={() => remove(m, false)}
                    >
                      <X size={18} />
                    </button>
                  </div>
                ))
              ) : (
                <Empty title="No scanners assigned" />
              )}
              {!!team?.invites.length && (
                <>
                  <div className="section-heading">
                    <h2>Pending invitations</h2>
                  </div>
                  {team.invites.map((m) => (
                    <div className="gate-member" key={m.id}>
                      <span className="gate-person-icon pending">
                        <UserPlus size={19} />
                      </span>
                      <div>
                        <strong>{m.name}</strong>
                        <span>{m.email}</span>
                        <small>Expires {dateLabel(new Date(m.expires_at!).toISOString())}</small>
                      </div>
                      <button
                        className="icon-button"
                        disabled={busy}
                        title={`Cancel invitation for ${m.name}`}
                        aria-label={`Cancel invitation for ${m.name}`}
                        onClick={() => remove(m, true)}
                      >
                        <X size={18} />
                      </button>
                    </div>
                  ))}
                </>
              )}
            </section>
            <section className="gate-invite-tool">
              <h2>Add a scanner</h2>
              <fieldset className="gate-mode" disabled={busy}>
                <legend className="sr-only">Account setup</legend>
                {(['create', 'invite'] as const).map((value) => (
                  <label key={value}>
                    <input
                      type="radio"
                      name="gate-mode"
                      value={value}
                      checked={mode === value}
                      onChange={() => {
                        setMode(value);
                        setLink('');
                        setAccount(null);
                        setShowPassword(false);
                        setEmailDelivery('');
                        setError('');
                      }}
                    />
                    <span>{value === 'create' ? 'Create account' : 'Invite'}</span>
                  </label>
                ))}
              </fieldset>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  setBusy(true);
                  setError('');
                  setLink('');
                  setAccount(null);
                  setShowPassword(false);
                  setEmailDelivery('');
                  try {
                    if (mode === 'create') {
                      const result = await send<CreatedAccount>(
                        `/gate/events/${eventId}/scanners`,
                        { name, email },
                      );
                      setAccount(result);
                    } else {
                      const result = await send<{ url: string; email_delivery?: string }>(
                        `/gate/events/${eventId}/invites`,
                        {
                          name,
                          email,
                          delivery: sendEmail ? 'email' : 'link',
                        },
                      );
                      setLink(result.url);
                      setEmailDelivery(result.email_delivery || '');
                    }
                    setName('');
                    setEmail('');
                    await reload(eventId);
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <label>
                  Name
                  <input
                    required
                    minLength={2}
                    maxLength={80}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoComplete="off"
                  />
                </label>
                <label>
                  Email
                  <input
                    required
                    type="email"
                    maxLength={200}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="off"
                  />
                </label>
                {mode === 'invite' && (
                  <label className="gate-email-option">
                    <input
                      type="checkbox"
                      checked={sendEmail}
                      disabled={!emailAvailable || busy}
                      onChange={(e) => setSendEmail(e.target.checked)}
                    />
                    <span>
                      Send by email{!emailAvailable && <small>Email not connected</small>}
                    </span>
                  </label>
                )}
                <button
                  className="button primary"
                  disabled={
                    busy || !team || events.find((e) => e.id === eventId)?.status === 'cancelled'
                  }
                >
                  {busy ? <Loader2 className="spin" size={17} /> : <UserPlus size={17} />}
                  {mode === 'create' ? 'Create scanner account' : 'Create invitation'}
                </button>
              </form>
              {account && (
                <div className="gate-created-link" role="status">
                  <strong>{account.created ? 'Account ready' : 'Scanner assigned'}</strong>
                  <span>{account.account.email}</span>
                  <a href={account.login_url}>{account.login_url}</a>
                  {account.temporary_password && (
                    <>
                      <label>
                        Temporary password
                        <div className="gate-password">
                          <input
                            readOnly
                            type={showPassword ? 'text' : 'password'}
                            value={account.temporary_password}
                            autoComplete="off"
                          />
                          <button
                            type="button"
                            className="icon-button"
                            title={showPassword ? 'Hide password' : 'Show password'}
                            aria-label={showPassword ? 'Hide password' : 'Show password'}
                            onClick={() => setShowPassword(!showPassword)}
                          >
                            {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                          </button>
                        </div>
                      </label>
                      <small>Password change required at first sign-in.</small>
                      <button
                        type="button"
                        className="button secondary"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(
                              `Golden Creations gate access\n${account.login_url}\nEmail: ${account.account.email}\nTemporary password: ${account.temporary_password}`,
                            );
                            notify('Account details copied. Share them privately.');
                          } catch {
                            notify('Copy is unavailable. Share the details privately.');
                          }
                        }}
                      >
                        <Copy size={16} />
                        Copy account details
                      </button>
                    </>
                  )}
                </div>
              )}
              {link && (
                <div className="gate-created-link" role="status">
                  <strong>
                    {emailDelivery === 'sent' ? 'Invitation emailed' : 'Invitation ready'}
                  </strong>
                  {emailDelivery === 'failed' && (
                    <small>Email could not be sent. Share this link instead.</small>
                  )}
                  <a href={link}>{link}</a>
                  <button
                    className="button secondary"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(link);
                        notify('Invitation copied.');
                      } catch {
                        notify('Select the invitation address to copy it.');
                      }
                    }}
                  >
                    <Copy size={16} />
                    Copy invitation
                  </button>
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </Shell>
  );
}

export function ScannerInvite() {
  const { token } = useParams(),
    navigate = useNavigate();
  const { user, setUser } = useApp();
  const [invite, setInvite] = useState<{
    name: string;
    email: string;
    event_name: string;
    existing_account: boolean;
  } | null>(null);
  const [password, setPassword] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setInvite(null);
    setError('');
    setPassword('');
    api<typeof invite>(`/scanner-invites/${token}`)
      .then((data) => {
        if (active) setInvite(data);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token]);
  return (
    <div className="public-page scanner-invite-page">
      <header className="public-header">
        <Link to="/">
          <Brand ticketLogo />
        </Link>
        <span>Gate access</span>
      </header>
      <main className="scanner-invite-tool">
        {loading ? (
          <Spinner />
        ) : (
          <>
            <span className="invite-symbol">
              <ScanLine size={32} />
            </span>
            <span className="eyebrow">SCANNER INVITATION</span>
            <h1>{invite?.event_name || 'Invitation unavailable'}</h1>
            {error && <ErrorBox>{error}</ErrorBox>}
            {invite && (
              <>
                <div className="claim-recipient">
                  <ShieldCheck size={20} />
                  <div>
                    <strong>{invite.name}</strong>
                    <span>{invite.email}</span>
                  </div>
                </div>
                {user && user.email !== invite.email ? (
                  <>
                    <p>This invitation belongs to {invite.email}.</p>
                    <button
                      className="button secondary full"
                      onClick={async () => {
                        await send('/auth/logout', {});
                        setUser(null);
                      }}
                    >
                      Sign out
                    </button>
                  </>
                ) : !user && invite.existing_account ? (
                  <Link
                    className="button primary full"
                    to="/login"
                    state={{ from: `/scanner-invite/${token}` }}
                  >
                    Sign in to accept
                    <ArrowRight size={17} />
                  </Link>
                ) : (
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      setBusy(true);
                      setError('');
                      try {
                        const result = await send<{ user: User }>(
                          `/scanner-invites/${token}/accept`,
                          { password },
                        );
                        setUser(result.user);
                        navigate('/dashboard/scan', { replace: true });
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    {!user && (
                      <label>
                        Create your password
                        <input
                          type="password"
                          required
                          minLength={10}
                          maxLength={128}
                          autoComplete="new-password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                        />
                      </label>
                    )}
                    <button className="button primary full" disabled={busy}>
                      {busy ? <Loader2 className="spin" size={17} /> : <ScanLine size={17} />}Accept
                      gate access
                    </button>
                  </form>
                )}
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
