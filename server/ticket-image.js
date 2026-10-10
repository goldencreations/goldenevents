import sharp from 'sharp';
import QRCode from 'qrcode';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

const escape = (text) =>
  String(text || '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c],
  );
function wrap(text, length = 32) {
  const lines = [];
  let line = '';
  for (const word of String(text).split(/\s+/)) {
    if ((line + ' ' + word).trim().length > length && line) {
      lines.push(line);
      line = '';
    }
    for (let offset = 0; offset < word.length; offset += length) {
      const part = word.slice(offset, offset + length);
      if (offset) {
        lines.push(line);
        line = '';
      }
      line = (line + ' ' + part).trim();
    }
  }
  if (line) lines.push(line);
  return lines;
}

// Render privately in memory; admission credentials never enter a public upload directory.
export async function renderTicketImage(event, ticket, config) {
  const title = wrap(event.name);
  const venue = wrap(`${event.venue}, ${event.city}`, 52);
  const titleSize = Math.max(18, Math.min(42, Math.floor(140 / title.length)));
  const venueSize = Math.max(12, Math.min(22, Math.floor(96 / venue.length)));
  const date = new Date(event.starts_at).toLocaleString('en-GB', {
    timeZone: 'Africa/Dar_es_Salaam',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const text = (value, x, y, size, extra = '') =>
    `<text x="${x}" y="${y}" font-size="${size}" ${extra}>${escape(value)}</text>`;
  let ticketSymbol = '';
  try {
    const logoPath = path.resolve(
      config.production ? 'dist' : 'public',
      'assets/golden-ticket-symbol.png',
    );
    ticketSymbol = `data:image/png;base64,${(await readFile(logoPath)).toString('base64')}`;
  } catch {
    /* The wordmark remains readable if the optional symbol asset is unavailable. */
  }
  const logo = ticketSymbol
    ? `<image href="${ticketSymbol}" x="48" y="274" width="44" height="44"/>`
    : '';
  const svg = `<svg width="800" height="1280" xmlns="http://www.w3.org/2000/svg"><rect width="800" height="1280" fill="#fcfaf7"/><rect width="800" height="260" fill="#ffad82"/><g font-family="sans-serif" fill="#282521">${logo}${text('Golden', 103, 307, 30, 'fill="#171715" font-weight="bold"')}${text('events', 104, 326, 11, 'fill="#818181" font-weight="bold"')}${text(ticket.ticket_type, 48, 365, 20, 'fill="#716b64"')}${title.map((line, i) => text(line, 48, 414 + i * (titleSize + 8), titleSize)).join('')}${text(date + ' EAT', 48, 581, 22)}${venue.map((line, i) => text(line, 48, 621 + i * (venueSize + 4), venueSize)).join('')}<path d="M0 710H800" stroke="#eee5dd" stroke-dasharray="7 7"/>${text(ticket.code, 400, 1120, 24, 'text-anchor="middle" font-family="monospace"')}${text('Valid for one admission', 400, 1160, 20, 'text-anchor="middle"')}${text(ticket.holder_name || '', 400, 1190, 18, 'text-anchor="middle"')}${text('Golden Creation', 400, 1230, 18, 'text-anchor="middle"')}</g></svg>`;
  const layers = [];
  let coverPath;
  if (/^\/uploads\/[a-zA-Z0-9_-]+\.(webp|png|jpg|jpeg)$/.test(event.image || ''))
    coverPath = path.join(config.dataDir, event.image);
  else if (/^\/assets\/[a-zA-Z0-9_-]+\.(jpg|png|webp)$/.test(event.image || ''))
    coverPath = path.resolve(config.production ? 'dist' : 'public', '.' + event.image);
  if (coverPath) {
    try {
      layers.push({
        input: await sharp(await readFile(coverPath))
          .resize(800, 260, { fit: 'cover' })
          .png()
          .toBuffer(),
        top: 0,
        left: 0,
      });
    } catch {
      /* A missing cover must not prevent ticket delivery. */
    }
  }
  layers.push({
    input: await QRCode.toBuffer(`${config.publicOrigin}/ticket/${ticket.token}`, {
      width: 360,
      margin: 2,
      errorCorrectionLevel: 'M',
    }),
    top: 730,
    left: 220,
  });
  return sharp(Buffer.from(svg)).composite(layers).png().toBuffer();
}
