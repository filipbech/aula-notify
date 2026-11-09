import type { AulaClient } from '@aula-mcp/aula-client';

export interface Markable {
  aula_id: string;
  thread_id: number | null;
  message_id: string | null;
}

type ThreadsClient = Pick<AulaClient, 'getThreadsPage' | 'setLastReadMessage'>;

const MAX_PAGES = 5;
const PAUSE_MS = 600;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Mark the Aula threads behind already-emailed messages as read, so the app
 * stops flagging things the user has been told about.
 *
 * Aula has no "mark read" verb: `setLastReadMessage` moves a per-thread
 * marker. Passing a message older than the thread's newest would move it
 * backwards and make newer messages show as unread again, so the marker is
 * only moved when the thread is still unread and still ends at the message we
 * emailed. A thread the user already read, or that has a newer message (which
 * becomes its own item), needs nothing and counts as handled.
 *
 * `onHandled` fires for every item that needs no further attempt. An item
 * whose API call failed is left out so nothing claims it was marked.
 */
export async function markMessagesRead(
  client: ThreadsClient,
  items: Markable[],
  onHandled: (aulaId: string) => void,
  pauseMs = PAUSE_MS,
): Promise<{ marked: number; alreadyDone: number; failed: number }> {
  const wanted = items.filter(
    (i): i is Markable & { thread_id: number; message_id: string } =>
      i.thread_id != null && i.message_id != null,
  );
  const result = { marked: 0, alreadyDone: 0, failed: 0 };
  if (wanted.length === 0) return result;

  const wantedThreads = new Set(wanted.map((i) => i.thread_id));
  const found = new Map<number, Awaited<ReturnType<ThreadsClient['getThreadsPage']>>['threads'][number]>();
  for (let page = 0; page < MAX_PAGES && found.size < wantedThreads.size; page++) {
    const r = await client.getThreadsPage({ page });
    for (const t of r.threads) if (wantedThreads.has(t.id)) found.set(t.id, t);
    if (!r.hasMorePages) break;
  }

  const moved = new Set<number>();
  for (const item of wanted) {
    const thread = found.get(item.thread_id);
    if (!thread) continue; // not in the newest pages; leave it alone rather than guess

    if (thread.read || thread.latestMessage?.id !== item.message_id) {
      result.alreadyDone++;
      onHandled(item.aula_id);
      continue;
    }

    if (!moved.has(item.thread_id)) {
      try {
        await client.setLastReadMessage(item.thread_id, item.message_id);
        moved.add(item.thread_id);
        result.marked++;
      } catch (err) {
        result.failed++;
        console.error(`mark-read: thread ${item.thread_id} failed:`, (err as Error).message);
        continue;
      }
      await sleep(pauseMs);
    }
    onHandled(item.aula_id);
  }
  return result;
}
