import type { OAuthResourceHandler } from '@cloudflare/workers-oauth-provider';
import { createMcpHandler, InMemoryServerEventBus, type McpRequestContext } from '@modelcontextprotocol/server';
import { Hono, type Context } from 'hono';
import { Store } from './store.js';
import { createServer } from './server.js';
import { createDevToken } from './auth.js';
import { resetDemoData } from './demo.js';
import { getAuthorizationServer, getResourceServer, toAuthInfo, type AuthProps } from './oauth.js';
import { registerLoginRoutes } from './login.js';

export type Bindings = {
  DB: D1Database;
  OAUTH_KV: KVNamespace;
  AUTH_SECRET: string;
  RESOURCE_URL: string;
  AUTH_SERVER_URL: string;
  ENVIRONMENT: 'development' | 'staging' | 'production';
  PERSONA_PASSWORD_ADMIN: string;
  PERSONA_PASSWORD_MEMBER: string;
  PERSONA_PASSWORD_VIEWER: string;
};

type Env = {
  Bindings: Bindings;
};

const app = new Hono<Env>();

// ── Host check (DNS-rebinding protection) ────────────────────
// Only serve requests addressed to this environment's own host. Unlike the
// MCP Hono adapter's default (localhost only), this also works when hosted.
app.use('*', async (c, next) => {
  if (new URL(c.req.url).host !== new URL(c.env.RESOURCE_URL).host) {
    return c.text('Forbidden: unexpected Host', 403);
  }
  await next();
});

const bus = new InMemoryServerEventBus();

// Hono's ExecutionContext type predates newer runtime fields (tracing, abort);
// the object itself is the runtime's, so hand it to the OAuth servers as-is.
const runtimeCtx = (c: Context<Env>) => c.executionCtx as unknown as ExecutionContext;

// Decides whether the HS256 dev-token fixture is reachable in this deployment.
// Anyone who can reach it can mint an admin token for any user, so this must
// fail closed: an unknown or missing ENVIRONMENT never enables it. Hosted
// environments use the persona login instead.
function isDevTokenEnabled(environment: string | undefined): boolean {
  return environment === 'development';
}

// ── Dev Token Endpoint (test fixture, NOT OAuth) ─────────────
app.post('/auth/dev-token', async (c) => {
  if (!isDevTokenEnabled(c.env.ENVIRONMENT)) {
    return c.notFound();
  }
  if (!c.env.AUTH_SECRET) {
    return c.json({ error: 'Dev auth not configured' }, 500);
  }
  const body = await c.req.json<{
    sub: string;
    scope?: string;
    client_id?: string;
  }>();
  if (!body.sub) {
    return c.json({ error: 'sub claim required' }, 400);
  }
  const token = await createDevToken(c.env.AUTH_SECRET, {
    sub: body.sub,
    scope: body.scope ?? 'member',
    client_id: body.client_id,
    aud: c.env.RESOURCE_URL,
  });
  return c.json({ access_token: token, token_type: 'Bearer', expires_in: 3600 });
});

// ── Persona Login + Consent (/authorize) ─────────────────────
registerLoginRoutes(app);

// ── Authorization Server (RFC 8414 metadata, token, DCR) ─────
// Issues tokens after the persona login on /authorize.
const authorizationServerRoutes = ['/.well-known/oauth-authorization-server', '/oauth/token', '/oauth/register'];
for (const path of authorizationServerRoutes) {
  app.all(path, (c) => getAuthorizationServer(c.env).fetch(c.req.raw, c.env, runtimeCtx(c)));
}

// ── MCP Handler ──────────────────────────────────────────────
// Runs only after the resource server has verified the token: ctx.auth is the
// token, ctx.props is what the persona login stored in the grant.
const mcpHandler: OAuthResourceHandler<Bindings, AuthProps> = {
  fetch(request, env, ctx) {
    const authInfo = toAuthInfo(ctx.auth, ctx.props);
    const handler = createMcpHandler(
      (mcpCtx: McpRequestContext) => {
        const userId = (mcpCtx.authInfo?.extra as Record<string, unknown>)?.sub as string | undefined;
        const scopes = mcpCtx.authInfo?.scopes ?? [];
        const store = new Store(env.DB, { userId, scopes });
        return createServer(store, bus);
      },
      { bus },
    );
    return handler.fetch(request, { authInfo });
  },
};

// ── Resource Server (RFC 9728 metadata, 401 challenge, audience check) ──
app.all('/.well-known/oauth-protected-resource/mcp', (c) =>
  getResourceServer(c.env, mcpHandler).fetch(c.req.raw, c.env, runtimeCtx(c)),
);
app.all('/mcp', (c) => getResourceServer(c.env, mcpHandler).fetch(c.req.raw, c.env, runtimeCtx(c)));

export default {
  fetch: app.fetch,
  // Hourly on staging and production (wrangler.jsonc triggers): restore the shared demo project.
  scheduled(_controller, env, ctx) {
    ctx.waitUntil(resetDemoData(env.DB));
  },
} satisfies ExportedHandler<Bindings>;
