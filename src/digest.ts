import { getItemsSince, getWatermark, setWatermark } from './db.ts';
import { sendEmail } from './email.ts';
import { digestPageHtml } from './email-template.ts';
import { env } from './config.ts';

async function runDaily() {
  const watermarkKey = 'daily';
  const since = getWatermark(watermarkKey) ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const now = new Date().toISOString();

  const daily = getItemsSince('daily', since);
  const html = digestPageHtml('Aula — Daily Digest', [{ heading: 'Today', items: daily }]);
  await sendEmail(`Aula daily digest — ${daily.length} item(s)`, html);
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

  const sections = [
    { heading: 'Whole-school items this week', items: weeklyOnly },
    { heading: 'In case you missed it — already sent this week', items: [...recapImmediate, ...recapDaily] },
  ];

  if (env.showIgnoredInWeekly) {
    const ignored = getItemsSince('ignore', since);
    sections.push({
      heading: 'Ignored this week (for review — set SHOW_IGNORED_IN_WEEKLY=false to remove this section)',
      items: ignored,
    });
  }

  const html = digestPageHtml('Aula — Weekly Digest', sections);
  await sendEmail(`Aula weekly digest — ${weeklyOnly.length} item(s)`, html);
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
