import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

export interface Child {
  id: number;
  name: string;
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
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
  resendApiKey: process.env.RESEND_API_KEY ?? '',
  healthcheckUrl: process.env.HEALTHCHECK_URL ?? '',
};
