import { dateLabel, timeLabel } from './api';
import { eventImageSource } from './ui';
import type { Event } from './types';

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Picture unavailable'));
    image.src = source;
  });
}

function linesFor(ctx: CanvasRenderingContext2D, text: string, width: number) {
  const lines: string[] = [];
  let line = '';
  // Character wrapping also handles event names with a single very long word.
  for (const word of text.split(/\s+/)) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width <= width) {
      line = candidate;
      continue;
    }
    if (line) {
      lines.push(line);
      line = '';
    }
    for (const character of word) {
      if (ctx.measureText(line + character).width > width) {
        lines.push(line);
        line = '';
      }
      line += character;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export async function saveTicketImage(
  event: Event,
  ticket: { code: string; ticket_type: string; checked_in_at: string | null; holder_name?: string },
  qr: string,
) {
  await document.fonts.ready;
  const [qrImage, cover, logo] = await Promise.all([
    loadImage(qr),
    event.image
      ? loadImage(eventImageSource(event.image)).catch(() => null)
      : Promise.resolve(null),
    loadImage('/assets/golden-ticket-symbol.png'),
  ]);
  const canvas = document.createElement('canvas');
  canvas.width = 800;
  canvas.height = 1280;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Saving tickets is unavailable in this browser.');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 800, 1280);
  ctx.fillStyle = '#ffad82';
  ctx.fillRect(0, 0, 800, 260);
  if (cover) {
    const scale = Math.max(800 / cover.naturalWidth, 260 / cover.naturalHeight);
    const width = cover.naturalWidth * scale,
      height = cover.naturalHeight * scale;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, 800, 260);
    ctx.clip();
    ctx.drawImage(cover, (800 - width) / 2, (260 - height) / 2, width, height);
    ctx.restore();
  }
  ctx.drawImage(logo, 48, 274, 44, 44);
  ctx.fillStyle = '#171715';
  ctx.font = '800 30px "DM Sans Variable", sans-serif';
  ctx.fillText('Golden', 103, 307);
  ctx.fillStyle = '#818181';
  ctx.font = '700 11px "DM Sans Variable", sans-serif';
  ctx.fillText('events', 104, 326);
  ctx.fillStyle = '#716b64';
  ctx.font = '500 18px "DM Sans Variable", sans-serif';
  ctx.fillText(ticket.ticket_type, 48, 365);
  let size = 42,
    titleLines: string[] = [];
  do {
    ctx.font = `650 ${size}px "DM Sans Variable", sans-serif`;
    titleLines = linesFor(ctx, event.name, 704);
    if (titleLines.length <= 3) break;
    size -= 2;
  } while (size >= 18);
  ctx.fillStyle = '#202924';
  titleLines.forEach((line, i) => ctx.fillText(line, 48, 414 + i * (size + 9)));
  ctx.font = '500 22px "DM Sans Variable", sans-serif';
  ctx.fillText(`${dateLabel(event.starts_at)} · ${timeLabel(event.starts_at)} EAT`, 48, 581);
  ctx.fillStyle = '#716b64';
  let venueSize = 21,
    venueLines: string[] = [];
  do {
    ctx.font = `400 ${venueSize}px "DM Sans Variable", sans-serif`;
    venueLines = linesFor(ctx, `${event.venue}, ${event.city}`, 704);
    if (venueLines.length <= 3 || venueSize === 14) break;
    venueSize -= 1;
  } while (venueSize >= 14);
  venueLines.forEach((line, i) => ctx.fillText(line, 48, 621 + i * (venueSize + 6)));
  ctx.strokeStyle = '#eee5dd';
  ctx.setLineDash([7, 7]);
  ctx.beginPath();
  ctx.moveTo(0, 700);
  ctx.lineTo(800, 700);
  ctx.stroke();
  ctx.setLineDash([]);
  // Preserve the QR's original pixel dimensions rather than resampling its modules.
  ctx.drawImage(qrImage, 220, 720, 360, 360);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#202924';
  ctx.font = '500 21px monospace';
  ctx.fillText(ticket.code, 400, 1117);
  ctx.fillStyle = '#81786f';
  ctx.font = '400 18px "DM Sans Variable", sans-serif';
  ctx.fillText(
    ticket.checked_in_at
      ? `Admitted at ${timeLabel(ticket.checked_in_at)}`
      : 'Valid for one admission',
    400,
    1155,
  );
  ctx.font = '400 15px "DM Sans Variable", sans-serif';
  if (ticket.holder_name) ctx.fillText(ticket.holder_name, 400, 1188, 704);
  ctx.fillText('Golden Creation', 400, 1222);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (result) => (result ? resolve(result) : reject(new Error('Could not save this ticket.'))),
      'image/png',
    ),
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${ticket.code}-ticket.png`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
