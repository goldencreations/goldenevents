export async function saveTicketImage(code: string, token: string) {
  // Use the same private renderer as WhatsApp delivery, including holder and admission state.
  const response = await fetch(`/api/tickets/${encodeURIComponent(token)}/image`, {
    cache: 'no-store',
  });
  if (!response.ok) throw new Error('Could not save this ticket.');
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = `${code}-ticket.png`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
