import { describe, expect, test } from 'bun:test';
import { type Markable, markMessagesRead } from './mark-read.ts';

type Thread = { id: number; read: boolean; latestMessage?: { id?: string } };

// Synthetic ids throughout; only the shapes matter.
function fakeClient(pages: Thread[][], failOn: number[] = []) {
  const written: [number, string][] = [];
  const pagesAsked: number[] = [];
  return {
    written,
    pagesAsked,
    client: {
      getThreadsPage: async ({ page = 0 }: { page?: number } = {}) => {
        pagesAsked.push(page);
        return { threads: pages[page] ?? [], page, hasMorePages: page < pages.length - 1 };
      },
      setLastReadMessage: async (threadId: number, messageId: string) => {
        if (failOn.includes(threadId)) throw new Error('boom');
        written.push([threadId, messageId]);
        return {};
      },
    } as never,
  };
}

const item = (threadId: number, messageId: string): Markable => ({
  aula_id: `msg-${messageId}`,
  thread_id: threadId,
  message_id: messageId,
});

async function run(pages: Thread[][], items: Markable[], failOn: number[] = []) {
  const f = fakeClient(pages, failOn);
  const handled: string[] = [];
  const result = await markMessagesRead(f.client, items, (id) => handled.push(id), 0);
  return { ...f, handled, result };
}

describe('markMessagesRead', () => {
  test('marks an unread thread that still ends at the message we emailed', async () => {
    const r = await run([[{ id: 1, read: false, latestMessage: { id: 'm1' } }]], [item(1, 'm1')]);
    expect(r.written).toEqual([[1, 'm1']]);
    expect(r.handled).toEqual(['msg-m1']);
    expect(r.result).toEqual({ marked: 1, alreadyDone: 0, failed: 0 });
  });

  test('leaves a thread the user already read alone', async () => {
    const r = await run([[{ id: 1, read: true, latestMessage: { id: 'm1' } }]], [item(1, 'm1')]);
    expect(r.written).toEqual([]);
    expect(r.handled).toEqual(['msg-m1']);
    expect(r.result.alreadyDone).toBe(1);
  });

  test('does not move the marker back when a newer message has arrived', async () => {
    // Passing the older id would make m2 show as unread again if the user had read it.
    const r = await run([[{ id: 1, read: false, latestMessage: { id: 'm2' } }]], [item(1, 'm1')]);
    expect(r.written).toEqual([]);
    expect(r.handled).toEqual(['msg-m1']);
  });

  test('a failed write is not reported as handled, and the next thread is still tried', async () => {
    const r = await run(
      [
        [
          { id: 1, read: false, latestMessage: { id: 'm1' } },
          { id: 2, read: false, latestMessage: { id: 'm2' } },
        ],
      ],
      [item(1, 'm1'), item(2, 'm2')],
      [1],
    );
    expect(r.written).toEqual([[2, 'm2']]);
    expect(r.handled).toEqual(['msg-m2']);
    expect(r.result).toEqual({ marked: 1, alreadyDone: 0, failed: 1 });
  });

  test('a thread that is not in the newest pages is left untouched and unhandled', async () => {
    const r = await run([[{ id: 9, read: false, latestMessage: { id: 'x' } }]], [item(1, 'm1')]);
    expect(r.written).toEqual([]);
    expect(r.handled).toEqual([]);
  });

  test('pages on until every wanted thread is found, then stops asking', async () => {
    const r = await run(
      [
        [{ id: 1, read: false, latestMessage: { id: 'm1' } }],
        [{ id: 2, read: false, latestMessage: { id: 'm2' } }],
        [{ id: 3, read: false, latestMessage: { id: 'm3' } }],
      ],
      [item(1, 'm1'), item(2, 'm2')],
    );
    expect(r.pagesAsked).toEqual([0, 1]);
    expect(r.written).toEqual([
      [1, 'm1'],
      [2, 'm2'],
    ]);
  });

  test('items without a thread or message id are ignored without touching Aula', async () => {
    const r = await run(
      [[{ id: 1, read: false, latestMessage: { id: 'm1' } }]],
      [
        { aula_id: 'post-1', thread_id: null, message_id: null },
        { aula_id: 'thread-1', thread_id: 1, message_id: null },
      ],
    );
    expect(r.pagesAsked).toEqual([]);
    expect(r.written).toEqual([]);
    expect(r.handled).toEqual([]);
  });
});
