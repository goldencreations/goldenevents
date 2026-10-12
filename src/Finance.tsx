import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowUpRight,
  Banknote,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  UserRound,
  X,
} from 'lucide-react';
import { api, send, money, dateLabel, timeLabel, downloadCSV, ApiError } from './api';
import { useApp } from './context';
import { Empty, ErrorBox, Modal, Spinner } from './ui';
import type { Finance, Payout } from './types';

const networks: Record<string, string> = {
  mpesa: 'M-Pesa',
  airtel: 'Airtel Money',
  mixx: 'Mixx by Yas',
  halopesa: 'HaloPesa',
  MPESA: 'M-Pesa',
  AIRTELMONEY: 'Airtel Money',
  CRDB: 'CRDB Bank',
  NMB: 'NMB Bank',
};
const payoutLabels: Record<Payout['status'], string> = {
  requested: 'Awaiting review',
  processing: 'Transfer in progress',
  paid: 'Paid',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};
function useFinancePage<T>(rows: T[], label: string) {
  const [page, setPage] = useState(0);
  const count = Math.max(1, Math.ceil(rows.length / 20)),
    current = Math.min(page, count - 1);
  return {
    rows: rows.slice(current * 20, (current + 1) * 20),
    controls: rows.length > 20 && (
      <div className="finance-pagination">
        <span>
          {current * 20 + 1}-{Math.min((current + 1) * 20, rows.length)} of {rows.length}
        </span>
        <button
          className="icon-button"
          aria-label={`Previous ${label} page`}
          title="Previous page"
          disabled={!current}
          onClick={() => setPage(current - 1)}
        >
          <ChevronLeft size={17} />
        </button>
        <button
          className="icon-button"
          aria-label={`Next ${label} page`}
          title="Next page"
          disabled={current === count - 1}
          onClick={() => setPage(current + 1)}
        >
          <ChevronRight size={17} />
        </button>
      </div>
    ),
  };
}
function PayoutStatus({ payout }: { payout: Payout }) {
  return (
    <span className={`payout-status payout-${payout.status}`}>
      {payout.mode === 'demo' && payout.status === 'paid'
        ? 'Simulated paid'
        : payout.driver !== 'manual' && payout.status === 'rejected'
          ? 'Not paid'
          : payoutLabels[payout.status]}
    </span>
  );
}
function PayoutHistory({
  payouts,
  onCancel,
}: {
  payouts: Payout[];
  onCancel: (p: Payout) => void;
}) {
  const page = useFinancePage(payouts, 'payout history');
  return payouts.length ? (
    <>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Request</th>
              <th>Recipient</th>
              <th>Amount</th>
              <th>Status</th>
              <th>Review / transfer</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {page.rows.map((p) => (
              <tr key={p.id}>
                <td>
                  <strong>{p.reference}</strong>
                  <small className="finance-cell-note">{dateLabel(p.created_at)}</small>
                </td>
                <td>
                  {p.recipient_name}
                  <small className="finance-cell-note">
                    {networks[p.network]} · {p.phone}
                  </small>
                </td>
                <td className="finance-amount">
                  TZS {money(p.amount)}
                  {p.payout_fee > 0 && (
                    <small className="finance-cell-note">
                      Fee {money(p.payout_fee)} · total {money(p.amount + p.payout_fee)}
                    </small>
                  )}
                </td>
                <td>
                  <PayoutStatus payout={p} />
                </td>
                <td className="finance-review-note">{p.transfer_reference || p.note || '—'}</td>
                <td>
                  {p.status === 'requested' && (
                    <button
                      className="icon-button"
                      title="Cancel payout request"
                      aria-label={`Cancel ${p.reference}`}
                      onClick={() => onCancel(p)}
                    >
                      <X size={17} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {page.controls}
    </>
  ) : (
    <Empty title="No payout requests yet">Your payout history will appear here.</Empty>
  );
}
export function OrganizerEarnings() {
  const { notify } = useApp();
  const [data, setData] = useState<Finance | null>(null),
    [error, setError] = useState(''),
    [requesting, setRequesting] = useState(false),
    [cancelling, setCancelling] = useState<Payout | null>(null),
    [busy, setBusy] = useState(false);
  const salesPage = useFinancePage(data?.orders || [], 'sales');
  const load = () =>
    api<Finance>('/organizer/finance')
      .then((d) => {
        setData(d);
        setError('');
      })
      .catch((e) => setError(e.message));
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    if (!data) return;
    const processing = data.payouts.some((p) => p.driver !== 'manual' && p.status === 'processing');
    if (!processing && data.payout_mode !== 'ecofy') return;
    const timer = setInterval(
      () => {
        void load();
      },
      processing ? 5000 : 60000,
    );
    return () => clearInterval(timer);
  }, [data]);
  const cancel = async () => {
    if (!cancelling) return;
    setBusy(true);
    try {
      await send(`/organizer/payouts/${cancelling.id}/cancel`, {});
      setCancelling(null);
      await load();
      notify('Payout request cancelled.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (!data)
    return (
      <>
        {error ? (
          <ErrorBox>
            {error}
            <button onClick={load}>Retry</button>
          </ErrorBox>
        ) : (
          <Spinner />
        )}
      </>
    );
  const preview = data.withdrawal_preview?.status === 'quoted' ? data.withdrawal_preview : null;
  const withdrawalFees =
    data.provider_fees + data.payout_fees + (data.payout_fees_reserved || 0) + (preview?.fee || 0);
  const netEarnings = data.gross - data.platform_fee - withdrawalFees;
  return (
    <section className="finance-section">
      <div className="section-heading">
        <h2>Earnings & payouts</h2>
        <div className="finance-actions">
          <span className="finance-fee">Golden Events · {data.fee_bps / 100}%</span>
          <button
            className="icon-button"
            aria-label="Refresh earnings"
            title="Refresh earnings"
            onClick={load}
          >
            <RefreshCw size={17} />
          </button>
        </div>
      </div>
      {error && <ErrorBox>{error}</ErrorBox>}
      {data.demo && (
        <div className="notice">
          <Banknote size={19} />
          <span>Demo earnings and payouts only. No real money is transferred.</span>
        </div>
      )}
      <div className="finance-totals">
        <div>
          <span>Ticket sales</span>
          <strong>TZS {money(data.gross)}</strong>
          <small>Paid, non-refunded orders</small>
        </div>
        <div>
          <span>Golden Events fee</span>
          <strong>− TZS {money(data.platform_fee)}</strong>
          <small>{data.fee_bps / 100}% on new purchases</small>
        </div>
        <div>
          <span>Withdrawal fees</span>
          <strong>− TZS {money(withdrawalFees)}</strong>
          <small>
            {data.provider_fees_pending
              ? `${data.provider_fees_pending} orders awaiting reconciliation`
              : preview
                ? 'Collection + quoted payout charges'
                : 'Collection + confirmed payout charges'}
          </small>
        </div>
        <div>
          <span>
            {data.provider_fees_pending ? 'Estimated organizer earnings' : 'Organizer earnings'}
          </span>
          <strong>TZS {money(netEarnings)}</strong>
          <small>
            {data.provider_fees_pending
              ? 'Unconfirmed provider fees not deducted yet'
              : 'After Golden Events and provider fees'}
          </small>
        </div>
      </div>
      <div className="finance-available">
        <div>
          <span>{data.payout_mode === 'ecofy' ? 'You receive' : 'Available to request'}</span>
          <strong>
            {data.payout_mode === 'ecofy'
              ? preview
                ? `TZS ${money(preview.amount)}`
                : data.available < data.minimum
                  ? 'TZS 0'
                  : '—'
              : `TZS ${money(data.available)}`}
          </strong>
          <small>
            {preview
              ? `${networks[preview.channel]} · account ending ${preview.account.slice(-4)}`
              : data.payout_mode === 'ecofy'
                ? data.withdrawal_preview?.status === 'unavailable'
                  ? 'Withdrawal quote currently unavailable'
                  : 'Choose a payout destination for the final amount'
                : 'Reconciled funds, before or after your event'}
          </small>
        </div>
        <button
          className="button primary"
          disabled={
            data.available < data.minimum ||
            data.verification === 'disabled' ||
            data.verification_phone_ready === false ||
            data.shortfall > 0
          }
          onClick={() => setRequesting(true)}
        >
          <ArrowUpRight size={17} />
          Request payout
        </button>
      </div>
      <dl className="finance-balances">
        {preview && preview.remaining > 0 && (
          <div>
            <dt>Balance remaining after this payout</dt>
            <dd>TZS {money(preview.remaining)}</dd>
          </div>
        )}
        <div>
          <dt>Held / awaiting reconciliation</dt>
          <dd>TZS {money(data.held)}</dd>
        </div>
        <div>
          <dt>Reserved for requests</dt>
          <dd>TZS {money(data.reserved)}</dd>
        </div>
        <div>
          <dt>{data.demo ? 'Simulated payout debits' : 'Paid out + withdrawal fees'}</dt>
          <dd>TZS {money(data.paid_out)}</dd>
        </div>
        <div>
          <dt>Refunded sales</dt>
          <dd>TZS {money(data.refunded)}</dd>
        </div>
      </dl>
      <p className="finance-note">
        <ShieldCheck size={16} />
        {data.automatic_disbursement
          ? data.demo
            ? 'Demo payouts simulate recipient verification and a TZS 100 withdrawal fee. No real money moves.'
            : 'Withdrawal fees include collection and payout charges. Final fees are confirmed before sending. Only matured earnings are available.'
          : 'Payouts are reviewed and transferred manually.'}{' '}
        Minimum request: TZS {money(data.minimum)}.
      </p>
      {data.verification === 'disabled' && (
        <ErrorBox>
          Payout requests are unavailable until verification delivery is configured.
        </ErrorBox>
      )}
      {data.verification === 'nextsms' && !data.verification_phone_ready && (
        <ErrorBox>
          <Link to="/dashboard/settings">Verify your security phone</Link> before requesting a
          payout.
        </ErrorBox>
      )}
      {data.shortfall > 0 && (
        <ErrorBox>
          A TZS {money(data.shortfall)} balance shortfall needs administrator review. New requests
          are paused.
        </ErrorBox>
      )}
      {data.legacy_orders > 0 && (
        <p className="finance-note">
          {data.legacy_orders} older orders have no fee snapshot. No Golden Events fee has been
          applied retroactively.
        </p>
      )}
      <div className="section-heading table-section-heading">
        <h2>Payout requests</h2>
      </div>
      <PayoutHistory
        payouts={data.payouts}
        onCancel={(p) => {
          setError('');
          setCancelling(p);
        }}
      />
      <div className="section-heading table-section-heading">
        <h2>Sales breakdown</h2>
        <button
          className="button small secondary"
          onClick={() =>
            downloadCSV('golden-earnings.csv', [
              [
                'Reference',
                'Event',
                'Status',
                'Gross TZS',
                'Golden fee %',
                'Golden fee TZS',
                'Provider fee TZS',
                'Net TZS',
                'Funds released',
              ],
              ...data.orders.map((o) => [
                o.reference,
                o.event_name,
                o.status,
                o.amount,
                o.platform_fee_bps / 100,
                o.platform_fee,
                o.provider_fee ?? 'Unconfirmed',
                o.net,
                o.released ? 'Yes' : 'No',
              ]),
            ])
          }
        >
          <Download size={15} />
          Statement
        </button>
      </div>
      {data.orders.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Sale</th>
                <th>Gross (TZS)</th>
                <th>Golden fee (TZS)</th>
                <th>Provider fee (TZS)</th>
                <th>Net (TZS)</th>
                <th>Funds</th>
              </tr>
            </thead>
            <tbody>
              {salesPage.rows.map((o) => (
                <tr key={o.id}>
                  <td>
                    <strong>{o.reference}</strong>
                    <small className="finance-cell-note">{o.event_name}</small>
                  </td>
                  <td className="finance-amount">{money(o.amount)}</td>
                  <td className="finance-amount">
                    {money(o.platform_fee)}
                    <small className="finance-cell-note">
                      {o.legacy ? 'Legacy · no fee applied' : `${o.platform_fee_bps / 100}%`}
                    </small>
                  </td>
                  <td>{o.provider_fee === null ? 'Unconfirmed' : money(o.provider_fee)}</td>
                  <td className="finance-amount">
                    {money(o.net)}
                    {o.provider_fee === null && (
                      <small className="finance-cell-note">Estimated</small>
                    )}
                  </td>
                  <td>{o.status === 'refunded' ? 'Refunded' : o.released ? 'Released' : 'Held'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty title="No paid sales yet">
          Your sales breakdown will appear after a ticket purchase.
        </Empty>
      )}
      {salesPage.controls}
      {requesting && (
        <PayoutForm
          finance={data}
          onClose={() => {
            setRequesting(false);
            void load();
          }}
          onSubmitted={(payout) => {
            setRequesting(false);
            void load();
            notify(
              data.automatic_disbursement
                ? payout?.status === 'paid'
                  ? data.demo
                    ? 'Demo payout completed. No real money moved.'
                    : 'Payout paid.'
                  : 'Payout submitted. Its outcome is being checked.'
                : 'Payout request submitted for review.',
            );
          }}
        />
      )}
      {cancelling && (
        <Modal title="Cancel payout request?" onClose={() => !busy && setCancelling(null)}>
          {error && <ErrorBox>{error}</ErrorBox>}
          <p className="modal-copy">
            Cancel {cancelling.reference} for TZS {money(cancelling.amount)}? The reserved amount
            will return to your available balance.
          </p>
          <div className="modal-actions">
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => setCancelling(null)}
            >
              Keep request
            </button>
            <button className="button" disabled={busy} onClick={cancel}>
              Cancel request
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
type Challenge = {
  challenge_id: string;
  email: string;
  verification_phone: string | null;
  delivery_channel: 'sms' | 'email';
  mode: string;
  expires_at: number;
  demo_code?: string;
  amount: number;
  phone: string;
  network: string;
  recipient_name: string;
};
type ProviderQuote = {
  id: string;
  amount: number;
  fee: number;
  total: number;
  account_name: string;
  account_name_source: 'rail' | 'cache' | 'merchant' | null;
  destination_verification_required: boolean;
  account_last4: string;
  destination_type: string;
  channel: string;
  expires_at: number;
  demo: boolean;
};
function ProviderPayoutForm({
  finance,
  onClose,
  onSubmitted,
}: {
  finance: Finance;
  onClose: () => void;
  onSubmitted: (payout?: Payout) => void;
}) {
  const { user } = useApp();
  const preview =
    finance.withdrawal_preview?.status === 'quoted' ? finance.withdrawal_preview : null;
  const [amount, setAmount] = useState(preview ? String(preview.amount) : ''),
    [account, setAccount] = useState(preview?.account || user?.phone || ''),
    [recipientName, setRecipientName] = useState(preview?.account_name || user?.name || ''),
    [destination, setDestination] = useState(preview?.destination_type || 'mobile_money'),
    [channel, setChannel] = useState(preview?.channel || 'MPESA'),
    [password, setPassword] = useState(''),
    [quote, setQuote] = useState<ProviderQuote | null>(null),
    [acceptedName, setAcceptedName] = useState(false),
    [challenge, setChallenge] = useState<Challenge | null>(null),
    [destinationChallenge, setDestinationChallenge] = useState<{
      challenge_id: string;
      phone: string;
      expires_at: number;
    } | null>(null),
    [destinationVerified, setDestinationVerified] = useState(false),
    [code, setCode] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [feeAdjustment, setFeeAdjustment] = useState<{
      quoted_fee: number;
      allowance_applied: number;
      suggested_amount: number;
    } | null>(null),
    [now, setNow] = useState(Date.now());
  const quoteKey = useRef(crypto.randomUUID()),
    otpKey = useRef(crypto.randomUUID());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const reset = () => {
    setQuote(null);
    setChallenge(null);
    setDestinationChallenge(null);
    setDestinationVerified(false);
    setAcceptedName(false);
    setCode('');
    setPassword('');
    setError('');
    setFeeAdjustment(null);
    quoteKey.current = crypto.randomUUID();
    otpKey.current = crypto.randomUUID();
  };
  const expires = challenge?.expires_at || destinationChallenge?.expires_at || quote?.expires_at;
  const remaining = expires ? Math.max(0, Math.ceil((expires - now) / 1000)) : 0;
  const sendVerification = async (q: ProviderQuote, destinationReady = destinationVerified) => {
    if (q.destination_verification_required && !destinationReady) {
      const c = await send<{ challenge_id: string; phone: string; expires_at: number }>(
        '/organizer/payouts/destination/code',
        {
          quote_id: q.id,
          password,
        },
      );
      setDestinationChallenge(c);
    } else {
      const c = await send<Challenge>('/organizer/payouts/code', {
        quote_id: q.id,
        account_name_confirmed: true,
        password,
        idempotency_key: otpKey.current,
      });
      setChallenge(c);
      setPassword('');
    }
    setCode('');
    setNow(Date.now());
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setFeeAdjustment(null);
    try {
      if (challenge) {
        const result = await send<{ payout: Payout }>(
          `/organizer/payouts/${challenge.challenge_id}/confirm`,
          { code },
        );
        onSubmitted(result.payout);
      } else if (quote && destinationChallenge) {
        await send('/organizer/payouts/destination/verify', {
          quote_id: quote.id,
          challenge_id: destinationChallenge.challenge_id,
          code,
        });
        setDestinationVerified(true);
        setDestinationChallenge(null);
        await sendVerification(quote, true);
      } else if (quote) {
        await sendVerification(quote);
      } else {
        const response = await send<{ quote: ProviderQuote }>('/organizer/payouts/quote', {
          amount: Number(amount),
          account,
          account_name: recipientName,
          destination_type: destination,
          channel,
          password,
          idempotency_key: quoteKey.current,
        });
        setQuote(response.quote);
        setNow(Date.now());
        await sendVerification(response.quote);
      }
    } catch (e) {
      if (e instanceof ApiError && !quote) {
        const adjustment = e.data.payout_adjustment as Record<string, unknown> | undefined;
        if (
          adjustment &&
          ['quoted_fee', 'allowance_applied', 'suggested_amount'].every(
            (k) =>
              typeof adjustment[k] === 'number' &&
              Number.isSafeInteger(adjustment[k]) &&
              (adjustment[k] as number) >= 0,
          )
        )
          setFeeAdjustment(
            adjustment as {
              quoted_fee: number;
              allowance_applied: number;
              suggested_amount: number;
            },
          );
      }
      if (!challenge && e instanceof ApiError && [400, 401, 409, 422, 503].includes(e.status)) {
        if (!quote) quoteKey.current = crypto.randomUUID();
        else otpKey.current = crypto.randomUUID();
      }
      if (quote && !challenge && e instanceof ApiError && e.status === 502)
        otpKey.current = crypto.randomUUID();
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={
        destinationChallenge
          ? 'Verify payout number'
          : challenge
            ? 'Confirm your payout'
            : quote
              ? 'Continue withdrawal'
              : 'Withdraw your earnings'
      }
      onClose={() => !busy && onClose()}
    >
      <form className="payout-form provider-payout-form" onSubmit={submit}>
        {error && <ErrorBox>{error}</ErrorBox>}
        {feeAdjustment && !quote && (
          <div className="finance-note finance-fee-adjustment" role="status">
            <span>
              Withdrawal fee: TZS {money(feeAdjustment.quoted_fee)}. Covered by allowance: TZS{' '}
              {money(feeAdjustment.allowance_applied)}.
            </span>
            {feeAdjustment.suggested_amount >= finance.minimum &&
              feeAdjustment.suggested_amount <= finance.available && (
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy}
                  onClick={() => {
                    setAmount(String(feeAdjustment.suggested_amount));
                    quoteKey.current = crypto.randomUUID();
                    setFeeAdjustment(null);
                    setError('');
                  }}
                >
                  Use TZS {money(feeAdjustment.suggested_amount)}
                </button>
              )}
          </div>
        )}
        {quote ? (
          <>
            <div className="payout-verified-name">
              {quote.account_name_source === 'rail' ? (
                <ShieldCheck size={20} />
              ) : (
                <UserRound size={20} />
              )}
              <div>
                <span>
                  {quote.demo
                    ? 'Demo recipient'
                    : quote.account_name_source === 'merchant'
                      ? 'Recipient name you entered'
                      : quote.account_name_source === 'cache'
                        ? 'Name from Ecofy cache'
                        : quote.account_name_source === 'rail'
                          ? 'Name from payment network'
                          : 'Recipient'}
                </span>
                <strong>{quote.account_name}</strong>
                <small>
                  {networks[quote.channel]} · account ending {quote.account_last4}
                </small>
              </div>
            </div>
            <dl className="payout-confirmation">
              <div>
                <dt>Recipient receives</dt>
                <dd>TZS {money(quote.amount)}</dd>
              </div>
              <div>
                <dt>{quote.demo ? 'Simulated withdrawal fee' : 'Ecofy withdrawal fee'}</dt>
                <dd>TZS {money(quote.fee)}</dd>
              </div>
              <div>
                <dt>Total deducted</dt>
                <dd>TZS {money(quote.total)}</dd>
              </div>
              <div>
                <dt>Remaining earnings</dt>
                <dd>
                  TZS{' '}
                  {money(
                    Math.max(
                      0,
                      finance.withdrawal_capacity -
                        quote.total -
                        Math.max(0, finance.provider_fee_reserve - quote.fee),
                    ),
                  )}
                </dd>
              </div>
              {finance.provider_fee_reserve > 0 && (
                <div>
                  <dt>Withdrawal fee covered by allowance</dt>
                  <dd>TZS {money(Math.min(finance.provider_fee_reserve, quote.fee))}</dd>
                </div>
              )}
            </dl>
            {challenge || destinationChallenge ? (
              <>
                <p className="finance-note">
                  {destinationChallenge
                    ? `Code sent to payout number ${destinationChallenge.phone}.`
                    : `Authorization code sent to ${challenge!.verification_phone || challenge!.email}. Confirming authorizes this recipient, amount and fee.`}
                </p>
                {challenge?.demo_code && (
                  <div className="notice">
                    <LockKeyhole size={17} />
                    <span>
                      Demo only: <strong>{challenge.demo_code}</strong>
                    </span>
                  </div>
                )}
                <label>
                  {destinationChallenge ? 'Payout number verification code' : 'Verification code'}
                  <input
                    autoFocus
                    required
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    disabled={busy}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  />
                </label>
              </>
            ) : null}
            {challenge && (
              <label className="finance-check">
                <input
                  required
                  type="checkbox"
                  disabled={busy}
                  checked={acceptedName}
                  onChange={(e) => setAcceptedName(e.target.checked)}
                />
                <span>I confirm the recipient, destination and withdrawal fee.</span>
              </label>
            )}
            <span className="finance-note">
              <Clock size={15} />
              {remaining
                ? `Expires in ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`
                : 'Expired. Get a new quote and verify the recipient again.'}
            </span>
            <div className="modal-actions">
              <button type="button" className="button secondary" disabled={busy} onClick={reset}>
                Start again
              </button>
              <button
                className="button primary"
                disabled={busy || !remaining || (!!challenge && !acceptedName)}
              >
                <ShieldCheck size={16} />
                {busy
                  ? 'Processing...'
                  : challenge
                    ? quote.demo
                      ? 'Simulate payout'
                      : `Send TZS ${money(quote.amount)}`
                    : destinationChallenge
                      ? 'Verify number'
                      : 'Send verification code'}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="finance-note">
              {preview
                ? `You receive TZS ${money(preview.amount)}. Total withdrawal fees: TZS ${money(preview.combined_fees)} (including collection charges).`
                : 'Choose your amount and destination. All withdrawal fees are confirmed before sending.'}
            </p>
            <label>
              Amount to recipient (TZS)
              <input
                type="number"
                min={finance.minimum}
                max={finance.available}
                step="1"
                required
                disabled={busy}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
            <fieldset className="payout-destination-modes" disabled={busy}>
              <legend>Destination</legend>
              <label>
                <input
                  type="radio"
                  name="destination"
                  checked={destination === 'mobile_money'}
                  onChange={() => {
                    setDestination('mobile_money');
                    setChannel('MPESA');
                    setAccount('');
                  }}
                />
                Mobile money
              </label>
              <label>
                <input
                  type="radio"
                  name="destination"
                  checked={destination === 'bank'}
                  onChange={() => {
                    setDestination('bank');
                    setChannel('CRDB');
                    setAccount('');
                  }}
                />
                Bank account
              </label>
            </fieldset>
            <label>
              {destination === 'bank' ? 'Bank' : 'Network'}
              <select
                aria-label={destination === 'bank' ? 'Bank' : 'Network'}
                value={channel}
                disabled={busy}
                onChange={(e) => setChannel(e.target.value)}
              >
                {(destination === 'bank' ? ['CRDB', 'NMB'] : ['MPESA', 'AIRTELMONEY']).map((id) => (
                  <option key={id} value={id}>
                    {networks[id]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {destination === 'bank' ? 'Bank account number' : 'Mobile-money number'}
              <input
                required
                inputMode="numeric"
                maxLength={30}
                disabled={busy}
                value={account}
                onChange={(e) => setAccount(e.target.value)}
                placeholder={destination === 'bank' ? 'Account number' : '07XXXXXXXX'}
              />
            </label>
            <label>
              Recipient account name
              <input
                required
                minLength={2}
                maxLength={100}
                value={recipientName}
                disabled={busy}
                onChange={(e) => setRecipientName(e.target.value)}
                autoComplete="name"
              />
            </label>
            <label>
              Your account password
              <input
                type="password"
                autoComplete="current-password"
                required
                maxLength={128}
                disabled={busy}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <div className="modal-actions">
              <button type="button" className="button secondary" disabled={busy} onClick={onClose}>
                Cancel
              </button>
              <button className="button primary" disabled={busy}>
                <ArrowUpRight size={16} />
                {busy ? 'Preparing withdrawal...' : 'Continue'}
              </button>
            </div>
          </>
        )}
      </form>
    </Modal>
  );
}
function PayoutForm(props: {
  finance: Finance;
  onClose: () => void;
  onSubmitted: (payout?: Payout) => void;
}) {
  return props.finance.automatic_disbursement ? (
    <ProviderPayoutForm {...props} />
  ) : (
    <ManualPayoutForm {...props} />
  );
}
function ManualPayoutForm({
  finance,
  onClose,
  onSubmitted,
}: {
  finance: Finance;
  onClose: () => void;
  onSubmitted: (payout?: Payout) => void;
}) {
  const { user } = useApp();
  const [amount, setAmount] = useState(String(finance.available)),
    [phone, setPhone] = useState(user?.phone || ''),
    [network, setNetwork] = useState('mpesa'),
    [name, setName] = useState(user?.name || ''),
    [password, setPassword] = useState(''),
    [challenge, setChallenge] = useState<Challenge | null>(null),
    [code, setCode] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [now, setNow] = useState(Date.now());
  const key = useRef(crypto.randomUUID());
  useEffect(() => {
    if (!challenge) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [challenge]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (challenge) {
        await send(`/organizer/payouts/${challenge.challenge_id}/confirm`, { code });
        onSubmitted();
      } else {
        const next = await send<Challenge>('/organizer/payouts/code', {
          amount: Number(amount),
          phone,
          network,
          recipient_name: name,
          password,
          idempotency_key: key.current,
        });
        setChallenge(next);
        setAmount(String(next.amount));
        setPhone(next.phone);
        setNetwork(next.network);
        setName(next.recipient_name);
        setPassword('');
        setNow(Date.now());
      }
    } catch (e) {
      if (!challenge && e instanceof ApiError && [409, 502].includes(e.status))
        key.current = crypto.randomUUID();
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const remaining = challenge ? Math.max(0, Math.ceil((challenge.expires_at - now) / 1000)) : 0;
  return (
    <Modal
      title={challenge ? 'Verify payout request' : 'Request a payout'}
      onClose={() => !busy && onClose()}
    >
      <form className="payout-form" onSubmit={submit}>
        {error && <ErrorBox>{error}</ErrorBox>}
        {challenge ? (
          <>
            <dl className="payout-confirmation">
              <div>
                <dt>Amount</dt>
                <dd>TZS {money(Number(amount))}</dd>
              </div>
              <div>
                <dt>Recipient</dt>
                <dd>{name}</dd>
              </div>
              <div>
                <dt>Mobile money</dt>
                <dd>
                  {networks[network]}
                  <small>{phone}</small>
                </dd>
              </div>
            </dl>
            <p className="finance-note">
              {challenge.mode === 'demo' ? 'Demo verification code' : 'Verification code sent to'}{' '}
              {challenge.verification_phone || challenge.email}. Confirming reserves funds for
              review, not an instant transfer.
            </p>
            {challenge.demo_code && (
              <div className="notice">
                <LockKeyhole size={17} />
                <span>
                  Demo only: <strong>{challenge.demo_code}</strong>
                </span>
              </div>
            )}
            <label>
              Verification code
              <input
                autoFocus
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                placeholder="6-digit code"
              />
            </label>
            <span className="finance-note">
              <Clock size={15} />
              {remaining
                ? `Expires in ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`
                : 'Code expired. Request a new code.'}
            </span>
            <div className="modal-actions">
              <button
                className="button secondary"
                type="button"
                disabled={busy}
                onClick={() => {
                  setChallenge(null);
                  setCode('');
                  setError('');
                  key.current = crypto.randomUUID();
                }}
              >
                Edit / resend
              </button>
              <button className="button primary" disabled={busy || !remaining}>
                <ShieldCheck size={16} />
                {busy ? 'Submitting…' : 'Confirm request'}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="finance-note">
              Available: TZS {money(finance.available)}. Requests can be made before or after your
              event.
            </p>
            <label>
              Amount (TZS)
              <input
                type="number"
                min={finance.minimum}
                max={finance.available}
                step="1"
                required
                value={amount}
                disabled={busy}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
            <label>
              Mobile-money network
              <select value={network} disabled={busy} onChange={(e) => setNetwork(e.target.value)}>
                {['mpesa', 'airtel', 'mixx', 'halopesa'].map((id) => (
                  <option key={id} value={id}>
                    {networks[id]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Mobile-money number
              <input
                type="tel"
                autoComplete="tel"
                required
                value={phone}
                disabled={busy}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="07XXXXXXXX"
              />
            </label>
            <label>
              Registered recipient name
              <input
                required
                minLength={2}
                maxLength={100}
                value={name}
                disabled={busy}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
              />
            </label>
            <label>
              Your account password
              <input
                type="password"
                autoComplete="current-password"
                required
                maxLength={128}
                value={password}
                disabled={busy}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <p className="finance-note">
              <LockKeyhole size={16} />A verification code goes to{' '}
              {finance.verification === 'nextsms'
                ? `your verified phone ${finance.verification_phone}`
                : 'your account email'}
              . Recipient details are checked during review.
            </p>
            <div className="modal-actions">
              <button className="button secondary" type="button" disabled={busy} onClick={onClose}>
                Cancel
              </button>
              <button className="button primary" disabled={busy}>
                <ArrowUpRight size={16} />
                {busy ? 'Sending…' : 'Send verification code'}
              </button>
            </div>
          </>
        )}
      </form>
    </Modal>
  );
}
type Settlement = {
  id: string;
  reference: string;
  amount: number;
  platform_fee: number | null;
  platform_fee_bps: number | null;
  event_name: string;
  owner_name: string;
  owner_email: string;
  provider: string;
};
type AdminFinanceData = {
  demo: boolean;
  automatic_disbursement: boolean;
  settlements: Settlement[];
  payouts: Payout[];
  audit: {
    id: string;
    reference: string;
    actor_name: string;
    action: string;
    note: string;
    created_at: string;
  }[];
};
export function AdminPayouts() {
  const { notify } = useApp();
  const [data, setData] = useState<AdminFinanceData | null>(null),
    [error, setError] = useState(''),
    [settlement, setSettlement] = useState<Settlement | null>(null),
    [payout, setPayout] = useState<Payout | null>(null),
    [saleQuery, setSaleQuery] = useState(''),
    [requestView, setRequestView] = useState('open');
  const payoutRows = (data?.payouts || []).filter(
    (p) => requestView === 'all' || ['requested', 'processing'].includes(p.status),
  );
  const payoutPage = useFinancePage(payoutRows, 'review queue');
  const saleRows = (data?.settlements || []).filter((s) =>
    `${s.reference} ${s.owner_name} ${s.owner_email} ${s.event_name}`
      .toLowerCase()
      .includes(saleQuery.toLowerCase()),
  );
  const salePage = useFinancePage(saleRows, 'reconciliation');
  const auditPage = useFinancePage(data?.audit || [], 'audit');
  const load = () =>
    api<AdminFinanceData>('/admin/finance')
      .then((d) => {
        setData(d);
        setError('');
      })
      .catch((e) => setError(e.message));
  useEffect(() => {
    void load();
  }, []);
  const completed = () => {
    setSettlement(null);
    setPayout(null);
    void load();
    notify('Finance record updated.');
  };
  return (
    <section className="finance-section admin-finance">
      <div className="section-heading table-section-heading">
        <h2>Organizer payouts</h2>
        <button
          className="icon-button"
          aria-label="Refresh payout queue"
          title="Refresh payout queue"
          onClick={load}
        >
          <RefreshCw size={17} />
        </button>
      </div>
      {error && <ErrorBox>{error}</ErrorBox>}
      {!data ? (
        <Spinner />
      ) : (
        <>
          <div className="notice">
            <ShieldCheck size={19} />
            <span>
              {data.demo
                ? 'Demo records only. Do not send money for these requests.'
                : data.automatic_disbursement
                  ? 'Provider payouts are read-only. Ecofy outcomes are verified automatically; never send a second manual transfer.'
                  : 'Manual review only. Verify provider funds and recipient ownership before any transfer.'}
            </span>
          </div>
          <div className="finance-queue-filter">
            <select
              aria-label="Payout queue view"
              value={requestView}
              onChange={(e) => setRequestView(e.target.value)}
            >
              <option value="open">Open requests</option>
              <option value="all">All requests</option>
            </select>
          </div>
          {payoutRows.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Organizer</th>
                    <th>Request</th>
                    <th>Recipient</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {payoutPage.rows.map((p) => (
                    <tr key={p.id}>
                      <td>
                        {p.owner_name}
                        <small className="finance-cell-note">{p.owner_email}</small>
                      </td>
                      <td>
                        {p.reference}
                        <small className="finance-cell-note">{dateLabel(p.created_at)}</small>
                      </td>
                      <td>
                        {p.recipient_name}
                        <small className="finance-cell-note">
                          {networks[p.network]} · {p.phone}
                        </small>
                      </td>
                      <td className="finance-amount">TZS {money(p.amount)}</td>
                      <td>
                        <PayoutStatus payout={p} />
                      </td>
                      <td>
                        {p.driver === 'manual' && ['requested', 'processing'].includes(p.status) ? (
                          <button className="button small secondary" onClick={() => setPayout(p)}>
                            <ShieldCheck size={15} />
                            Review
                          </button>
                        ) : (
                          <span className="finance-review-note">
                            {p.transfer_reference || p.note}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="No payout requests">Verified organizer requests will appear here.</Empty>
          )}
          {payoutPage.controls}
          {!data.automatic_disbursement && (
            <>
              <div className="section-heading table-section-heading">
                <h2>Funds awaiting reconciliation</h2>
                <span className="muted">{data.settlements.length} paid sales</span>
              </div>
              <p className="finance-note">
                Release only funds actually received, after checking provider fees and refund
                exposure. Both pre-event and post-event releases require review.
              </p>
              <div className="finance-queue-filter">
                <input
                  type="search"
                  aria-label="Search reconciliation sales"
                  placeholder="Search reference, event or organizer"
                  value={saleQuery}
                  onChange={(e) => setSaleQuery(e.target.value)}
                />
              </div>
              {saleRows.length > 0 && (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Sale / event</th>
                        <th>Organizer</th>
                        <th>Gross</th>
                        <th>Golden fee</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {salePage.rows.map((s) => (
                        <tr key={s.id}>
                          <td>
                            {s.reference}
                            <small className="finance-cell-note">
                              {s.event_name} · {s.provider}
                            </small>
                          </td>
                          <td>
                            {s.owner_name}
                            <small className="finance-cell-note">{s.owner_email}</small>
                          </td>
                          <td className="finance-amount">TZS {money(s.amount)}</td>
                          <td className="finance-amount">
                            TZS {money(s.platform_fee ?? 0)}
                            <small className="finance-cell-note">
                              {s.platform_fee_bps === null
                                ? 'Legacy · no fee applied'
                                : `${s.platform_fee_bps / 100}%`}
                            </small>
                          </td>
                          <td>
                            <button
                              className="button small secondary"
                              onClick={() => setSettlement(s)}
                            >
                              <Check size={15} />
                              Reconcile
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {salePage.controls}
            </>
          )}
          {data.audit.length > 0 && (
            <>
              <div className="section-heading table-section-heading">
                <h2>Finance audit trail</h2>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Request</th>
                      <th>Action</th>
                      <th>By</th>
                      <th>Note</th>
                      <th>Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditPage.rows.map((a) => (
                      <tr key={a.id}>
                        <td>{a.reference}</td>
                        <td>{a.action}</td>
                        <td>{a.actor_name}</td>
                        <td className="finance-review-note">{a.note}</td>
                        <td>
                          {dateLabel(a.created_at)} {timeLabel(a.created_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {auditPage.controls}
            </>
          )}
        </>
      )}
      {settlement && (
        <SettlementForm
          sale={settlement}
          demo={!!data?.demo}
          onClose={() => setSettlement(null)}
          onDone={completed}
        />
      )}
      {payout && <ReviewForm payout={payout} onClose={() => setPayout(null)} onDone={completed} />}
    </section>
  );
}
function SettlementForm({
  sale,
  demo,
  onClose,
  onDone,
}: {
  sale: Settlement;
  demo: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [fee, setFee] = useState(''),
    [reference, setReference] = useState(''),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const net = sale.amount - (sale.platform_fee ?? 0) - Number(fee);
  return (
    <Modal title="Reconcile received funds" onClose={() => !busy && onClose()}>
      <form
        className="payout-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          try {
            await send(`/admin/finance/orders/${sale.id}/reconcile`, {
              provider_fee: Number(fee),
              reference,
              funds_received: confirmed,
            });
            onDone();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {error && <ErrorBox>{error}</ErrorBox>}
        <p>
          {sale.reference} · {sale.owner_name}
        </p>
        <label>
          Actual provider fee (TZS)
          <input
            type="number"
            min="0"
            max={sale.amount - (sale.platform_fee ?? 0)}
            step="1"
            required
            value={fee}
            onChange={(e) => setFee(e.target.value)}
          />
        </label>
        <label>
          Provider settlement / statement reference
          <input
            required
            minLength={4}
            maxLength={120}
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
        </label>
        <dl className="payout-confirmation">
          <div>
            <dt>Net released to organizer</dt>
            <dd>TZS {money(net)}</dd>
          </div>
        </dl>
        <label className="finance-check">
          <input
            type="checkbox"
            required
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          <span>
            {demo
              ? 'I confirm this is a simulated settlement, not real money.'
              : 'I verified these funds were received, the fees match the provider statement, and this release is safe after reviewing refund exposure.'}
          </span>
        </label>
        <div className="modal-actions">
          <button type="button" className="button secondary" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={busy || !confirmed}>
            <Check size={16} />
            {busy ? 'Saving…' : 'Release reconciled funds'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function ReviewForm({
  payout,
  onClose,
  onDone,
}: {
  payout: Payout;
  onClose: () => void;
  onDone: () => void;
}) {
  const [action, setAction] = useState(payout.status === 'requested' ? 'processing' : 'paid'),
    [note, setNote] = useState(''),
    [reference, setReference] = useState(''),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const needsConfirmation =
    action === 'paid' || (action === 'rejected' && payout.status === 'processing');
  return (
    <Modal title={`Review ${payout.reference}`} onClose={() => !busy && onClose()}>
      <form
        className="payout-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          try {
            await send(`/admin/payouts/${payout.id}/review`, {
              action,
              note,
              ...(action === 'paid'
                ? { transfer_reference: reference, transfer_confirmed: confirmed }
                : { confirmed_not_sent: confirmed }),
            });
            onDone();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {error && <ErrorBox>{error}</ErrorBox>}
        <dl className="payout-confirmation">
          <div>
            <dt>Amount to recipient</dt>
            <dd>TZS {money(payout.amount)}</dd>
          </div>
          <div>
            <dt>Recipient</dt>
            <dd>
              {payout.recipient_name}
              <small>
                {networks[payout.network]} · {payout.phone}
              </small>
            </dd>
          </div>
        </dl>
        <p className="finance-note">
          {payout.mode === 'demo'
            ? 'Simulation only. Do not send real money.'
            : 'This form records a manual transfer. It does not send money. Verify the beneficiary and complete the transfer outside this application.'}
        </p>
        <label>
          Decision
          <select
            value={action}
            onChange={(e) => {
              setAction(e.target.value);
              setConfirmed(false);
            }}
          >
            <option value={payout.status === 'requested' ? 'processing' : 'paid'}>
              {payout.status === 'requested'
                ? 'Approve for manual transfer'
                : payout.mode === 'demo'
                  ? 'Record simulated transfer'
                  : 'Record completed transfer'}
            </option>
            <option value="rejected">Reject request</option>
          </select>
        </label>
        <label>
          Review note
          <textarea
            required
            minLength={5}
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        {action === 'paid' && (
          <label>
            Completed transfer reference
            <input
              required
              minLength={4}
              maxLength={120}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </label>
        )}
        {needsConfirmation && (
          <label className="finance-check">
            <input
              type="checkbox"
              required
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            <span>
              {action === 'paid'
                ? payout.mode === 'demo'
                  ? 'This is a simulated completed transfer.'
                  : 'I verified the recipient received the full requested amount and the provider reference is correct.'
                : 'I verified no transfer was sent. It is safe to release reserved funds.'}
            </span>
          </label>
        )}
        <div className="modal-actions">
          <button type="button" className="button secondary" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={busy || (needsConfirmation && !confirmed)}>
            <ShieldCheck size={16} />
            {busy ? 'Saving…' : 'Save review'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
