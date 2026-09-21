import { getClient } from './aula.ts';
import { classify, PROMPT_VERSION } from './classify.ts';
import { isAlreadyLogged, logItem, type ClassifiedItem } from './db.ts';
import { nextDailyDigestTime } from './digest-time.ts';
import { config, env } from './config.ts';
import { sendEmail } from './email.ts';
import { digestPageHtml } from './email-template.ts';

interface RawItem {
  aula_id: string;
  source: string;
  child: string | null;
  subject: string;
  sender: string | null;
  text: string;
  bodyExcerpt: string;
  receivedAt: Date;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

async function collectThreadItems(client: Awaited<ReturnType<typeof getClient>>): Promise<RawItem[]> {
  const threads = await client.getThreads({ page: 0 });
  const items: RawItem[] = [];

  for (const thread of threads) {
    const msgId = thread.latestMessage?.id;
    const aulaId = msgId ? `msg-${msgId}` : `thread-${thread.id}`;
    if (isAlreadyLogged(aulaId)) continue;

    const receivedAt = new Date(
      thread.latestMessage?.sendDateTime ?? thread.lastMessage?.sendDateTime ?? Date.now(),
    );
    const subject = thread.subject ?? '(no subject)';

    let body = '';
    let sender: string | null = null;
    let text = `Subject: ${subject}`;
    try {
      const full = await client.getMessagesForThread(thread.id);
      sender = full.messages.at(-1)?.sender?.fullName ?? null;
      body = full.messages
        .map((m) => `[${m.sender?.fullName ?? 'unknown sender'}]: ${m.text?.plain ?? stripHtml(m.text?.html ?? '')}`)
        .join('\n---\n');
      if (body.trim()) text += `\n\n${body.slice(0, 4000)}`;
    } catch (err) {
      body = `(full content unavailable: ${(err as Error).message})`;
      text += `\n\n${body}`;
    }

    items.push({
      aula_id: aulaId,
      source: 'message',
      child: null,
      subject,
      sender,
      text,
      bodyExcerpt: body.slice(0, 500),
      receivedAt,
    });
  }
  return items;
}

async function collectPostItems(client: Awaited<ReturnType<typeof getClient>>): Promise<RawItem[]> {
  const data = await client.getPosts({ limit: 20 });
  const items: RawItem[] = [];
  for (const post of data?.posts ?? []) {
    if (post.id == null) continue;
    const aulaId = `post-${post.id}`;
    if (isAlreadyLogged(aulaId)) continue;
    const subject = post.title ?? '(no title)';
    const sender = post.ownerProfile?.fullName ?? post.ownerProfile?.institution?.institutionName ?? null;
    const body = stripHtml(post.content?.html ?? '');
    const text = `Title: ${subject}\nFrom: ${sender ?? 'unknown'}\nImportant: ${post.isImportant ?? false}\n\n${body.slice(0, 4000)}`;
    const receivedAt = new Date(post.publishAt ?? post.timestamp ?? Date.now());
    items.push({
      aula_id: aulaId,
      source: 'post',
      child: null,
      subject,
      sender,
      text,
      bodyExcerpt: body.slice(0, 500),
      receivedAt,
    });
  }
  return items;
}

function formatCopenhagen(iso: string): string {
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

// getNotifications() returns an untyped envelope upstream (see README's
// "Known limitations") — every notificationEventType we haven't seen yet
// falls back to a plain, non-JSON summary instead of dumping the raw object
// into an email, and logs the raw shape so it can be added here later.
function describeNotification(n: any): { subject: string; sender: string; summary: string } {
  const area: string | undefined = n?.notificationArea;
  const eventType: string = n?.notificationEventType ?? n?.notificationType ?? 'notification';
  const sender = area ? `Aula ${area}` : 'Aula';

  if (typeof n?.title === 'string') {
    const when = n.startTime
      ? n.endTime
        ? `${formatCopenhagen(n.startTime)} – ${formatCopenhagen(n.endTime)}`
        : formatCopenhagen(n.startTime)
      : null;
    const deadline = n.expires ? `Respond by ${formatCopenhagen(n.expires)}.` : '';
    return {
      subject: n.title,
      sender,
      summary: [when ? `When: ${when}` : null, deadline].filter(Boolean).join(' '),
    };
  }

  if (eventType === 'NewMedia') {
    return {
      subject: 'New photo/media in an album',
      sender,
      summary: n?.relatedChildName ? `Related to: ${n.relatedChildName}` : 'A new photo or video was added to a school album.',
    };
  }

  console.warn('describeNotification: unrecognized shape, add a case for it. Raw:', JSON.stringify(n).slice(0, 500));
  return {
    subject: 'Aula notification',
    sender,
    summary: `(unrecognized notification type "${eventType}" — logged for review, see server logs)`,
  };
}

async function collectNotificationItems(client: Awaited<ReturnType<typeof getClient>>): Promise<RawItem[]> {
  const raw = (await client.getNotifications()) as unknown;
  const items: RawItem[] = [];
  const list: unknown[] = Array.isArray((raw as any)?.notifications)
    ? (raw as any).notifications
    : Array.isArray((raw as any)?.data)
      ? (raw as any).data
      : Array.isArray(raw)
        ? raw
        : [];

  if (list.length === 0 && raw) {
    console.warn('collectNotificationItems: unrecognized shape, skipping. Raw sample:', JSON.stringify(raw).slice(0, 500));
    return items;
  }

  for (const n of list as any[]) {
    const id = (n as any)?.id ?? (n as any)?.notificationId;
    if (id == null) continue;
    const aulaId = `notif-${id}`;
    if (isAlreadyLogged(aulaId)) continue;

    const { subject, sender, summary } = describeNotification(n);
    const text = `Subject: ${subject}\n${summary}`;
    const receivedAt = new Date((n as any)?.triggered ?? (n as any)?.createdAt ?? (n as any)?.timestamp ?? Date.now());
    items.push({
      aula_id: aulaId,
      source: 'notification',
      child: null,
      subject,
      sender,
      text,
      bodyExcerpt: summary,
      receivedAt,
    });
  }
  return items;
}

async function main() {
  const client = await getClient();
  const nextDigestAt = nextDailyDigestTime(new Date());

  const [threadItems, postItems, notificationItems] = await Promise.all([
    collectThreadItems(client).catch((err) => {
      console.error('collectThreadItems failed:', err);
      return [];
    }),
    collectPostItems(client).catch((err) => {
      console.error('collectPostItems failed:', err);
      return [];
    }),
    collectNotificationItems(client).catch((err) => {
      console.error('collectNotificationItems failed:', err);
      return [];
    }),
  ]);

  const items = [...threadItems, ...postItems, ...notificationItems];
  console.log(`poll: ${items.length} new item(s) to classify`);

  for (const item of items) {
    const result = await classify({
      source: item.source,
      child: item.child,
      familyChildren: config.children.map((c) => ({ name: c.name, class: c.class })),
      text: item.text,
      receivedAt: item.receivedAt,
      nextDigestAt,
    });

    const logged: ClassifiedItem = {
      aula_id: item.aula_id,
      source: item.source,
      child: item.child,
      subject: item.subject,
      sender: item.sender,
      received_at: item.receivedAt.toISOString(),
      raw_excerpt: item.bodyExcerpt,
      category: result.category,
      reason: result.reason,
      prompt_version: PROMPT_VERSION,
    };
    logItem(logged);
    console.log(`  [${result.category}] ${item.source} ${item.aula_id}: ${result.reason}`);

    if (result.category === 'immediate') {
      const html = digestPageHtml('Aula — Immediate', [{ heading: item.source, items: [logged] }]);
      await sendEmail(`[Aula] ${item.subject}`, html);
    }
  }

  if (env.healthcheckUrl) {
    await fetch(env.healthcheckUrl).catch((err) => console.error('heartbeat ping failed:', err));
  }
}

main().catch((err) => {
  console.error('poll failed:', err);
  process.exit(1);
});
