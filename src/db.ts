import { Database } from 'bun:sqlite';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const db = new Database(join(HERE, '..', 'aula-notify.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS classification_log (
    aula_id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    child TEXT,
    subject TEXT,
    sender TEXT,
    received_at TEXT,
    raw_excerpt TEXT,
    category TEXT NOT NULL,
    reason TEXT,
    prompt_version TEXT NOT NULL,
    classified_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS digest_watermarks (
    name TEXT PRIMARY KEY,
    last_sent_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS booking_alerts_sent (
    event_id TEXT PRIMARY KEY,
    alerted_at TEXT NOT NULL
  );
`);

// Older DBs predate the subject/sender columns — add them if missing (no-op on fresh installs).
for (const col of ['subject', 'sender']) {
  try {
    db.exec(`ALTER TABLE classification_log ADD COLUMN ${col} TEXT`);
  } catch {
    // column already exists
  }
}

export type Category = 'immediate' | 'daily' | 'weekly_only' | 'ignore';

export interface ClassifiedItem {
  aula_id: string;
  source: string;
  child: string | null;
  subject: string | null;
  sender: string | null;
  received_at: string;
  raw_excerpt: string;
  category: Category;
  reason: string;
  prompt_version: string;
}

export function isAlreadyLogged(aulaId: string): boolean {
  return db.query('SELECT 1 FROM classification_log WHERE aula_id = ?').get(aulaId) != null;
}

export function logItem(item: ClassifiedItem): void {
  db.query(`
    INSERT INTO classification_log
      (aula_id, source, child, subject, sender, received_at, raw_excerpt, category, reason, prompt_version, classified_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    item.aula_id,
    item.source,
    item.child,
    item.subject,
    item.sender,
    item.received_at,
    item.raw_excerpt,
    item.category,
    item.reason,
    item.prompt_version,
    new Date().toISOString(),
  );
}

export function getWatermark(name: string): string | null {
  const row = db.query('SELECT last_sent_at FROM digest_watermarks WHERE name = ?').get(name) as
    | { last_sent_at: string }
    | undefined;
  return row?.last_sent_at ?? null;
}

export function setWatermark(name: string, isoTimestamp: string): void {
  db.query(`
    INSERT INTO digest_watermarks (name, last_sent_at) VALUES (?, ?)
    ON CONFLICT(name) DO UPDATE SET last_sent_at = excluded.last_sent_at
  `).run(name, isoTimestamp);
}

export function getItemsSince(category: Category, sinceIso: string): ClassifiedItem[] {
  return db
    .query(
      'SELECT * FROM classification_log WHERE category = ? AND classified_at > ? ORDER BY classified_at ASC',
    )
    .all(category, sinceIso) as ClassifiedItem[];
}

export function wasBookingAlertSent(eventId: string): boolean {
  return db.query('SELECT 1 FROM booking_alerts_sent WHERE event_id = ?').get(eventId) != null;
}

export function recordBookingAlertSent(eventId: string): void {
  db.query('INSERT OR IGNORE INTO booking_alerts_sent (event_id, alerted_at) VALUES (?, ?)').run(
    eventId,
    new Date().toISOString(),
  );
}
