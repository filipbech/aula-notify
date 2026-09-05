import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

export interface Child {
  id: number;
  name: string;
  class?: string;
}

export interface Config {
  guardianId: string;
  institutionCodes: string[];
  children: Child[];
  notifyEmail: string;
}

const raw = await Bun.file(join(HERE, '..', 'config.json')).json();

if (!raw.notifyEmail || raw.notifyEmail === 'REPLACE_ME') {
  throw new Error('config.json: set notifyEmail to a real address before running');
}

export const config: Config = raw;

export const env = {
  dryRun: process.env.DRY_RUN !== 'false',
  geminiApiKey: process.env.GEMINI_API_KEY ?? '',
  resendApiKey: process.env.RESEND_API_KEY ?? '',
  healthcheckUrl: process.env.HEALTHCHECK_URL ?? '',
  showIgnoredInWeekly: process.env.SHOW_IGNORED_IN_WEEKLY !== 'false',
  skipEmptyDigests: process.env.SKIP_EMPTY_DIGESTS === 'true',
};
