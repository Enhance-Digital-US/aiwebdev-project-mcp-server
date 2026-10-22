# Proposal

## Why

The Issue Tracker MCP server is a course project with no real users. Students need to see for themselves that the role in an access token (`admin`, `member`, `viewer`) changes what the server allows. They also need to experience the real MCP authorization flow: a `401`, then discovery, then a browser login, then a token.

Today neither is possible:
- Hosted environments have no way to issue tokens, because the dev-token endpoint is development-only.
- Even locally, a second user can't see a project they didn't create, so roles can't be compared on the same data.

## What Changes

- **Three fixed personas.** Alice (`admin`), Bob (`member`) and Carol (`viewer`). Each has a password per environment, which the course creator hands out to students.
- **A built-in authorization server.** The Worker becomes its own OAuth authorization server. MCP clients connect with no token, are challenged, discover the server, and complete a browser login. On the login page the student picks a persona and enters its password.
- **Roles are fixed by the login.** An issued token always carries exactly the persona's role, whatever the client requests.
- **Password changes end old sessions.** Changing a persona's password invalidates every session established under the old one.
- **A shared, self-resetting demo project.** All three personas belong to one seeded demo project. On hosted environments it resets hourly, and it can also be reset on demand.
- **Hosted requests are accepted.** Requests addressed to the hosted hostname are now served. Today the server only accepts `localhost` Host headers, so a deployed server would refuse them.
- **BREAKING (development only):** the server's hand-written OAuth discovery metadata is replaced by the authorization server's own. Dev tokens are still accepted, but only in development.

## Capabilities

### New Capabilities
- `mcp-authorization`: how MCP clients discover the authorization server, sign in as a simulated persona, and receive role-bearing tokens; how tokens are validated and invalidated.
- `demo-data`: the shared seeded demo project, its contents, and how and when it is reset.

### Modified Capabilities
- `deployment-environments`: adds the requirement that requests to the environment's configured hostname are served, and that requests for any other hostname are refused.

## Impact

- **Code:**
  - `src/index.ts` (routing, Host check, scheduled handler)
  - new modules for personas, OAuth wiring, the login page and the demo reset
  - `src/auth.ts` (dev tokens are now development-only at `/mcp`)
- **Data and config:**
  - new `seed.sql`
  - `wrangler.jsonc`: a KV namespace per environment, a compatibility flag, the cron trigger on hosted environments, and `AUTH_SERVER_URL` pointing at the Worker itself
- **Secrets:** `PERSONA_PASSWORD_ADMIN`, `PERSONA_PASSWORD_MEMBER` and `PERSONA_PASSWORD_VIEWER` in every environment.
- **Dependencies:** `@cloudflare/workers-oauth-provider` (runtime), and `@cloudflare/vitest-plugin` (development; the project gets its first tests).
- **Docs:** `README.md` (auth chain, a "Trying the roles" walkthrough) and `ENVIRONMENTS.md` (KV, secrets, reset, rotation).
- **Clients:** Claude Code uses the browser login. MCP Inspector keeps using dev tokens, in development only.
