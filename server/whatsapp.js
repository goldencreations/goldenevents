import { renderTicketImage } from './ticket-image.js';

let templateCache;
let senderCache;
async function senderNumber() {
  const id = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (senderCache?.id === id && senderCache.until > Date.now()) return senderCache.number;
  const phone = await graphRequest(`${id}?fields=display_phone_number`);
  const number = String(phone.display_phone_number || '').replace(/\D/g, '');
  if (!number) throw new Error('WhatsApp sender number could not be verified.');
  senderCache = { id, number, until: Date.now() + 3600000 };
  return number;
}
export async function metaTemplateReady() {
  if (!metaWhatsAppConfigured()) throw new Error('Meta WhatsApp delivery is not configured.');
  const account = process.env.WHATSAPP_BUSINESS_ID;
  if (!/^\d+$/.test(account || '')) throw new Error('WhatsApp business account ID is required.');
  const name = process.env.WHATSAPP_TEMPLATE_NAME;
  const language = process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'en';
  const key = `${account}:${name}:${language}`;
  if (templateCache?.key === key && templateCache.until > Date.now()) return templateCache.ready;
  const result = await graphRequest(
    `${account}/message_templates?name=${encodeURIComponent(name)}&fields=name,status,language,components`,
  );
  const template = result.data?.find((item) => item.name === name && item.language === language);
  if (!template) throw new Error('WhatsApp ticket template was not found.');
  if (template.status === 'PENDING') {
    templateCache = { key, ready: false, until: Date.now() + 60000 };
    return false;
  }
  if (template.status !== 'APPROVED') throw new Error('WhatsApp ticket template is not approved.');
  const components = template.components || [];
  if (
    !components.some((item) => item.type === 'HEADER' && item.format === 'IMAGE') ||
    components.some((item) => item.type === 'BUTTONS' || /\{\{/.test(item.text || ''))
  )
    throw new Error('WhatsApp template must have an image header and no variables or buttons.');
  templateCache = { key, ready: true, until: Date.now() + 60000 };
  return true;
}

export function metaWhatsAppConfigured() {
  return (
    process.env.WHATSAPP_DRIVER === 'meta' &&
    !!(
      process.env.WHATSAPP_PHONE_NUMBER_ID &&
      (process.env.WHATSAPP_ACCESS_TOKEN || process.env.PERMANENT_WHATSAPP_ACCESS_TOKEN) &&
      process.env.WHATSAPP_TEMPLATE_NAME
    )
  );
}

export async function graphRequest(resource, options = {}) {
  const version = process.env.WHATSAPP_GRAPH_API_VERSION || 'v25.0';
  if (!/^v\d+\.0$/.test(version)) throw new Error('Invalid WhatsApp API version.');
  const response = await fetch(`https://graph.facebook.com/${version}/${resource}`, {
    ...options,
    signal: AbortSignal.timeout(30000),
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN || process.env.PERMANENT_WHATSAPP_ACCESS_TOKEN}`,
      ...options.headers,
    },
  });
  const data = await response.json();
  // Provider messages may echo customer data; retain only numeric error codes.
  if (!response.ok || data.error)
    throw new Error(
      `WhatsApp request rejected (${data.error?.code || response.status}/${data.error?.error_subcode || 0}).`,
    );
  return data;
}

export async function sendMetaTickets(db, delivery, config) {
  if (!metaWhatsAppConfigured()) throw new Error('Meta WhatsApp delivery is not configured.');
  const tickets = db
    .prepare(
      `SELECT t.*, tt.name AS ticket_type FROM tickets t
    JOIN orders o ON o.id=t.order_id JOIN ticket_types tt ON tt.id=o.ticket_type_id
    JOIN events e ON e.id=t.event_id WHERE t.order_id=? AND o.status='paid'
    AND e.status!='cancelled' AND t.claimed_at IS NULL AND t.checked_in_at IS NULL`,
    )
    .all(delivery.order_id);
  if (tickets.length && delivery.recipient.replace(/\D/g, '') === (await senderNumber()))
    throw new Error('WhatsApp cannot send a ticket to its own business sender number.');
  let accepted = 0;
  for (const ticket of tickets) {
    db.prepare(
      'INSERT OR IGNORE INTO whatsapp_ticket_messages (delivery_id,ticket_id,ticket_token) VALUES (?,?,?)',
    ).run(delivery.id, ticket.id, ticket.token);
    const progress = db
      .prepare('SELECT * FROM whatsapp_ticket_messages WHERE delivery_id=? AND ticket_id=?')
      .get(delivery.id, ticket.id);
    if (progress.message_id) {
      accepted++;
      continue;
    }
    const event = db.prepare('SELECT * FROM events WHERE id=?').get(ticket.event_id);
    let mediaId = progress.media_id;
    if (!mediaId) {
      const image = await renderTicketImage(event, ticket, config);
      const form = new FormData();
      form.set('messaging_product', 'whatsapp');
      form.set('file', new Blob([image], { type: 'image/png' }), 'ticket.png');
      const media = await graphRequest(`${process.env.WHATSAPP_PHONE_NUMBER_ID}/media`, {
        method: 'POST',
        body: form,
      });
      if (!media.id) throw new Error('WhatsApp did not return a media ID.');
      mediaId = media.id;
      db.prepare(
        'UPDATE whatsapp_ticket_messages SET media_id=? WHERE delivery_id=? AND ticket_id=?',
      ).run(mediaId, delivery.id, ticket.id);
    }
    // Recheck credentials after network waits; a claimed ticket belongs only to its new holder.
    const current = db
      .prepare(
        `SELECT t.token FROM tickets t JOIN orders o ON o.id=t.order_id JOIN events e ON e.id=t.event_id
      WHERE t.id=? AND t.claimed_at IS NULL AND t.checked_in_at IS NULL AND o.status='paid' AND e.status!='cancelled'`,
      )
      .get(ticket.id);
    if (!current || current.token !== progress.ticket_token) continue;
    const result = await graphRequest(`${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: delivery.recipient.replace(/^\+/, ''),
        type: 'template',
        template: {
          name: process.env.WHATSAPP_TEMPLATE_NAME,
          language: { code: process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'en' },
          components: [{ type: 'header', parameters: [{ type: 'image', image: { id: mediaId } }] }],
        },
      }),
    });
    if (!result.messages?.[0]?.id)
      throw new Error('WhatsApp did not acknowledge the ticket message.');
    db.prepare(
      'UPDATE whatsapp_ticket_messages SET message_id=? WHERE delivery_id=? AND ticket_id=?',
    ).run(result.messages[0].id, delivery.id, ticket.id);
    accepted++;
  }
  return accepted > 0;
}
