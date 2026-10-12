import { HttpError, normalizePhone } from './domain.js';

export function smsAvailable(config) {
  return (
    (!!config.smsGateway && !config.production) ||
    (config.nextsmsEnabled &&
      !!config.nextsmsUsername &&
      !!config.nextsmsPassword &&
      !!config.nextsmsSenderId)
  );
}
export function toMsisdn(phone) {
  return normalizePhone(phone).slice(1);
}

function messageId(value) {
  return typeof value === 'string' && value.trim() && value.length <= 200 ? value : null;
}
export function acceptedSms(payload, phone) {
  if (!payload || typeof payload !== 'object' || payload.success === false) return null;
  if (payload.messages !== undefined) {
    if (!Array.isArray(payload.messages) || payload.messages.length !== 1) return null;
    const m = payload.messages[0],
      s = m?.status;
    if (!s || !messageId(m.messageId) || (m.to !== undefined && m.to !== phone)) return null;
    const pending =
      s.groupId === 18 &&
      [50, 51, 52, 88].includes(s.id) &&
      (!s.groupName || s.groupName === 'PENDING');
    const delivered =
      s.groupId === 20 &&
      [73, 77, 109].includes(s.id) &&
      (!s.groupName || ['DELIVERY', 'DELIVERED'].includes(s.groupName));
    return pending || delivered
      ? { messageId: m.messageId, status: s.id === 73 ? 'delivered' : 'accepted' }
      : null;
  }
  return payload.success === true && messageId(payload.message_id)
    ? { messageId: payload.message_id, status: 'accepted' }
    : null;
}
export function smsGateway(config) {
  if (config.smsGateway && !config.production) return config.smsGateway;
  return {
    async send(phone, text, reference) {
      if (!smsAvailable(config)) throw new HttpError(503, 'SMS verification is not configured.');
      const recipient = toMsisdn(phone);
      try {
        const response = await fetch(
          `${config.nextsmsBaseUrl}/api/sms/v${config.nextsmsApiVersion}/text/single`,
          {
            method: 'POST',
            redirect: 'error',
            signal: AbortSignal.timeout(20000),
            headers: {
              Authorization: `Basic ${Buffer.from(`${config.nextsmsUsername}:${config.nextsmsPassword}`).toString('base64')}`,
              Accept: 'application/json',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              from: config.nextsmsSenderId,
              to: recipient,
              text,
              ...(String(config.nextsmsApiVersion) === '2' ? { reference } : {}),
            }),
          },
        );
        if (!response.ok) throw new Error('SMS request refused');
        // Provider IDs can exceed Number.MAX_SAFE_INTEGER; Node 24 exposes the original JSON token.
        const payload = JSON.parse(await response.text(), (key, value, context) =>
          ['messageId', 'message_id'].includes(key) && typeof value === 'number'
            ? context.source
            : value,
        );
        const accepted = acceptedSms(payload, recipient);
        if (!accepted) throw new Error('SMS not accepted');
        return accepted;
      } catch {
        throw new HttpError(
          502,
          'The SMS request could not be confirmed. No verification was completed.',
        );
      }
    },
  };
}
