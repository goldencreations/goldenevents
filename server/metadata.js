import { eventUrl } from './config.js';

export function escapeHTML(value) {
  return String(value).replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );
}

export function renderPage(template, event, config, privatePage = false) {
  if (privatePage)
    return template.replace('</head>', '<meta name="robots" content="noindex, nofollow" /></head>');
  if (!event) return template;
  const title = escapeHTML(`${event.name} | Golden Events`);
  const description = escapeHTML(event.description.slice(0, 200));
  const url = escapeHTML(eventUrl(config, event.slug));
  const image = event.image ? escapeHTML(new URL(event.image, config.publicOrigin).href) : '';
  const metadata = `<meta property="og:type" content="website" />
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${description}" />
    <meta property="og:url" content="${url}" />
    ${image ? `<meta property="og:image" content="${image}" />` : ''}
    <link rel="canonical" href="${url}" />`;
  return template
    .replace('<title>Golden Events</title>', () => `<title>${title}</title>`)
    .replace('</head>', () => `${metadata}</head>`);
}
