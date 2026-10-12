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
export function acceptedSms(payload, phone, apiVersion = '2') {
  if (!payload || typeof payload !== 'object' || payload.success === false) return null;
  if (payload.messages !== undefined) {
    if (!Array.isArray(payload.messages) || payload.messages.length !== 1) return null;
    const m = payload.messages[0],
      s = m?.status;
    const legacy = String(apiVersion) === '1';
    if (!s || m.to !== phone || (!legacy && !messageId(m.messageId))) return null;
    if (m.messageId !== undefined && m.messageId !== null && !messageId(m.messageId)) return null;
    // Numeric status pairs are authoritative; groupName varies between API responses.
    const pending = s.groupId === 18 && (legacy ? [50, 51, 52] : [50, 51, 52, 88]).includes(s.id);
    const delivered = s.groupId === 20 && (legacy ? [73, 77] : [73, 77, 109]).includes(s.id);
    const legacyPending = legacy && s.groupId === 1 && s.id === 7 && s.name === 'PENDING_ENROUTE';
    const legacyDelivered =
      legacy && s.groupId === 3 && s.id === 5 && s.name === 'DELIVERED_TO_HANDSET';
    return pending || delivered || legacyPending || legacyDelivered
      ? {
          messageId: messageId(m.messageId),
          status: s.id === 73 || legacyDelivered ? 'delivered' : 'accepted',
        }
      : null;
  }
  return payload.success === true && messageId(payload.message_id)
    ? { messageId: payload.message_id, status: 'accepted' }
    : null;
}
function smsFailure(code) {
  const error = new HttpError(
    502,
    'The SMS request could not be confirmed. No verification was completed.',
  );
  error.smsFailureCode = code;
  return error;
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
              ...(reference ? { reference } : {}),
            }),
          },
        );
        if (!response.ok) throw smsFailure(`http_${response.status}`);
        // Provider IDs can exceed Number.MAX_SAFE_INTEGER; Node 24 exposes the original JSON token.
        const payload = JSON.parse(await response.text(), (key, value, context) =>
          ['messageId', 'message_id'].includes(key) && typeof value === 'number'
            ? context.source
            : value,
        );
        const accepted = acceptedSms(payload, recipient, config.nextsmsApiVersion);
        if (!accepted) {
          const status = payload?.messages?.[0]?.status;
          const knownCode =
            Number.isInteger(status?.groupId) &&
            status.groupId >= 0 &&
            status.groupId < 100 &&
            Number.isInteger(status?.id) &&
            status.id >= 0 &&
            status.id < 10000;
          throw smsFailure(
            knownCode ? `provider_${status.groupId}_${status.id}` : 'invalid_response',
          );
        }
        return accepted;
      } catch (error) {
        if (error instanceof HttpError && error.smsFailureCode) throw error;
        throw smsFailure(
          error?.name === 'TimeoutError'
            ? 'timeout'
            : error instanceof SyntaxError
              ? 'invalid_json'
              : 'transport_error',
        );
      }
    },
  };
}
