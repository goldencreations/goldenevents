// Read only the same public event information available to any site visitor.
export async function readLivePublicEvents(config, slug) {
  const path = slug === undefined ? '/api/events' : `/api/events/${encodeURIComponent(slug)}`;
  const response = await fetch(`${config.livePublicOrigin}${path}`, {
    signal: AbortSignal.timeout(10000),
    headers: { Accept: 'application/json' },
    redirect: 'error',
  });
  if (!response.ok) {
    const error = new Error(
      response.status === 404
        ? 'This event has not been published.'
        : 'Live events are temporarily unavailable. Please try again.',
    );
    error.status = response.status === 404 ? 404 : 502;
    throw error;
  }
  const data = await response.json();
  const mirror = (event) => ({
    ...event,
    image: /^\/uploads\/[a-zA-Z0-9_-]+\.(webp|png|jpe?g)$/.test(event.image || '')
      ? `/api/live-artwork/${event.image.slice('/uploads/'.length)}`
      : event.image
        ? new URL(event.image, config.livePublicOrigin).href
        : '',
    readOnly: true,
  });
  return slug === undefined ? { events: data.events.map(mirror) } : { event: mirror(data.event) };
}
