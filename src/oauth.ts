import {
  GrantType,
  OAuthAuthorizationServer,
  OAuthError,
  OAuthResourceServer,
  type OAuthResourceAuth,
  type OAuthResourceHandler,
  type OAuthResourceTokenValidation,
} from '@cloudflare/workers-oauth-provider';
import type { AuthInfo } from '@modelcontextprotocol/server';
import { createDevVerifier } from './auth.js';
import type { Bindings } from './index.js';
import { findPersona, passwordFingerprint, type Role } from './personas.js';

// What the persona login stores in each grant (encrypted in KV) and what the
// MCP handler receives back as ctx.props on every request.
export interface AuthProps {
  userId: string;
  role: Role;
  pwfp: string | null; // password fingerprint at login; null only for dev tokens
}

const ACCESS_TOKEN_TTL = 60 * 60; // 1 hour
const REFRESH_TOKEN_TTL = 7 * 24 * 60 * 60; // 7 days, however often it is refreshed

// The server objects take fixed URLs, and each environment has its own, so
// build one pair per URL pair. Secrets are read from `env` on every request.
const authorizationServers = new Map<string, OAuthAuthorizationServer<Bindings>>();
const resourceServers = new Map<string, OAuthResourceServer<Bindings, AuthProps>>();
const cacheKey = (env: Bindings) => `${env.AUTH_SERVER_URL}|${env.RESOURCE_URL}`;

export function getAuthorizationServer(env: Bindings): OAuthAuthorizationServer<Bindings> {
  let server = authorizationServers.get(cacheKey(env));
  if (!server) {
    server = new OAuthAuthorizationServer<Bindings>({
      issuer: env.AUTH_SERVER_URL,
      resources: [env.RESOURCE_URL],
      scopesSupported: ['admin', 'member', 'viewer', 'offline_access'],
      clientIdMetadataDocumentEnabled: true,
      clientRegistrationEndpoint: '/oauth/register',
      accessTokenTTL: ACCESS_TOKEN_TTL,
      refreshTokenTTL: REFRESH_TOKEN_TTL,
      // Refreshing doesn't pass through validateToken below, so check the
      // password fingerprint here too. invalid_grant also revokes the grant,
      // which sends the client back to the login page.
      async tokenExchangeCallback({ grantType, props, env }) {
        if (grantType !== GrantType.REFRESH_TOKEN) return;
        if (!(await isPasswordCurrent(env, props as AuthProps))) {
          throw new OAuthError('invalid_grant', { description: 'Password changed; sign in again.' });
        }
      },
    });
    authorizationServers.set(cacheKey(env), server);
  }
  return server;
}

export function getResourceServer(
  env: Bindings,
  handler: OAuthResourceHandler<Bindings, AuthProps>,
): OAuthResourceServer<Bindings, AuthProps> {
  let server = resourceServers.get(cacheKey(env));
  if (!server) {
    server = new OAuthResourceServer<Bindings, AuthProps>({
      // No requiredScopes: the persona login, not the client, decides the scope.
      resourceMetadata: { resource: env.RESOURCE_URL, authorization_servers: [env.AUTH_SERVER_URL] },
      validateToken: (env) => (resource, token) => validateToken(env, resource, token),
      handler,
    });
    resourceServers.set(cacheKey(env), server);
  }
  return server;
}

async function validateToken(
  env: Bindings,
  resource: string,
  token: string,
): Promise<OAuthResourceTokenValidation<AuthProps> | null> {
  // 1. Dev tokens (HS256 JWTs from /auth/dev-token), in development only.
  //    The OAuth server's own tokens contain ':' separators, never dots.
  if (env.ENVIRONMENT === 'development' && token.split('.').length === 3) {
    try {
      const info = await createDevVerifier(env.AUTH_SECRET).verifyAccessToken(token);
      const sub = String(info.extra?.sub);
      return {
        props: { userId: sub, role: info.scopes[0] as Role, pwfp: null },
        audience: String(info.resource),
        expiresAt: info.expiresAt,
        scope: info.scopes,
        userId: sub,
        clientId: info.clientId,
      };
    } catch {
      return null;
    }
  }

  // 2. Tokens issued by the persona login.
  const validated = await getAuthorizationServer(env).validateToken<AuthProps>(resource, token, env);
  if (!validated) return null;

  // 3. Reject sessions from before the persona's password was last changed.
  if (!(await isPasswordCurrent(env, validated.props))) return null;

  return validated;
}

// True when the grant was created under the persona's current password.
async function isPasswordCurrent(env: Bindings, props: AuthProps): Promise<boolean> {
  const persona = findPersona(props.userId);
  const current = persona ? await passwordFingerprint(env, persona) : null;
  return current !== null && current === props.pwfp;
}

// Maps the OAuth library's view of a verified token onto the MCP SDK's AuthInfo,
// which the Store chain reads (extra.sub → userId, scopes → role checks).
export function toAuthInfo(auth: OAuthResourceAuth, props: AuthProps): AuthInfo {
  return {
    token: auth.token,
    clientId: auth.clientId ?? 'unknown',
    scopes: auth.scope,
    expiresAt: auth.expiresAt,
    resource: new URL(auth.audience),
    extra: { sub: props.userId },
  };
}
