import { getItemsSince, getWatermark, setWatermark, type ClassifiedItem } from './db.ts';
import { sendEmail } from './email.ts';

function formatItems(items: ClassifiedItem[]): string {
  if (items.length === 0) return '(nothing)';
  return items
    .map((i) => `- [${i.source}] ${i.raw_excerpt.split('\n')[0].slice(0, 100)}\n  (${i.reason})`)
    .join('\n');
}

async function runDaily() {
  const watermarkKey = 'daily';
  const since = getWatermark(watermarkKey) ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const now = new Date().toISOString();

  const daily = getItemsSince('daily', since);
  const body = `Daily Aula digest\n\n${formatItems(daily)}`;
  await sendEmail(`Aula daily digest — ${daily.length} item(s)`, body);
  setWatermark(watermarkKey, now);
  console.log(`daily digest sent: ${daily.length} item(s) since ${since}`);
}

async function runWeekly() {
  const watermarkKey = 'weekly';
  const since = getWatermark(watermarkKey) ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const now = new Date().toISOString();

  const weeklyOnly = getItemsSince('weekly_only', since);
  const recapDaily = getItemsSince('daily', since);
  const recapImmediate = getItemsSince('immediate', since);

  const body = [
    'Weekly Aula digest',
    '',
    'Whole-school items this week:',
    formatItems(weeklyOnly),
    '',
    'In case you missed it — already sent this week:',
    formatItems([...recapImmediate, ...recapDaily]),
  ].join('\n');

  await sendEmail(`Aula weekly digest — ${weeklyOnly.length} item(s)`, body);
  setWatermark(watermarkKey, now);
  console.log(`weekly digest sent: ${weeklyOnly.length} weekly_only item(s), ${recapDaily.length + recapImmediate.length} recap item(s)`);
}

const mode = process.argv[2];
if (mode === 'daily') {
  await runDaily();
} else if (mode === 'weekly') {
  await runWeekly();
} else {
  console.error('usage: bun run src/digest.ts <daily|weekly>');
  process.exit(1);
}
