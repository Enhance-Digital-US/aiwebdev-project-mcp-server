# Design

## Context

See `proposal.md` for the motivation. The current state is:
- **Stack:** a Hono app on Cloudflare Workers, using `@modelcontextprotocol/server` 2.0 and `@modelcontextprotocol/hono` 2.0. Data is in D1.
- **Environments:** three, configured in `wrangler.jsonc` and documented in `ENVIRONMENTS.md`. Vars and bindings are **not inherited** by `env.*` blocks.
- **Auth today:** a hand-rolled HS256 verifier (`src/auth.ts`) behind the SDK's `requireBearerAuth`. Discovery metadata comes from `oauthMetadataResponse`. `/auth/dev-token` is gated by a fail-closed `isDevTokenEnabled()`.
- **Roles:** checks use the token scope (`src/store.ts`). Reads are row-filtered by membership in `members`, and `members.role` is not used for authorization.
- **Defect found while planning:** `createMcpHonoApp()` with default options installs localhost-only Host validation, which would refuse requests on `*.workers.dev`.
- **Tooling limits:** Wrangler 4.133 runs workerd locally, which supports `compatibility_date` up to `2026-09-23`. There are no tests yet.

## Goals / Non-Goals

**Goals:**
- One Worker acts as both the authorization server and the MCP resource server in every environment, including local `wrangler dev`.
- The first automated tests, run in the Workers runtime against real local D1 and KV.

**Non-Goals:**
- Real identity providers, Cloudflare Access, a separate auth Worker, per-student data isolation, membership-management tools, brute-force rate limiting.
- Using `members.role` for permission checks.

## Decisions

### `@cloudflare/workers-oauth-provider` ^1.2.3, functional API in one Worker
The Worker uses `OAuthAuthorizationServer` together with an `OAuthResourceServer`, both in this Worker, with routing kept in Hono.

**Settings:**
- **Authorization server:**
  - `issuer` = `AUTH_SERVER_URL` (the Worker's own origin) and `resources` = [`RESOURCE_URL`]
  - `scopesSupported` = `admin`, `member`, `viewer`, `offline_access`
  - `clientIdMetadataDocumentEnabled: true` and `clientRegistrationEndpoint: '/oauth/register'`
  - `accessTokenTTL: 3600` and `refreshTokenTTL: 604800`
- **Resource server:** `resourceMetadata` names `RESOURCE_URL` and `AUTH_SERVER_URL`, with no `requiredScopes`, because the login page chooses the scope.
- **Instances:** both are memoized per `AUTH_SERVER_URL|RESOURCE_URL`, since the constructors take fixed URLs and each environment has its own.

**Why:**
- Version 1.x supports MCP 2026-07-28, including CIMD and DCR.
- It ships safe consent helpers (`describeConsent`, `beginConsent`, `approveConsent`, `denyConsent`).
- It stores tokens hashed and encrypts their props in KV.

**Alternatives considered:**
- *Combined `OAuthProvider`:* it would own routing and push dev-token acceptance into `resolveExternalToken`, which is less clear to teach.
- *Cloudflare Access with managed OAuth:* it hides the OAuth flow students are meant to see, it doesn't map to the simulated roles, and it depends on Zero Trust.
- *Keeping the hand-rolled verifier and adding our own token endpoint:* too much security-sensitive code to own.

### Routes
- **Host check (middleware, runs first):** compares the request host with `new URL(RESOURCE_URL).host` and returns `403` on a mismatch. It replaces `createMcpHonoApp()`. The adapter's `parsedBody` middleware isn't needed, because the resource server passes the raw request through.
- `POST /auth/dev-token`: unchanged.
- `GET`/`POST /authorize`: the persona login and consent page (`src/login.ts`).
- `/mcp` and `/.well-known/oauth-protected-resource/mcp`: the resource server, whose handler builds the existing `createMcpHandler`/`Store`/`createServer` chain. `toAuthInfo(ctx.auth, ctx.props)` maps the result to `AuthInfo { token, clientId, scopes, expiresAt, resource: URL(audience), extra: { sub } }`.
- `/.well-known/oauth-authorization-server`, `/oauth/token` and `/oauth/register`: the authorization server.

The SDK's `oauthMetadataResponse`/`requireBearerAuth` path is removed. The library now produces the README's `401` → RFC 9728 → audience narrative, and the docs are updated to say so.

### Token validator
The resource server's `validateToken` works in this order:
1. **Development dev tokens.** If `ENVIRONMENT === 'development'` and the token is a three-segment JWT, verify it with the existing `createDevVerifier`. Its props are `{ userId: sub, role, pwfp: null }` and its audience comes from the token. A token that fails verification is rejected.
2. **Otherwise,** call `authorizationServer.validateToken`.
3. **Password fingerprint check.** Compare the props' `pwfp` with the persona's current password fingerprint. A mismatch, or a password that isn't configured, is rejected with `401`.

Library tokens contain `:` separators, not dots, so the two token kinds can't be confused.

### Password-change invalidation by fingerprint
At login, `pwfp` = the first 16 hex characters of SHA-256(`personaId:password`), stored in the encrypted grant props.

**Alternative considered:** a revoke-all script over `OAUTH_KV`, which the spec permitted. We rejected it because it's an extra manual step that's easy to forget. The fingerprint makes rotation just a matter of setting new secrets.

### Persona password check
`verifyPersonaPassword` hashes both values with SHA-256 and compares the digests in constant time. A password that's unset or empty never matches.

### Login page
The page follows the library's `docs/consent-page.md`.
- **On a wrong password or an unknown persona:** respond `401`, re-parse the authorization request from the POST URL's query string, and render a fresh consent page with "Incorrect persona or password." Input is never echoed.
- **On approve:** `approveConsent(req, handle, { scope: [persona.role] })`, then `completeAuthorization({ userId: persona.id, scope: [persona.role], props: { userId, role, pwfp } })`.
- **Errors:** handled by the library's table. An `AuthorizationError` with `redirectTo` redirects; one without it, or a `CimdFetchError`, renders a `400`; anything else surfaces as a `500`.

### Demo seed shared by cron and CLI
`seed.sql` deletes the application tables in dependency order and re-inserts the demo state with fixed IDs. The same file is used in two ways:
- **Worker:** `src/demo.ts`'s `resetDemoData` imports it as a Text module and runs it through `runSqlScript`. That splits statements on `;` at end of line, skips blank lines and `--` comment lines, and runs them in one atomic `db.batch()`. We don't use `db.exec()`, because it splits on newlines and breaks multi-line statements.
- **CLI:** the `pnpm db:reset:*` scripts run `wrangler d1 execute --file=seed.sql`.

A cron of `0 * * * *` is configured on staging and production only.

### Configuration
- `compatibility_flags: ["global_fetch_strictly_public"]` at the top level (inherited), which CIMD needs.
- An `OAUTH_KV` namespace in all three blocks.
- `AUTH_SERVER_URL` set to the Worker's own origin in every environment.
- Three new `PERSONA_PASSWORD_*` secrets, added to `.dev.vars.example` with placeholder values and to the `Bindings` type.

### Tests
`@cloudflare/vitest-plugin` ^1.4 (the renamed `@cloudflare/vitest-pool-workers`; supports vitest ^4.1) runs the tests against the top-level config, with test-only secret bindings. Setup applies `schema.sql` via `runSqlScript`. The end-to-end login tests drive DCR, PKCE S256, the login form (carrying cookies by hand), the code exchange and MCP tool calls.

## Risks / Trade-offs

- **Shared demo data is visible to every student, and students can interfere with each other's work.** → The hourly reset, plus `pnpm db:reset:*`. This is accepted by the course creator.
- **Password guessing on the public login page.** → Strong random passwords, rotated per cohort. There's no rate limiting (a non-goal), but a Workers rate-limit binding can be added later.
- **`__Host-` consent cookies on `http://localhost`.** Browsers treat localhost as a secure context, so this should work. → It is confirmed in the manual Claude Code check (task 5.4).
- **CIMD may not work with a given client.** → DCR stays enabled, and DCR-only is an acceptable fallback that the MCP spec allows. If it happens, document it.
- **The Host check depends on `RESOURCE_URL` being exact.** → `ENVIRONMENTS.md` troubleshooting covers "403 on every request".

## Migration Plan

1. Deploy to staging first:
   1. `wrangler kv namespace create OAUTH_KV --env staging`, and paste the ID into `wrangler.jsonc`.
   2. Set the three `PERSONA_PASSWORD_*` secrets.
   3. `pnpm db:migrate:staging && pnpm db:reset:staging`.
   4. `pnpm deploy:staging`.
   5. Verify with a Claude Code login.
2. Repeat for production.
3. **Rollback:** `wrangler rollback --env <env>`. The KV namespace and secrets can safely stay in place.
