import { graphRequest } from '../server/whatsapp.js';

const account = process.env.WHATSAPP_BUSINESS_ID;
if (!/^\d+$/.test(account || '')) throw new Error('WhatsApp business account ID is required.');
const templates = await graphRequest(
  `${account}/message_templates?name=${encodeURIComponent(process.env.WHATSAPP_TEMPLATE_NAME)}&fields=name,status,language,category,components`,
);
const phones = await graphRequest(`${account}/phone_numbers?fields=id`);
console.log(
  JSON.stringify(
    {
      phoneNumberMatchesAccount: phones.data?.some(
        (phone) => phone.id === process.env.WHATSAPP_PHONE_NUMBER_ID,
      ),
      templates: templates.data?.map(({ name, status, language, category, components }) => ({
        name,
        status,
        language,
        category,
        components: components.map(({ type, format, text }) => ({ type, format, text })),
      })),
    },
    null,
    2,
  ),
);
