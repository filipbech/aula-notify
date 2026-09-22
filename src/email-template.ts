import type { ClassifiedItem } from './db.ts';

function formatDate(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Copenhagen',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('day')}-${get('month')}-${get('year')} ${get('hour')}:${get('minute')}`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const CATEGORY_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  immediate: { bg: '#fde8e8', fg: '#c0392b', label: 'Immediate' },
  daily: { bg: '#e8f0fe', fg: '#1a56db', label: 'Daily' },
  weekly_only: { bg: '#f0eefe', fg: '#6b46c1', label: 'Weekly' },
  ignore: { bg: '#f3f4f6', fg: '#6b7280', label: 'Ignored' },
};

export function itemCardHtml(item: ClassifiedItem): string {
  const style = CATEGORY_STYLE[item.category] ?? CATEGORY_STYLE.daily;
  const subject = escapeHtml(item.subject ?? '(no subject)');
  const sender = escapeHtml(item.sender ?? 'Unknown sender');
  const when = formatDate(item.received_at);
  const body = escapeHtml(item.raw_excerpt).slice(0, 600).replace(/\n/g, '<br>');
  const link = item.link
    ? `<div style="margin-top:10px;"><a href="${escapeHtml(item.link)}" style="font-size:13px;color:#1a56db;text-decoration:none;">View in Aula &rarr;</a></div>`
    : '';

  return `
  <div style="border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin-bottom:12px;background:#ffffff;">
    <span style="display:inline-block;background:${style.bg};color:${style.fg};font-size:12px;font-weight:600;padding:2px 8px;border-radius:12px;margin-bottom:8px;">${style.label}</span>
    <div style="font-size:16px;font-weight:600;color:#111827;margin-top:8px;margin-bottom:4px;">${subject}</div>
    <div style="font-size:13px;color:#6b7280;margin-bottom:10px;">${sender} &middot; ${when}</div>
    <div style="font-size:14px;color:#374151;line-height:1.5;">${body}</div>
    ${link}
    <div style="font-size:12px;color:#9ca3af;margin-top:10px;font-style:italic;">${escapeHtml(item.reason)}</div>
  </div>`;
}

export function digestPageHtml(title: string, sections: { heading: string; items: ClassifiedItem[] }[]): string {
  const body = sections
    .map(
      (s) => `
    <h2 style="font-size:15px;color:#111827;margin:24px 0 8px;">${escapeHtml(s.heading)} (${s.items.length})</h2>
    ${s.items.length ? s.items.map(itemCardHtml).join('') : '<div style="color:#9ca3af;font-size:14px;">(nothing)</div>'}
  `,
    )
    .join('');

  return `
  <div style="max-width:600px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <h1 style="font-size:20px;color:#111827;margin-bottom:4px;">${escapeHtml(title)}</h1>
    ${body}
  </div>`;
}
