import { getClient, childName } from './aula.ts';
import { classify, PROMPT_VERSION } from './classify.ts';
import { isAlreadyLogged, logItem, type ClassifiedItem } from './db.ts';
import { nextDailyDigestTime } from './digest-time.ts';
import { config, env } from './config.ts';
import { sendEmail } from './email.ts';

interface RawItem {
  aula_id: string;
  source: string;
  child: string | null;
  text: string;
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

    let text = `Subject: ${thread.subject ?? '(no subject)'}`;
    try {
      const full = await client.getMessagesForThread(thread.id);
      const body = full.messages
        .map((m) => `[${m.sender?.fullName ?? 'unknown sender'}]: ${m.text?.plain ?? stripHtml(m.text?.html ?? '')}`)
        .join('\n---\n');
      if (body.trim()) text += `\n\n${body.slice(0, 4000)}`;
    } catch (err) {
      text += `\n\n(full content unavailable: ${(err as Error).message})`;
    }

    items.push({ aula_id: aulaId, source: 'message', child: null, text, receivedAt });
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
    const text = `Title: ${post.title ?? '(no title)'}\nFrom: ${post.ownerProfile?.fullName ?? post.ownerProfile?.institution?.institutionName ?? 'unknown'}\nImportant: ${post.isImportant ?? false}\n\n${stripHtml(post.content?.html ?? '').slice(0, 4000)}`;
    const receivedAt = new Date(post.publishAt ?? post.timestamp ?? Date.now());
    items.push({ aula_id: aulaId, source: 'post', child: null, text, receivedAt });
  }
  return items;
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
    const id = n?.id ?? n?.notificationId;
    if (id == null) continue;
    const aulaId = `notif-${id}`;
    if (isAlreadyLogged(aulaId)) continue;
    const text = JSON.stringify(n).slice(0, 2000);
    const receivedAt = new Date(n?.createdAt ?? n?.timestamp ?? Date.now());
    items.push({ aula_id: aulaId, source: 'notification', child: null, text, receivedAt });
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
      familyChildren: config.children.map((c) => c.name),
      text: item.text,
      receivedAt: item.receivedAt,
      nextDigestAt,
    });

    const logged: ClassifiedItem = {
      aula_id: item.aula_id,
      source: item.source,
      child: item.child,
      received_at: item.receivedAt.toISOString(),
      raw_excerpt: item.text.slice(0, 500),
      category: result.category,
      reason: result.reason,
      prompt_version: PROMPT_VERSION,
    };
    logItem(logged);
    console.log(`  [${result.category}] ${item.source} ${item.aula_id}: ${result.reason}`);

    if (result.category === 'immediate') {
      const firstLine = item.text.split('\n')[0].replace(/^Subject:\s*/, '').slice(0, 80);
      await sendEmail(`[Aula] ${item.source}: ${firstLine}`, `${item.text}\n\n(reason: ${result.reason})`);
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
