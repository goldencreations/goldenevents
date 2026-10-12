import { ecofyRequest } from './ecofy.js';

const money = (n) => Number.isSafeInteger(n) && n >= 0;
export async function ecofyBalance(config) {
  const b = await ecofyRequest(config, '/v1/balance');
  if (b.currency !== 'TZS' || !['available', 'pending', 'reserved'].every((k) => money(b[k])))
    throw new Error('Invalid Ecofy wallet balance.');
  return b;
}
export async function ecofyQuote(config, quote) {
  const q = await ecofyRequest(config, '/v1/payouts/quote', {
    method: 'POST',
    headers: { 'Idempotency-Key': `goldenevents-quote-${quote.id}` },
    body: JSON.stringify({
      amount: quote.amount,
      type: quote.destination_type,
      channel: quote.channel,
      account: quote.account,
      ...(quote.skip_account_check
        ? { skip_account_check: true, account_name: quote.account_name }
        : {}),
    }),
  });
  if (
    typeof q.id !== 'string' ||
    (q.currency !== undefined && q.currency !== 'TZS') ||
    !/^pq_[A-Za-z0-9]+$/.test(q.id) ||
    q.amount !== quote.amount ||
    !money(q.fee) ||
    !money(q.total) ||
    q.total !== q.amount + q.fee ||
    q.account_last4 !== quote.account.slice(-4) ||
    typeof q.account_name !== 'string' ||
    !q.account_name.trim() ||
    q.account_name.length > 200 ||
    !['rail', 'cache', 'merchant'].includes(q.account_name_source) ||
    (q.account_name_source === 'merchant' &&
      (!quote.skip_account_check || q.account_name.trim() !== quote.account_name)) ||
    !Number.isFinite(Date.parse(q.expires_at))
  )
    throw new Error('Ecofy payout quote verification mismatch.');
  return { ...q, account_name: q.account_name.trim(), expires_at: Date.parse(q.expires_at) };
}
export function validateEcofyPayout(p, expected) {
  if (
    typeof p?.id !== 'string' ||
    (p.currency !== undefined && p.currency !== 'TZS') ||
    !/^po_[A-Za-z0-9]+$/.test(p.id) ||
    (expected.provider_id && p.id !== expected.provider_id) ||
    p.reference !== expected.reference ||
    p.amount !== expected.amount ||
    p.fee !== expected.payout_fee ||
    p.total !== expected.amount + expected.payout_fee ||
    !['paid', 'processing', 'failed'].includes(p.status)
  )
    throw new Error('Ecofy payout verification mismatch.');
  return p;
}
export async function sendEcofyPayout(config, payout, quote) {
  return validateEcofyPayout(
    await ecofyRequest(config, '/v1/payouts', {
      method: 'POST',
      headers: { 'Idempotency-Key': `goldenevents-payout-${payout.id}` },
      body: JSON.stringify({ quote: quote.external_id, reference: payout.reference }),
    }),
    payout,
  );
}
export async function findEcofyPayout(config, payout) {
  if (payout.provider_id) return payout.provider_id;
  let before;
  for (let page = 0; page < 10; page++) {
    const params = new URLSearchParams({ limit: '100', ...(before ? { before } : {}) });
    const list = await ecofyRequest(config, `/v1/payouts?${params}`);
    if (!Array.isArray(list.data)) throw new Error('Invalid Ecofy payout list.');
    const found = list.data.find((p) => p.reference === payout.reference);
    if (found) return validateEcofyPayout(found, payout).id;
    if (list.has_more === false) return null;
    if (typeof list.next_before !== 'string' || !list.next_before || list.next_before === before)
      throw new Error('Invalid Ecofy payout cursor.');
    before = list.next_before;
  }
  throw new Error('Ecofy payout lookup needs another review.');
}
export async function fetchEcofyPayout(config, payout, id) {
  if (!/^po_[A-Za-z0-9]+$/.test(id)) throw new Error('Invalid Ecofy payout ID.');
  return validateEcofyPayout(await ecofyRequest(config, `/v1/payouts/${encodeURIComponent(id)}`), {
    ...payout,
    provider_id: id,
  });
}
