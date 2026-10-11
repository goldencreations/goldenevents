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
  const type = wrap(ticket.ticket_type, 34);
  const holder = wrap(ticket.holder_name || '', 38);
  const fitSize = (lines, maximum) =>
    Math.min(maximum, Math.floor(704 / Math.max(1, ...lines.map((line) => line.length))));
  const titleSize = fitSize(title, 38),
    venueSize = fitSize(venue, 22);
  const titleY = 410 + (type.length - 1) * 28;
  const dateY = titleY + title.length * 46 + 20;
  const venueY = dateY + 40;
  const perforationY = Math.max(700, venueY + venue.length * 28 + 28);
  const qrY = perforationY + 20;
  const codeY = qrY + 400;
  const height = Math.max(1280, codeY + 120 + holder.length * 26);
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
  const svg = `<svg width="800" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="800" height="${height}" fill="#ffffff"/><rect width="800" height="260" fill="#d8efb4"/><g font-family="sans-serif" fill="#171715">${logo}${text('Golden', 103, 307, 30, 'font-weight="bold"')}${text('events', 104, 326, 11, 'fill="#686b66"')}${type.map((line, i) => text(line, 48, 365 + i * 28, 20, 'fill="#4b5d3c"')).join('')}${title.map((line, i) => text(line, 48, titleY + i * 46, titleSize, 'font-weight="bold"')).join('')}${text(date + ' EAT', 48, dateY, 22)}${venue.map((line, i) => text(line, 48, venueY + i * 28, venueSize, 'fill="#686b66"')).join('')}<path d="M0 ${perforationY}H800" stroke="#ccd4c4" stroke-dasharray="7 7"/>${text(ticket.code, 400, codeY, 24, 'text-anchor="middle" font-family="monospace"')}<rect x="235" y="${codeY + 20}" width="330" height="42" rx="4" fill="${ticket.checked_in_at ? '#f0f1ee' : '#d8efb4'}"/>${text(ticket.checked_in_at ? 'Already admitted' : 'Valid for one admission', 400, codeY + 48, 20, 'text-anchor="middle"')}${holder.map((line, i) => text(line, 400, codeY + 94 + i * 26, 18, 'text-anchor="middle"')).join('')}</g></svg>`;
  const layers = [];
  let coverPath;
  const demoCover = event.image?.includes('photo-1470229722913')
    ? 'niffer-party.jpg'
    : event.image?.includes('photo-1501386761578')
      ? 'sunset-sessions.jpg'
      : event.image?.includes('photo-1513364776144')
        ? 'creative-table.jpg'
        : null;
  if (demoCover)
    coverPath = path.resolve(config.production ? 'dist' : 'public', 'assets', demoCover);
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
    top: qrY,
    left: 220,
  });
  return sharp(Buffer.from(svg)).composite(layers).png().toBuffer();
}
