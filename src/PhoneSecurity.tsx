import { useEffect, useState, type FormEvent } from 'react';
import { ShieldCheck, Smartphone, RefreshCw } from 'lucide-react';
import { api, send } from './api';
import { useApp } from './context';
import { ErrorBox, Spinner } from './ui';
import type { User } from './types';

type PhoneState = { available: boolean; verified: boolean; phone: string | null };
type Code = { challenge_id: string; phone: string; expires_at: number; resend_after: number };
export function PhoneSecurity() {
  const { user, setUser, notify } = useApp();
  const [state, setState] = useState<PhoneState | null>(null);
  const [phone, setPhone] = useState(user?.phone || ''),
    [password, setPassword] = useState('');
  const [challenge, setChallenge] = useState<Code | null>(null),
    [code, setCode] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [now, setNow] = useState(Date.now()),
    [resendAt, setResendAt] = useState(0);
  const load = () =>
    api<PhoneState>('/settings/phone')
      .then(setState)
      .catch((e) => setError(e.message));
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    if (!challenge) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [challenge]);
  const request = async (resend = false) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await send<Code>(
        resend && challenge
          ? `/settings/phone/${challenge.challenge_id}/resend`
          : '/settings/phone/code',
        { phone, password },
      );
      setChallenge(result);
      setCode('');
      setNow(Date.now());
      setResendAt(Date.now() + result.resend_after * 1000);
      notify('Verification SMS requested.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!challenge) return request();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await send<{ user: User }>(
        `/settings/phone/${challenge.challenge_id}/verify`,
        { code },
      );
      setUser(result.user);
      setChallenge(null);
      setPassword('');
      setCode('');
      await load();
      notify('Security phone verified.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const seconds = challenge ? Math.max(0, Math.ceil((challenge.expires_at - now) / 1000)) : 0;
  const cooldown = Math.max(0, Math.ceil((resendAt - now) / 1000));
  return (
    <div className="settings-section">
      <div>
        <h2>Security phone</h2>
        <p className="muted">Payout authorization</p>
      </div>
      <div>
        {error && <ErrorBox>{error}</ErrorBox>}
        {!state ? (
          error ? (
            <button className="button secondary" onClick={load}>
              <RefreshCw size={16} />
              Retry
            </button>
          ) : (
            <Spinner />
          )
        ) : state.verified ? (
          <div className="security-phone-status">
            <ShieldCheck size={21} />
            <div>
              <strong>{state.phone}</strong>
              <p className="muted">
                Verified. Contact-number edits do not change this security number.
              </p>
            </div>
          </div>
        ) : !state.available ? (
          <p className="muted">SMS verification is not connected yet.</p>
        ) : (
          <form onSubmit={submit}>
            {!challenge ? (
              <>
                <label>
                  Mobile number
                  <input
                    type="tel"
                    autoComplete="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    required
                    maxLength={30}
                    placeholder="0712 345 678"
                  />
                </label>
                <label>
                  Current password
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    maxLength={128}
                  />
                </label>
                <button className="button primary" disabled={busy}>
                  <Smartphone size={16} />
                  {busy ? 'Sending...' : 'Send verification code'}
                </button>
              </>
            ) : (
              <>
                <p>SMS requested for {challenge.phone}</p>
                <label>
                  Verification code
                  <input
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                    required
                  />
                </label>
                <p className="muted" role="status">
                  {seconds
                    ? `Expires in ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
                    : 'Code expired.'}
                </p>
                <div className="phone-code-actions">
                  <button
                    className="button primary"
                    disabled={busy || !seconds || code.length !== 6}
                  >
                    <ShieldCheck size={16} />
                    {busy ? 'Verifying...' : 'Verify phone'}
                  </button>
                  <button
                    type="button"
                    className="button secondary"
                    disabled={busy || cooldown > 0}
                    onClick={() => request(true)}
                  >
                    <RefreshCw size={16} />
                    {cooldown ? `Resend in ${cooldown}s` : 'Resend code'}
                  </button>
                  <button
                    type="button"
                    className="button secondary"
                    disabled={busy}
                    onClick={() => {
                      setChallenge(null);
                      setCode('');
                      setError('');
                    }}
                  >
                    Change number
                  </button>
                </div>
              </>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
