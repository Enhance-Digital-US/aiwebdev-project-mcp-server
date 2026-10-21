import { env } from 'cloudflare:workers';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetDemoData } from '../src/demo.js';
import { BASE, call, mcp, toolText } from './helpers.js';

const REDIRECT_URI = 'http://localhost:9999/callback';
let clientId: string;

function base64url(bytes: ArrayBuffer | Uint8Array): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function pkce() {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  return { verifier, challenge };
}

interface AuthorizationStart {
  url: string;
  verifier: string;
  status: number;
  html: string;
  handle: string;
  cookie: string;
}

async function startAuthorization(scope = 'viewer'): Promise<AuthorizationStart> {
  const { verifier, challenge } = await pkce();
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'state-123',
    scope,
    resource: env.RESOURCE_URL,
  });
  const url = `${BASE}/authorize?${params}`;
  const response = await call(new Request(url));
  const html = await response.text();
  const handle = /name="handle" value="([^"]+)"/.exec(html)?.[1] ?? '';
  const cookie = response.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  return { url, verifier, status: response.status, html, handle, cookie };
}

function submit(start: AuthorizationStart, fields: Record<string, string>, bindings: typeof env = env) {
  return call(
    new Request(start.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: start.cookie,
        Origin: BASE,
      },
      body: new URLSearchParams({ handle: start.handle, ...fields }),
      redirect: 'manual',
    }),
    bindings,
  );
}

async function exchangeCode(start: AuthorizationStart, location: string) {
  const code = new URL(location).searchParams.get('code')!;
  const response = await call(
    new Request(`${BASE}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        client_id: clientId,
        code_verifier: start.verifier,
        resource: env.RESOURCE_URL,
      }),
    }),
  );
  expect(response.status).toBe(200);
  return response.json<{ access_token: string; refresh_token?: string; scope: string }>();
}

async function loginAs(persona: string, password: string, scope?: string) {
  const start = await startAuthorization(scope);
  const response = await submit(start, { persona, password, decision: 'approve' });
  expect(response.status).toBe(302);
  return exchangeCode(start, response.headers.get('Location')!);
}

beforeAll(async () => {
  const response = await call(
    new Request(`${BASE}/oauth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: '<b>Test</b>',
        redirect_uris: [REDIRECT_URI],
        token_endpoint_auth_method: 'none',
      }),
    }),
  );
  clientId = (await response.json<{ client_id: string }>()).client_id;
});

beforeEach(async () => {
  await resetDemoData(env.DB);
});

describe('mcp-authorization: persona login and consent page', () => {
  it('lists the three personas and escapes the client name', async () => {
    const start = await startAuthorization();
    expect(start.status).toBe(200);
    expect(start.html).toContain('Alice');
    expect(start.html).toContain('Bob');
    expect(start.html).toContain('Carol');
    expect(start.html).toContain('name="password"');
    expect(start.html).toContain('&#60;b&#62;Test');
    expect(start.html).not.toContain('<b>Test');
    expect(start.handle).not.toBe('');
  });

  it('redirects to the client with access_denied on Deny', async () => {
    const start = await startAuthorization();
    const response = await submit(start, { decision: 'deny' });
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toContain('error=access_denied');
  });
});

describe('mcp-authorization: refused logins never echo input', () => {
  it.each([
    ['a wrong password', { persona: 'user-carol', password: 'not-the-password' }],
    ['an unknown persona', { persona: 'user-mallory', password: 'viewer-pw-test' }],
    ['a missing password', { persona: 'user-carol' }],
  ])('refuses %s with 401', async (_case, fields: Record<string, string>) => {
    const start = await startAuthorization();
    const response = await submit(start, { ...fields, decision: 'approve' });
    expect(response.status).toBe(401);
    const html = await response.text();
    expect(html).toContain('Incorrect persona or password.');
    if (fields.password) expect(html).not.toContain(fields.password);
  });

  it('refuses a reused form with 400 and no client redirect', async () => {
    const start = await startAuthorization();
    const first = await submit(start, { persona: 'user-carol', password: 'viewer-pw-test', decision: 'approve' });
    expect(first.status).toBe(302);
    const again = await submit(start, { persona: 'user-carol', password: 'viewer-pw-test', decision: 'approve' });
    expect(again.status).toBe(400);
    expect(again.headers.get('Location')).toBeNull();
  });
});

describe('mcp-authorization: tokens and roles', () => {
  it('issues access and refresh tokens for Carol', async () => {
    const tokens = await loginAs('user-carol', 'viewer-pw-test');
    expect(tokens.access_token).toBeTruthy();
    expect(tokens.refresh_token).toBeTruthy();
  });

  it('fixes the role to the persona even if the client asks for admin', async () => {
    const tokens = await loginAs('user-carol', 'viewer-pw-test', 'admin');
    expect(tokens.scope.split(' ')).toEqual(['viewer']);
  });

  it('lets Carol (viewer) read but not write', async () => {
    const { access_token } = await loginAs('user-carol', 'viewer-pw-test');
    const search = await mcp(access_token, 'tools/call', { name: 'search_issues', arguments: { query: 'search' } });
    expect(toolText(search.body)).toContain('demo-issue');
    const create = await mcp(access_token, 'tools/call', {
      name: 'create_issue',
      arguments: { project_id: 'proj-demo', title: 'Refused' },
    });
    expect(toolText(create.body)).toContain('Forbidden');
  });

  it('lets Bob (member) create issues but not delete the project', async () => {
    const { access_token } = await loginAs('user-bob', 'member-pw-test');
    const create = await mcp(access_token, 'tools/call', {
      name: 'create_issue',
      arguments: { project_id: 'proj-demo', title: 'Created by Bob' },
    });
    expect(toolText(create.body)).not.toContain('Forbidden');
    expect(toolText(create.body)).toContain('Created by Bob');
    const remove = await mcp(access_token, 'tools/call', {
      name: 'delete_project',
      arguments: { project_id: 'proj-demo' },
    });
    expect(toolText(remove.body)).toContain('Forbidden');
  });
});

describe('mcp-authorization: password change invalidates sessions', () => {
  it('rejects Carol’s token after her password changes', async () => {
    const { access_token } = await loginAs('user-carol', 'viewer-pw-test');
    expect((await mcp(access_token, 'tools/list')).status).toBe(200);
    const rotated = { ...env, PERSONA_PASSWORD_VIEWER: 'rotated-pw' } as typeof env;
    expect((await mcp(access_token, 'tools/list', {}, rotated)).status).toBe(401);
  });

  it('refuses to refresh Carol’s session after her password changes', async () => {
    const { refresh_token } = await loginAs('user-carol', 'viewer-pw-test');
    const refresh = (bindings: typeof env) =>
      call(
        new Request(`${BASE}/oauth/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh_token!, client_id: clientId }),
        }),
        bindings,
      );
    const rotated = { ...env, PERSONA_PASSWORD_VIEWER: 'rotated-pw' } as typeof env;
    const response = await refresh(rotated);
    expect(response.status).toBe(400);
    expect((await response.json<{ error: string }>()).error).toBe('invalid_grant');
  });
});

describe('demo-data: sessions survive a reset', () => {
  it('keeps Carol signed in across a demo reset', async () => {
    const { access_token } = await loginAs('user-carol', 'viewer-pw-test');
    await resetDemoData(env.DB);
    expect((await mcp(access_token, 'tools/list')).status).toBe(200);
  });
});
