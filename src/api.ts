export class ApiError extends Error {
  status: number;
  data: Record<string, unknown>;
  constructor(status: number, data: Record<string, unknown>) {
    super(String(data.error || 'Request failed.'));
    this.status = status;
    this.data = data;
  }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData))
    headers.set('Content-Type', 'application/json');
  const response = await fetch(`/api${path}`, { ...options, headers, credentials: 'same-origin' });
  const data = await response.json();
  if (!response.ok) throw new ApiError(response.status, data);
  return data;
}
export const send = <T>(path: string, body: unknown, method = 'POST') =>
  api<T>(path, { method, body: JSON.stringify(body) });
export const money = (value: number) =>
  new Intl.NumberFormat('en-TZ', { maximumFractionDigits: 0 }).format(value);
export const dateLabel = (value: string, options: Intl.DateTimeFormatOptions = {}) =>
  new Date(value).toLocaleDateString('en-GB', {
    timeZone: 'Africa/Dar_es_Salaam',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...options,
  });
export const timeLabel = (value: string) =>
  new Date(value).toLocaleTimeString('en-GB', {
    timeZone: 'Africa/Dar_es_Salaam',
    hour: '2-digit',
    minute: '2-digit',
  });
export const shortPhone = (phone: string) => phone.replace('+255', '0');
export function downloadCSV(filename: string, rows: (string | number)[][]) {
  const csv = rows
    .map((row) =>
      row
        .map(
          (cell) =>
            `"${String(cell)
              .replace(/^[=+@-]/, "'$&")
              .replace(/"/g, '""')}"`,
        )
        .join(','),
    )
    .join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
