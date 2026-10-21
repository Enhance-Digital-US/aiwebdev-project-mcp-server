// Runs before every test file. Storage is isolated per file, so each file gets a fresh schema.
import { env } from 'cloudflare:workers';
import { beforeAll } from 'vitest';
import schema from '../schema.sql?raw';
import { createDevToken } from '../src/auth.js';
import { runSqlScript } from '../src/sql.js';

beforeAll(async () => {
  await runSqlScript(env.DB, schema);
});

export function devToken(sub: string, scope: string): Promise<string> {
  return createDevToken(env.AUTH_SECRET, { sub, scope, aud: env.RESOURCE_URL });
}
