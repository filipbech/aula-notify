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
  return new AulaClient({ tokens: record.tokens, http });
}

export function childName(childId: number): string {
  return config.children.find((c) => c.id === childId)?.name ?? String(childId);
}
