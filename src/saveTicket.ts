import { apiUrl } from './api';
import { saveFileInShell } from './shellSave';

export async function saveTicketImage(code: string, token: string) {
  // Use the same private renderer as WhatsApp delivery, including holder and admission state.
  const response = await fetch(apiUrl(`/tickets/${encodeURIComponent(token)}/image`), {
    cache: 'no-store',
    credentials: 'include',
  });
  if (!response.ok) throw new Error('Could not save this ticket.');
  const blob = await response.blob();
  if (await saveFileInShell(`${code}-ticket.png`, blob)) return;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${code}-ticket.png`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
