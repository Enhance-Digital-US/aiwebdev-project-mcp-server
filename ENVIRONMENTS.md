# Environments: Development, Staging, Production

This guide covers how the Issue Tracker MCP server is configured for its three environments, how to set up each one from scratch, and how to ship a change from your laptop to production.

## TL;DR

| | Development | Staging | Production |
|---|---|---|---|
| **Runs** | Your machine (`pnpm dev`) | Cloudflare | Cloudflare |
| **Worker** | — | `issue-tracker-mcp-staging` | `issue-tracker-mcp-production` |
| **D1 database** | `issue-tracker-db` (local SQLite in `.wrangler/state`) | `issue-tracker-db-staging` | `issue-tracker-db-production` |
| **OAuth KV (grants, tokens)** | local, in `.wrangler/state` | `OAUTH_KV` (staging namespace) | `OAUTH_KV` (production namespace) |
| **Secrets live in** | `.dev.vars` | `wrangler secret` (staging) | `wrangler secret` (production) |
| **Persona login** (`/authorize`) | Enabled | Enabled | Enabled |
| **`/auth/dev-token`** | Enabled | 404 | 404 |
| **Demo data reset** | `pnpm db:reset:local` | Hourly + `pnpm db:reset:staging` | Hourly + `pnpm db:reset:production` |
| **Logs** | Terminal | `pnpm tail:staging` | `pnpm tail:production` |
| **Deploy** | Never | `pnpm deploy:staging` | `pnpm deploy:production` |

Each hosted environment is fully isolated: its own Worker, database, KV namespace and secrets. A token or persona password from staging doesn't work on production.

## How the Config Works

All three environments live in one file, `wrangler.jsonc`:

```jsonc
{
  "name": "issue-tracker-mcp",
  "d1_databases": [ /* development: local only */ ],
  "vars": { "ENVIRONMENT": "development", ... },

  "env": {
    "staging":    { "d1_databases": [ ... ], "vars": { "ENVIRONMENT": "staging", ... } },
    "production": { "d1_databases": [ ... ], "vars": { "ENVIRONMENT": "production", ... } }
  }
}
```

- **The top level is development.** `wrangler dev` uses it when you don't pass `--env`.
- **`--env staging` / `--env production` select a block under `env`.** Wrangler appends the env name to the Worker name, which is where `issue-tracker-mcp-staging` comes from.
- **`ENVIRONMENT` tells the code where it's running.** `src/index.ts` reads it to decide whether `/auth/dev-token` exists. The check is fail-closed: anything other than `development`, including a missing value, disables the endpoint.

> **Gotcha:** `vars` and bindings such as `d1_databases` are **not inherited** by environments. A staging block without `vars` doesn't fall back to the top-level vars. It gets *no* vars, and `c.env.RESOURCE_URL` is `undefined` at runtime. Settings like `main` and `compatibility_date` *are* inherited. See [Adding a Variable or Binding](#adding-a-variable-or-binding).

> **Gotcha:** The top level is never deployed. `pnpm deploy` exits with an error on purpose. If someone runs a bare `npx wrangler deploy`, it fails because the top-level `database_id` isn't a real database.

## Development (Local)

Development needs no Cloudflare account. Wrangler simulates D1 with a local SQLite file.

```bash
pnpm install
cp .dev.vars.example .dev.vars   # AUTH_SECRET + the three persona passwords
pnpm db:migrate:local            # create tables in the local D1
pnpm db:reset:local              # load the shared demo project (seed.sql)
pnpm dev                         # http://localhost:8787
```

`RESOURCE_URL`, `AUTH_SERVER_URL` and `ENVIRONMENT` come from the top level of `wrangler.jsonc`. Values in `.dev.vars` override them, which is useful if you run on a different port.

Get a token and make a request:

```bash
TOKEN=$(curl -s -X POST http://localhost:8787/auth/dev-token \
  -H "Content-Type: application/json" \
  -d '{"sub":"user-alice","scope":"admin"}' | jq -r .access_token)

curl -X POST http://localhost:8787/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

### Demo Data

Every environment holds one shared demo project, `proj-demo`. Alice (`admin`), Bob (`member`) and Carol (`viewer`) are all members of it, and it has 8 issues covering every status and priority. Its contents come from `seed.sql`.

A reset wipes **all** projects, issues, comments, members and activity, including anything students created, then reloads `seed.sql`. It never signs anyone out.

| Environment | When it resets |
|---|---|
| Development | Only when you run `pnpm db:reset:local` |
| Staging / Production | Every hour, on the hour (cron trigger), or on demand with `pnpm db:reset:staging` / `pnpm db:reset:production` |

To start completely fresh locally, delete `.wrangler/state` and run `pnpm db:migrate:local && pnpm db:reset:local`.

## Setting Up a Hosted Environment

Do this once for staging, then repeat for production. Every command below is shown for staging; swap `staging` for `production` the second time.

### Prerequisites

```bash
npx wrangler login     # opens a browser
npx wrangler whoami    # confirm you're on the right account
```

### 1. Create the D1 Database

```bash
npx wrangler d1 create issue-tracker-db-staging
```

Copy the `database_id` from the output into `wrangler.jsonc`:

```jsonc
"staging": {
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "issue-tracker-db-staging",
      "database_id": "<paste here>"   // was TODO_STAGING_DATABASE_ID
    }
  ],
```

Keep the binding name `DB` in every environment. The code only knows `c.env.DB`.

Then create the KV namespace that holds OAuth grants and tokens, and paste its `id` over `TODO_STAGING_OAUTH_KV_ID`:

```bash
npx wrangler kv namespace create OAUTH_KV --env staging
```

### 2. Fill In the URLs

Find your workers.dev subdomain in the dashboard under **Workers & Pages**, shown as *Subdomain* on the right. Replace `YOUR_SUBDOMAIN` in `env.staging.vars`:

```jsonc
"RESOURCE_URL": "https://issue-tracker-mcp-staging.<subdomain>.workers.dev/mcp",
```

`RESOURCE_URL` must match the deployed URL **exactly**, including `/mcp` and with no trailing slash. It's compared against the `aud` claim of every token. A mismatch means every request fails with `401 Token resource mismatch`.

### 3. Apply the Schema and Load the Demo Data

```bash
pnpm db:migrate:staging
pnpm db:reset:staging
```

The first command runs `schema.sql` against the remote staging database. Every statement uses `IF NOT EXISTS`, so running it again is harmless once the database is up to date. A database created before lesson 16 needs the one-off migration in [Schema Changes](#schema-changes) first. The second loads the demo project from `seed.sql`. After the first deploy, the hourly cron keeps it in that state.

### 4. Set the Secrets

Four secrets per environment. For each one, generate a random value and paste it when Wrangler prompts:

```bash
openssl rand -hex 32                                         # AUTH_SECRET (dev-token signing key)
npx wrangler secret put AUTH_SECRET --env staging

openssl rand -base64 18                                      # one per persona, e.g. "q3J8…"
npx wrangler secret put PERSONA_PASSWORD_ADMIN --env staging    # Alice
npx wrangler secret put PERSONA_PASSWORD_MEMBER --env staging   # Bob
npx wrangler secret put PERSONA_PASSWORD_VIEWER --env staging   # Carol
```

If the Worker doesn't exist yet, Wrangler offers to create it. **Use different values for production**, so staging passwords can't sign in to production. The persona passwords are what you give students. Keep them somewhere private, such as your course platform, not the repo. A persona whose password isn't set can't sign in at all.

Never put the secret in `wrangler.jsonc` or pass it as a command-line argument. The config file is committed, and CLI arguments end up in shell history.

### 5. Deploy

```bash
npx wrangler deploy --dry-run --env staging   # optional: check bindings first
pnpm deploy:staging
```

The dry-run prints the bindings table. Check that `env.DB` points at `issue-tracker-db-staging` and that `ENVIRONMENT` is `"staging"`.

### 6. Verify

```bash
URL=https://issue-tracker-mcp-staging.<subdomain>.workers.dev

# Unauthenticated MCP request → 401 with a WWW-Authenticate header
curl -i -X POST $URL/mcp

# Protected resource metadata → JSON with your RESOURCE_URL
curl $URL/.well-known/oauth-protected-resource/mcp

# Dev token endpoint → 404 (disabled outside development)
curl -i -X POST $URL/auth/dev-token
```

Then sign in end to end with Claude Code:

```bash
claude mcp add --transport http issue-tracker-staging $URL/mcp
```

Run `/mcp`, authenticate, and sign in as Carol on the login page that opens. Ask Claude to search the demo issues (this should work), then to create an issue (this should be refused with `Forbidden`). If both behave as described, the environment is set up.

## Shipping a Change

```
local (pnpm dev)  →  staging  →  production
```

1. **Develop and test locally** with `pnpm dev`. Run `pnpm typecheck` before you commit.
2. **Deploy to staging** with `pnpm deploy:staging`. Watch `pnpm tail:staging` while you exercise it.
3. **Deploy the same commit to production** with `pnpm deploy:production`.

Deploy production from the exact code you tested on staging. Each deploy bundles your working tree, so uncommitted edits ship too.

### Schema Changes

Apply schema changes **before** the code that depends on them, and to staging before production:

```bash
pnpm db:migrate:staging      # then deploy:staging, test
pnpm db:migrate:production   # then deploy:production
```

If the change touches tables the demo uses, update `seed.sql` in the same commit and check it with `pnpm db:reset:local`. The hourly cron runs `seed.sql` on every hosted environment, so a seed that no longer matches the schema breaks the reset.

`schema.sql` only creates objects that don't exist. It can't alter an existing table. Columns added later ship twice: in `schema.sql` for fresh databases, and as a one-off file in `migrations/` for databases that already exist.

| File | Adds | Needed by |
|---|---|---|
| `migrations/0001_issue_external_id.sql` | `issues.external_id` and its unique index | Databases created at lesson 13 or earlier |

For each existing database, run the one-off file **once**, then `schema.sql`, then deploy:

```bash
npx wrangler d1 execute DB --env staging --remote --file=migrations/0001_issue_external_id.sql
pnpm db:migrate:staging      # then deploy:staging, test, and repeat for production
```

The order matters. The new `schema.sql` creates an index on the new column, so it fails with `no such column: external_id` on a database that hasn't been migrated. The new code writes the column on every `create_issue`. Old code ignores the extra column, so migrating first is always safe. Running the one-off file a second time fails harmlessly with `duplicate column name`.

These aren't `wrangler d1 migrations` files: nothing records which databases have had them. Don't run `wrangler d1 migrations apply` on this folder. If this project grows more of them, switch to D1 migrations properly, which track what each database has already applied.

### Rolling Back

```bash
npx wrangler deployments list --env production
npx wrangler rollback --env production            # previous version
npx wrangler rollback <VERSION_ID> --env production
```

Rollback restores code, not data. A rollback doesn't undo a schema change or rows written in the meantime.

## Adding a Variable or Binding

Because of non-inheritance, a new var or binding has to be added in **four** places:

1. Top level of `wrangler.jsonc` (development)
2. `env.staging`
3. `env.production`
4. The `Bindings` type in `src/index.ts`

For a new **secret**, skip `wrangler.jsonc`. Add it to `.dev.vars` and `.dev.vars.example` (placeholder value only), run `wrangler secret put <NAME> --env staging` and the same for production, and add it to the `Bindings` type.

Run a dry-run for both environments afterwards and confirm the new binding appears in both tables.

## Authentication per Environment

| Environment | How clients get a token |
|---|---|
| Development | The persona login (OAuth, via `/authorize`) **or** `POST /auth/dev-token` (HS256, signed with `.dev.vars` `AUTH_SECRET`). Both kinds of token are accepted at `/mcp`. |
| Staging / Production | The persona login only. Dev tokens get `401` even if someone has the signing secret. |

## Rotating Persona Passwords

Between cohorts, or if a password leaks:

```bash
npx wrangler secret put PERSONA_PASSWORD_VIEWER --env staging   # and/or _ADMIN, _MEMBER
```

That's the whole procedure, with no script to run. Each token records a fingerprint of the persona's password at sign-in. Once the password changes, existing sessions for that persona get `401` on their next request, and Claude Code sends the student back to the login page. Give students the new password.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `This Worker requires compatibility date "…", but the newest date supported by this server binary is "…"` | `compatibility_date` is newer than your installed Wrangler's runtime | Lower the date to the one in the message, or upgrade Wrangler: `pnpm add -D wrangler@latest` |
| `401 Token resource mismatch` | `RESOURCE_URL` doesn't match the token's `aud` | Make `RESOURCE_URL` exactly the deployed `/mcp` URL and get a fresh token |
| `5xx` on `/mcp` or `/oauth/token` in a hosted env | `OAUTH_KV` still has a `TODO_…` id, or the namespace doesn't exist | `npx wrangler kv namespace create OAUTH_KV --env <env>` and paste the id |
| `/auth/dev-token` returns `500` in development | `AUTH_SECRET` missing from `.dev.vars` | Copy it from `.dev.vars.example` and restart `pnpm dev` |
| `c.env.X` is `undefined` in staging/production only | Var added at the top level but not under `env.<name>` | Add it to every environment (see above) |
| `no such table: issues` | Schema not applied to that env's database | `pnpm db:migrate:<env>` |
| `no such column: external_id` from `create_issue` or `db:migrate:<env>` | Database created before lesson 16 | Run `migrations/0001_issue_external_id.sql` once on it (see [Schema Changes](#schema-changes)) |
| Login fails with "This app could not be verified." | The client's Client ID Metadata Document couldn't be fetched (it's private, unreachable, or the `global_fetch_strictly_public` flag blocked a private address) | Check the client's `client_id` URL is public. Clients can still register through `/oauth/register` instead. |
| "Incorrect persona or password." with the right password | That persona's `PERSONA_PASSWORD_*` isn't set in this environment | `npx wrangler secret list --env <env>`, then `secret put` the missing one |
| `403 Forbidden: unexpected Host` on every request | The request's host doesn't match the host in `RESOURCE_URL` (DNS-rebinding protection) | Set `RESOURCE_URL` to exactly the deployed URL, or to the local port you're actually using |
| `403` with `error code: 1050` on every path, and `wrangler tail` shows no requests | Cloudflare Zero Trust Access protects the account's `*.workers.dev` hosts, so the edge blocks requests before the Worker runs | In Zero Trust → Access → Applications, add a self-hosted app for exactly this Worker's hostname with a **Bypass / Everyone** policy. MCP clients can't complete an Access login; the server's own OAuth is the auth layer. |
| `pnpm dev` says port 8787 is in use | Another `wrangler dev` is still running | Stop it, or `pnpm dev --port 8788` and set `RESOURCE_URL` in `.dev.vars` to match |
