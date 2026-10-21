import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../src/index.js';

async function call(request: Request, bindings: typeof env = env): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, bindings, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

const STAGING_URL = 'https://issue-tracker-mcp-staging.example.workers.dev';

describe('deployment-environments: requests to the configured hostname are served', () => {
  it('accepts the hosted hostname when it matches RESOURCE_URL', async () => {
    const staging = { ...env, ENVIRONMENT: 'staging', RESOURCE_URL: `${STAGING_URL}/mcp` } as typeof env;
    const response = await call(new Request(`${STAGING_URL}/auth/dev-token`, { method: 'POST' }), staging);
    // Reached the app's dev-token gate (404 outside development), not Host validation (403).
    expect(response.status).toBe(404);
  });

  it('refuses a Host that does not match RESOURCE_URL', async () => {
    const response = await call(new Request('http://evil.test/auth/dev-token', { method: 'POST' }));
    expect(response.status).toBe(403);
  });
});

describe('deployment-environments: dev token endpoint is development-only', () => {
  it('issues a dev token in development', async () => {
    const response = await call(
      new Request('http://localhost:8787/auth/dev-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sub: 'user-alice', scope: 'admin' }),
      }),
    );
    expect(response.status).toBe(200);
    const body = await response.json<{ access_token: string }>();
    expect(typeof body.access_token).toBe('string');
  });
});
