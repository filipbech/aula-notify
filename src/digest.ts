import { getItemsSince, getWatermark, setWatermark } from './db.ts';
import { sendEmail } from './email.ts';
import { digestPageHtml } from './email-template.ts';
import { env } from './config.ts';

function isFridayCopenhagen(now: Date): boolean {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Copenhagen', weekday: 'short' }).format(now) === 'Fri';
}

async function runDaily() {
  const now = new Date();
  const nowIso = now.toISOString();

  const dailySince = getWatermark('daily') ?? new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const daily = getItemsSince('daily', dailySince);

  const sections = [{ heading: 'Today', items: daily }];
  let title = 'Aula — Daily Digest';
  let subject = `Aula daily digest — ${daily.length} item(s)`;
  const watermarksToAdvance: [string, string][] = [['daily', nowIso]];

  if (isFridayCopenhagen(now)) {
    const weeklySince = getWatermark('weekly') ?? new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const weeklyOnly = getItemsSince('weekly_only', weeklySince);
    const recapDaily = getItemsSince('daily', weeklySince);
    const recapImmediate = getItemsSince('immediate', weeklySince);

    sections.push({ heading: 'Whole-school items this week', items: weeklyOnly });
    sections.push({
      heading: 'In case you missed it — already sent this week',
      items: [...recapImmediate, ...recapDaily],
    });

    if (env.showIgnoredInWeekly) {
      sections.push({
        heading: 'Ignored this week (for review — set SHOW_IGNORED_IN_WEEKLY=false to remove this section)',
        items: getItemsSince('ignore', weeklySince),
      });
    }

    title = 'Aula — Daily + Weekly Digest';
    subject = `Aula daily digest — ${daily.length} item(s), weekly — ${weeklyOnly.length} item(s)`;
    watermarksToAdvance.push(['weekly', nowIso]);
  }

  const html = digestPageHtml(title, sections);
  await sendEmail(subject, html);
  for (const [key, ts] of watermarksToAdvance) setWatermark(key, ts);
  console.log(`digest sent: ${subject}`);
}

const mode = process.argv[2];
if (mode === 'daily') {
  await runDaily();
} else {
  console.error('usage: bun run src/digest.ts daily');
  process.exit(1);
}
