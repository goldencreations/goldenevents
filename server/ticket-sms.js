export function ticketSmsBody(db, orderId, config) {
  const order = db
    .prepare(
      `SELECT o.token,e.name FROM orders o JOIN events e ON e.id=o.event_id
       WHERE o.id=? AND o.status='paid' AND e.status!='cancelled'`,
    )
    .get(orderId);
  if (!order) return null;
  // Claimed tickets belong to their new holders, never to the original buyer's SMS.
  const tickets = db
    .prepare(
      `SELECT code FROM tickets WHERE order_id=? AND claimed_at IS NULL
       AND checked_in_at IS NULL ORDER BY created_at,id`,
    )
    .all(orderId);
  if (!tickets.length) return null;
  const name = order.name.replace(/\s+/g, ' ').trim().slice(0, 100);
  return [
    `Golden Events: ${name}`,
    tickets.length === 1
      ? `Entry code: ${tickets[0].code}`
      : `Entry codes (one per person): ${tickets.map((ticket) => ticket.code).join(', ')}`,
    `${config.publicOrigin}/order/${order.token}`,
    'Open for QR tickets, or show your entry code at the gate. Keep private.',
  ].join('\n');
}
