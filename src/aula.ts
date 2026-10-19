import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  AulaHttpClient,
  EncryptedFileTokenStore,
  KeychainTokenStore,
  type TokenStore,
  withFreshTokens,
} from '@aula-mcp/aula-auth';
import { AulaClient } from '@aula-mcp/aula-client';
import { config } from './config.ts';

function tokenStore(): TokenStore {
  if (KeychainTokenStore.isSupported() && process.env.AULA_MCP_NO_KEYCHAIN !== '1') {
    return new KeychainTokenStore();
  }
  const dir = process.env.AULA_MCP_DIR ?? join(homedir(), '.config', 'aula-mcp');
  return new EncryptedFileTokenStore({
    filePath: join(dir, 'tokens.json'),
    keyFilePath: join(dir, '.key'),
  });
}

export async function getClient(): Promise<AulaClient> {
  const store = tokenStore();
  const http = new AulaHttpClient();
  const record = await withFreshTokens({ store, http });
  const client = new AulaClient({ tokens: record.tokens, http });

  // Aula returns 403 (code 10 / subCode 23) on reads until the acting
  // profile is selected server-side via this pair — same bootstrap
  // bbl-dashboard's refresh.ts and the CLI's `doctor` command do.
  await client.getProfilesByLogin();
  await client.getProfileContext('guardian');

  return client;
}

export function childName(childId: number): string {
  return config.children.find((c) => c.id === childId)?.name ?? String(childId);
}

type ConsentEntry = { institutionProfile?: { id?: number; role?: string } };

// posts.getAllPosts answers 200 with an empty feed unless it's scoped to the
// family's institution profiles, and profiles.getProfilesByLogin omits the
// club (Klub/SFO) child profiles. The consent list carries all of them — same
// source aula-mcp's own posts tool uses.
export async function getFamilyInstitutionProfileIds(client: AulaClient): Promise<number[]> {
  const raw = (await client.rawRequest('consents.getConsentResponses', {
    returnOnlyPendingConsentResponses: 'false',
  })) as ConsentEntry[] | { data?: ConsentEntry[] } | null;
  const entries = Array.isArray(raw) ? raw : (raw?.data ?? []);

  const guardianIds: number[] = [];
  const childIds: number[] = [];
  for (const { institutionProfile: ip } of entries) {
    if (!ip?.id) continue;
    (ip.role === 'guardian' ? guardianIds : childIds).push(ip.id);
  }
  if (guardianIds.length === 0) {
    throw new Error('getFamilyInstitutionProfileIds: no guardian profile in consent responses');
  }
  return [...new Set([...guardianIds, ...childIds])];
}
