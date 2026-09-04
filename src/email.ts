import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, env } from './config.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const DRY_RUN_LOG = join(HERE, '..', 'dry-run-emails.log');

export async function sendEmail(subject: string, html: string): Promise<void> {
  if (env.dryRun) {
    const entry = `\n=== ${new Date().toISOString()} ===\nSubject: ${subject}\n\n${html}\n`;
    await Bun.write(DRY_RUN_LOG, (await Bun.file(DRY_RUN_LOG).exists()) ? (await Bun.file(DRY_RUN_LOG).text()) + entry : entry);
    console.log(`[dry-run] would send: ${subject}`);
    return;
  }

  if (!env.resendApiKey) {
    throw new Error('RESEND_API_KEY not set');
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.resendApiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: 'onboarding@resend.dev',
      to: config.notifyEmail,
      subject,
      html,
    }),
  });

  if (!res.ok) {
    throw new Error(`sendEmail: Resend API returned ${res.status}: ${await res.text()}`);
  }
}
