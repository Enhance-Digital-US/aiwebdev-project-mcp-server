# Issue Tracker MCP Server

A production-grade MCP (Model Context Protocol) server that exposes an issue/project tracker — a mini [Linear](https://linear.app) — to AI agents. Built as a teaching vehicle for the **AI for Web Dev** course, it demonstrates the full feature surface of the [MCP 2026-07-28 spec](https://modelcontextprotocol.io/specification/2026-07-28) while being genuinely useful.

## Why MCP and Not a Skill?

A Skill (prompt-based instructions) can describe *how* to triage bugs, but it can't:

- **Read your actual issue database** — this server persists to Cloudflare D1, and state survives across sessions.
- **Write with real side effects** — `create_issue`, `bulk_update_status`, and `delete_project` mutate live data that other users and tools can observe.
- **Enforce per-user authorization** — every query is scoped with `INNER JOIN members` on the authenticated user's ID. A prompt cannot enforce row-level security.

These three requirements — persistent data, side effects, and auth — are exactly what makes something an MCP server instead of a Skill.

## Architecture

```
mcp-server/
├── src/
│   ├── index.ts             Hono app: Host check, routes, MCP handler, hourly demo reset
│   ├── oauth.ts             Authorization server + resource server, token validation, toAuthInfo
│   ├── login.ts             /authorize: persona login + consent page
│   ├── personas.ts          Alice / Bob / Carol, password check, password fingerprint
│   ├── demo.ts              resetDemoData() — reloads seed.sql
│   ├── sql.ts               runs multi-statement SQL scripts in one D1 batch
│   ├── server.ts            createServer(store) factory — registers tools/resources/prompts
│   ├── store.ts             D1 store with RBAC and row-level security
│   ├── auth.ts              HS256 JWT dev verifier + token generator (development only)
│   ├── tools/
│   │   ├── issues.ts        create, update, search, bulk_update_status
│   │   └── projects.ts      create_project, delete_project (MRTR), generate_sprint_report (progress)
│   ├── resources/
│   │   ├── issues.ts        issue list, issue detail
│   │   └── projects.ts      project list, project board, project activity
│   └── prompts/
│       └── index.ts         triage, sprint summary, bug report
├── test/                    Vitest suites, run inside the Workers runtime (pnpm test)
├── openspec/                Specs and in-flight changes (OpenSpec)
├── schema.sql               5 tables, 5 indexes (D1-compatible)
├── seed.sql                 Shared demo project for the personas
├── wrangler.jsonc            Cloudflare Workers config
├── mcp.json                 MCP Inspector config
├── .dev.vars.example        Template for local dev secrets (copy to .dev.vars)
├── ENVIRONMENTS.md          Dev / staging / production setup and deploy workflow
├── MIGRATION.md             2025-11-25 → 2026-07-28 migration guide
└── package.json
```

## Prerequisites

- **Node.js** v24+ (verified on v24.13.1)
- **pnpm** v10+ (verified on v10.15.1)
- **Cloudflare account** (only needed for remote deployment)

## Getting Started

### 1. Install Dependencies

```bash
git clone <repo-url> && cd mcp-server
pnpm install
```

### 2. Set Up Local Dev Environment

Copy the example secrets file (`.dev.vars` is gitignored):

```bash
cp .dev.vars.example .dev.vars
```

`RESOURCE_URL`, `AUTH_SERVER_URL` and `ENVIRONMENT=development` come from the top level of `wrangler.jsonc`.

### 3. Run the Local D1 Migration

```bash
pnpm db:migrate:local
```

### 4. Start the Dev Server

```bash
pnpm dev
```

This starts a local Cloudflare Workers dev server at `http://localhost:8787` with a local D1 database.

### 5. Get a Dev Token

```bash
curl -X POST http://localhost:8787/auth/dev-token \
  -H "Content-Type: application/json" \
  -d '{"sub":"user-alice","scope":"admin"}'
```

Response:

```json
{"access_token":"eyJhbG...","token_type":"Bearer","expires_in":3600}
```

### 6. Test with a tools/list Request

```bash
curl -X POST http://localhost:8787/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer eyJhbG..." \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

> **Gotcha:** The `Accept: application/json, text/event-stream` header is mandatory. Without it you get a `-32000 Not Acceptable` error.

> **Gotcha:** Responses come back as SSE (`event: message\ndata: {...}`), not plain JSON. The `data:` payload contains pretty-printed JSON with literal newlines, so naive `grep '^data:'` parsing will break — extract the JSON from the first `data:` line through balanced brace matching.

## Connecting an Agent

### Claude Code (Streamable HTTP)

```json
{
  "mcpServers": {
    "issue-tracker": {
      "url": "http://localhost:8787/mcp",
      "headers": {
        "Authorization": "Bearer <token-from-dev-token-endpoint>"
      }
    }
  }
}
```

### Any MCP Client (Streamable HTTP)

1. `POST /mcp` without auth. You receive `401` with a `WWW-Authenticate` header containing a `resource_metadata` URL.
2. Fetch `/.well-known/oauth-protected-resource/mcp` for the resource server metadata, which points to the authorization server (this same Worker).
3. Fetch `/.well-known/oauth-authorization-server`, register (Client ID Metadata Document, or `POST /oauth/register`), and run the authorization code flow with PKCE. `/authorize` is the persona login page. In development you can skip all of this with `POST /auth/dev-token`.
4. Send MCP JSON-RPC requests to `POST /mcp` with `Authorization: Bearer <token>` and `Accept: application/json, text/event-stream`.

> **Gotcha:** The metadata lives at `/.well-known/oauth-protected-resource/mcp`, not the bare `/.well-known/` path. Look at the `resource_metadata` value in the `WWW-Authenticate` header rather than guessing the URL.

## Trying the Roles

There are no real accounts. Every environment has three **simulated personas**, and they all belong to one shared demo project, `proj-demo` (8 issues covering every status and priority):

| Persona | Role | Password secret |
|---|---|---|
| Alice (`user-alice`) | `admin` | `PERSONA_PASSWORD_ADMIN` |
| Bob (`user-bob`) | `member` | `PERSONA_PASSWORD_MEMBER` |
| Carol (`user-carol`) | `viewer` | `PERSONA_PASSWORD_VIEWER` |

Your instructor gives you the passwords for the hosted server. Locally they're whatever you put in `.dev.vars`.

### 1. Connect with no token

```bash
claude mcp add --transport http issue-tracker https://issue-tracker-mcp-staging.<subdomain>.workers.dev/mcp
```

Then run `/mcp` in Claude Code and choose **Authenticate**. Here is what happens, and each step is part of the MCP spec:
1. Claude Code calls `/mcp` and gets a `401`.
2. It follows `resource_metadata` to discover the authorization server.
3. It registers itself, then opens the persona login page in your browser.

### 2. Sign in as a persona

Pick Alice, Bob or Carol, enter that persona's password, and allow access. The token Claude Code receives carries **exactly that persona's role**. Asking for more scope doesn't help.

### 3. Compare what each role can do

| Try this on `proj-demo` | Carol (viewer) | Bob (member) | Alice (admin) |
|---|---|---|---|
| `search_issues`, read the board or activity | ✅ | ✅ | ✅ |
| `create_issue`, `update_issue`, `bulk_update_status` | ❌ `Forbidden` | ✅ | ✅ |
| `create_project` | ❌ `Forbidden` | ✅ | ✅ |
| `delete_project` | ❌ `Forbidden` | ❌ `Forbidden` (before any confirmation) | ✅ after you confirm |

To switch persona, remove the server's authentication in `/mcp` (or re-add the server), then authenticate again and pick someone else.

> **The demo resets every hour.** On staging and production, everything students changed is wiped and `proj-demo` is restored on the hour, so go ahead and delete it as Alice. Resets never sign you out.

> **Sessions end when a password changes.** If your instructor rotates a persona's password, your next request gets a `401` and Claude Code sends you back to the login page.

## MCP Features Demonstrated

### Tools (7)

| Tool | Description | MCP Feature |
|------|-------------|-------------|
| `create_project` | Create a project (creator becomes admin) | RBAC + membership bootstrap |
| `create_issue` | Create issue with title, priority, labels | Basic tool with Zod schema |
| `update_issue` | Update any issue field | Partial update schema |
| `search_issues` | Full-text search across issues | Structured results |
| `bulk_update_status` | Change status of multiple issues | Batch operation |
| `delete_project` | Delete a project and all its data | **MRTR** — destructive action confirmation |
| `generate_sprint_report` | Generate a sprint report | **Progress notifications** via `progressToken` |

### Resources (2 static + 3 templates)

**Static resources:**

| Resource | URI |
|----------|-----|
| All issues | `tracker://issues/list` |
| All projects | `tracker://projects` |

**Resource templates:**

| Resource | URI Template |
|----------|-------------|
| Issue detail | `tracker://issues/{issueId}` |
| Project board | `tracker://projects/{projectId}/board` |
| Project activity | `tracker://projects/{projectId}/activity` |

> **Gotcha:** Resource reads return `result.contents[]` (plural). Tool calls return `result.content[]` (singular). This is spec-correct, not a typo.

### Prompts (3)

| Prompt | Arguments | Purpose |
|--------|-----------|---------|
| `triage_issue` | `title`, `description` | Suggests priority, labels, and assignee role |
| `sprint_summary` | `project_name` | Generates a sprint status update |
| `bug_report` | `error_message?` | Structures a bug report template |

### MRTR (Multi Round-Trip Requests)

Replaces the old server-initiated elicitation pattern from the 2025-11-25 spec. The server returns `inputRequired` with a schema; the client collects the input and retries with `inputResponses` and `requestState`.

Example — `delete_project`:

```
Client → tools/call { name: "delete_project", arguments: { project_id: "proj-1" } }

Server → { resultType: "input_required", inputRequests: {
  confirm: { method: "elicitation/create", params: {
    message: "Delete project 'My App' and all 47 issues? This cannot be undone.",
    requestedSchema: { type: "object", properties: { proceed: { type: "boolean" } } }
  }}
}, requestState: "..." }

Client → tools/call { ...original, inputResponses: {
  confirm: { action: "accept", content: { proceed: true } }
}, requestState: "..." }

Server → { content: [{ type: "text", text: "{\"deleted\":true,\"issueCount\":47}" }] }
```

> **Gotcha:** MRTR cannot be exercised via plain `curl`. Era detection is connection-level — a bare HTTP POST is a 2025-era connection with no declared capabilities, and the server returns `"Cannot request input 'confirm' (elicitation/create): the client on this 2025-era connection did not declare the required capability"`. You need a real 2026-era MCP client like Claude Code.

### Progress Notifications

`generate_sprint_report` emits `notifications/progress` as it works:

```
Client → tools/call { name: "generate_sprint_report",
  arguments: { project_id: "..." },
  _meta: { progressToken: "tok-1" } }

Server → notification: { method: "notifications/progress",
  params: { progressToken: "tok-1", progress: 25, total: 100,
            message: "Loading issues..." } }

Server → result: { content: [{ type: "text", text: "## Sprint Report\n..." }] }
```

The client provides a `progressToken` in `_meta`; the server sends progress updates via `ctx.mcpReq.notify()`. No polling, no task handles — it's a streaming pattern.

> **Note:** The Tasks extension (`io.modelcontextprotocol/tasks`) is **deprecated** in the 2026-07-28 SDK. Use `notifications/progress` with `progressToken` instead.

### Subscriptions

Clients subscribe to changes via `subscriptions/listen`. The server uses `InMemoryServerEventBus` to deliver events across requests within the same Cloudflare Workers isolate. Cross-isolate delivery would require Durable Objects (not covered in this project).

### Cacheable List Results

Declared in the `McpServer` constructor:

```typescript
cacheHints: {
  'tools/list':               { ttlMs: 3_600_000, cacheScope: 'public' },
  'prompts/list':             { ttlMs: 3_600_000, cacheScope: 'public' },
  'resources/list':           { ttlMs: 60_000,    cacheScope: 'private' },
  'resources/templates/list': { ttlMs: 3_600_000, cacheScope: 'public' },
}
```

- `public` — same for all users (tool and prompt definitions don't change per-user).
- `private` — per-user (resource lists depend on project membership).

## Authentication & Authorization

### Overview

The Worker plays **both OAuth 2.1 roles**. Both come from [`@cloudflare/workers-oauth-provider`](https://github.com/cloudflare/workers-oauth-provider) and are wired up in `src/oauth.ts`:

- **Authorization server.** It publishes `/.well-known/oauth-authorization-server` (RFC 8414) and runs `/oauth/token`. It registers clients through `/oauth/register` (DCR) or Client ID Metadata Documents. Grants and tokens live in the `OAUTH_KV` namespace, and only their hashes are stored.
- **Resource server.** It publishes `/.well-known/oauth-protected-resource/mcp` (RFC 9728). It answers token-less requests to `/mcp` with a `401` challenge, and rejects tokens issued for any other resource (the audience check against `RESOURCE_URL`).
- **Login page.** `/authorize` is ours. There are no real users: a student signs in as one of three **simulated personas** (Alice = `admin`, Bob = `member`, Carol = `viewer`), and the persona's role becomes the token's scope.

`/auth/dev-token` is a separate **test fixture** that signs HS256 JWTs with `AUTH_SECRET`. It and its tokens work **in development only**.

### The Auth Chain

```
persona login (/authorize)   →   grant props (encrypted in KV)   →   token
                                                                       │
POST /mcp + Bearer token  →  resource server verifies it  ─────────────┘
   ctx.auth  { token, audience, scope, clientId }
   ctx.props { userId, role, pwfp }
                     │
                 toAuthInfo()                        →   Store
─────────────────────────────────────────────────────────────────────────
props.userId  "user-carol"  →  authInfo.extra.sub    →   store.auth.userId
auth.scope    ["viewer"]    →  authInfo.scopes       →   store.auth.scopes
auth.audience               →  authInfo.resource     (already checked against RESOURCE_URL)
```

These are the pieces to understand if you want to extend the auth:
- `validateToken()` in `src/oauth.ts` accepts dev tokens in development only. It also rejects tokens whose password fingerprint (`pwfp`) no longer matches the persona's current password.
- `toAuthInfo()` maps the verified token onto the MCP SDK's `AuthInfo`, which the `Store` reads.

### RBAC Scopes

| Scope | Permissions |
|-------|-------------|
| `admin` | Full access: delete projects, manage members, all issue operations |
| `member` | Create/update issues, view projects they belong to |
| `viewer` | Read-only access to projects they're a member of |

### Row-Level Security

The `Store` constructor receives `{ userId, scopes }`. When `userId` is set, reads use `INNER JOIN members ON members.project_id = ... AND members.user_id = ?` to scope results. A non-member sees "not found" — indistinguishable from "doesn't exist", preventing enumeration.

## Debugging with MCP Inspector

[MCP Inspector](https://github.com/modelcontextprotocol/inspector) is a developer tool for testing and debugging MCP servers. This project includes an `mcp.json` config file for the inspector.

> **Development only:** the Inspector authenticates with dev tokens from `/auth/dev-token`, which only exist in development. To explore staging or production, connect Claude Code and use the persona login (see [Trying the Roles](#trying-the-roles)).

### Quick Start

**Web UI** (interactive — browse tools, resources, and prompts):

```bash
pnpm inspect
```

The command prints a tokenized URL (e.g. `http://127.0.0.1:6274?MCP_INSPECTOR_API_TOKEN=...`) — open that URL, not bare `localhost:6274`.

**CLI** (scriptable — one-shot commands):

First get a dev token, then pass it with `--header`:

```bash
TOKEN=$(curl -s -X POST http://localhost:8787/auth/dev-token \
  -H "Content-Type: application/json" \
  -d '{"sub":"user-alice","scope":"admin"}' | jq -r .access_token)

pnpm inspect:cli --header "Authorization: Bearer $TOKEN" --method tools/list
pnpm inspect:cli --header "Authorization: Bearer $TOKEN" --method resources/list
pnpm inspect:cli --header "Authorization: Bearer $TOKEN" --method tools/call --tool-name search_issues --tool-arg query=auth
```

The token expires in 3600s — regenerate it when requests start returning 401. The placeholder in `mcp.json` documents the config shape but isn't needed for CLI usage.

### Inspector Limitation: No MRTR

The inspector connects as a **2025-era client**. Tools that use MRTR (`delete_project`) will return:

```
Cannot request input 'confirm' (elicitation/create): the client on this
2025-era connection did not declare the required capability (no client
capabilities are available on this connection — per-request legacy serving
cannot receive server-to-client requests)
```

This is correct behavior. Era detection is based on the **request body**, not a handshake — the SDK checks whether `params._meta` carries a `protocolVersion` envelope claim. A bare JSON-RPC POST (from `curl`, the Inspector, or any client that doesn't include the envelope) is classified as legacy. The server correctly refuses to ask for input from a client that can't provide it. To exercise MRTR, use a 2026-era MCP client like Claude Code.

## Environments & Deployment

| Environment | Runs | Deploy |
|-------------|------|--------|
| `development` | Locally, `pnpm dev` | Never |
| `staging` | Cloudflare, `issue-tracker-mcp-staging` | `pnpm deploy:staging` |
| `production` | Cloudflare, `issue-tracker-mcp-production` | `pnpm deploy:production` |

Each hosted environment has its own Worker, D1 database and `AUTH_SECRET`. `/auth/dev-token` only exists in development.

See [`ENVIRONMENTS.md`](./ENVIRONMENTS.md) for:

- one-time setup of staging and production
- the promotion workflow
- schema changes and rollback
- troubleshooting

## Tech Stack

| Component | Choice | Why |
|-----------|--------|-----|
| **MCP SDK** | `@modelcontextprotocol/server` v2.0.0 | 2026-07-28 spec: stateless protocol, MRTR, cacheable lists |
| **OAuth** | `@cloudflare/workers-oauth-provider` v1.2 | Authorization server + resource server in one Worker; MCP 2026-07-28 auth (CIMD, DCR, PKCE, RFC 9728) |
| **Web framework** | Hono v4.13 | Lightweight, runs on Workers, familiar to web devs |
| **Database** | Cloudflare D1 | SQLite-compatible, serverless, no connection pooling |
| **Schema validation** | Zod v4.6 | First-class MCP SDK integration for tool input schemas |
| **Runtime** | Cloudflare Workers | V8 isolates, global edge, no cold-start management |
| **Language** | TypeScript 5.8 | Type safety across the codebase |
| **Tests** | Vitest 4 + `@cloudflare/vitest-plugin` | Tests run inside the Workers runtime against real local D1 and KV |

## Spec Version

This project targets the **MCP 2026-07-28 specification** (stateless protocol). Key differences from the 2025-11-25 spec:

- No `initialize`/`initialized` handshake — each request is independent
- No `Mcp-Session-Id` header — sessions don't exist
- MRTR replaces server-initiated elicitation, sampling, and roots
- `notifications/progress` replaces the deprecated Tasks extension
- `subscriptions/listen` replaces push notifications
- CIMD (Client ID Metadata Document) replaces Dynamic Client Registration
- Streamable HTTP replaces HTTP+SSE transport

See [`MIGRATION.md`](./MIGRATION.md) for a detailed migration guide with before/after code examples.

## Project Structure

| File | Purpose |
|------|---------|
| `src/index.ts` | Hono app: Host check, dev token endpoint, OAuth routes, MCP handler, hourly demo reset (`scheduled`) |
| `src/oauth.ts` | Authorization server + resource server, `validateToken` (dev tokens, password fingerprint), `toAuthInfo` |
| `src/login.ts` | `/authorize` persona login + consent page |
| `src/personas.ts` | Alice / Bob / Carol, constant-time password check, password fingerprint |
| `src/demo.ts` / `src/sql.ts` | `resetDemoData()` and the multi-statement SQL runner it uses |
| `src/server.ts` | `createServer(store)` factory — configures `McpServer` with cache hints, registers all tools/resources/prompts |
| `src/store.ts` | D1 store with `AuthContext`, RBAC scope checks, and row-level security via `INNER JOIN members` |
| `src/auth.ts` | `createDevVerifier` / `createDevToken` — HS256 JWT test fixtures (development only) |
| `src/tools/issues.ts` | Issue CRUD tools: `create_issue`, `update_issue`, `search_issues`, `bulk_update_status` |
| `src/tools/projects.ts` | `create_project` (RBAC + membership), `delete_project` (MRTR), `generate_sprint_report` (progress notifications) |
| `src/resources/issues.ts` | Issue list, issue detail with comments |
| `src/resources/projects.ts` | Project list, project board (grouped by status), activity feed |
| `src/prompts/index.ts` | Triage, sprint summary, bug report prompts |
| `schema.sql` | 5 tables, 5 indexes — D1-compatible SQLite schema |
| `seed.sql` | The shared demo project (`proj-demo`) loaded by every reset |
| `test/` | Vitest suites: routing, personas, demo data, OAuth wiring, end-to-end login |

## License

MIT
