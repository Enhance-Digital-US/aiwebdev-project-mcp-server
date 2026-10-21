import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetDemoData } from '../src/demo.js';
import { BASE, call, mcp, toolText } from './helpers.js';
import { devToken } from './setup.js';

beforeEach(async () => {
  await resetDemoData(env.DB);
});

describe('mcp-authorization: authorization discovery', () => {
  it('challenges an unauthenticated MCP request with resource metadata', async () => {
    const response = await mcp(undefined, 'tools/list');
    expect(response.status).toBe(401);
    expect(response.headers.get('WWW-Authenticate')).toContain(
      `resource_metadata="${BASE}/.well-known/oauth-protected-resource/mcp"`,
    );
  });

  it('publishes protected resource metadata naming this server', async () => {
    const response = await call(new Request(`${BASE}/.well-known/oauth-protected-resource/mcp`));
    expect(response.status).toBe(200);
    const metadata = await response.json<{ resource: string; authorization_servers: string[] }>();
    expect(metadata.resource).toBe(env.RESOURCE_URL);
    expect(metadata.authorization_servers).toEqual([env.AUTH_SERVER_URL]);
  });

  it('publishes authorization server metadata with the roles and a registration endpoint', async () => {
    const response = await call(new Request(`${BASE}/.well-known/oauth-authorization-server`));
    expect(response.status).toBe(200);
    const metadata = await response.json<{ scopes_supported: string[]; registration_endpoint: string }>();
    expect(metadata.scopes_supported).toEqual(expect.arrayContaining(['admin', 'member', 'viewer']));
    expect(metadata.registration_endpoint).toMatch(/\/oauth\/register$/);
  });
});

describe('mcp-authorization: client registration', () => {
  it('registers a client dynamically', async () => {
    const response = await call(
      new Request(`${BASE}/oauth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_name: 'Test client',
          redirect_uris: ['http://localhost:9999/callback'],
          token_endpoint_auth_method: 'none',
        }),
      }),
    );
    expect(response.status).toBe(201);
    expect((await response.json<{ client_id: string }>()).client_id).toBeTruthy();
  });
});

describe('mcp-authorization: dev tokens accepted only in development', () => {
  it('lets a development viewer token read but not write', async () => {
    const token = await devToken('user-carol', 'viewer');
    const list = await mcp(token, 'tools/list');
    expect(list.status).toBe(200);

    const create = await mcp(token, 'tools/call', {
      name: 'create_issue',
      arguments: { project_id: 'proj-demo', title: 'Should be refused' },
    });
    expect(toolText(create.body)).toContain('Forbidden');
  });

  it('tells a non-member the project does not exist rather than Forbidden', async () => {
    const outsider = await devToken('user-dave', 'admin');
    const remove = await mcp(outsider, 'tools/call', {
      name: 'delete_project',
      arguments: { project_id: 'proj-demo' },
    });
    expect(toolText(remove.body)).toContain('Project not found');
    expect(toolText(remove.body)).not.toContain('Forbidden');
  });

  it('rejects a dev token outside development', async () => {
    const token = await devToken('user-carol', 'viewer');
    const staging = { ...env, ENVIRONMENT: 'staging' } as typeof env;
    const response = await mcp(token, 'tools/list', {}, staging);
    expect(response.status).toBe(401);
  });
});
