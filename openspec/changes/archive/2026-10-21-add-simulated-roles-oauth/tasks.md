# Tasks

## 1. Test harness and hosted Host check

- [x] 1.1 Add `@cloudflare/vitest-plugin` (the renamed successor of the deprecated `@cloudflare/vitest-pool-workers`) and create `vitest.config.ts` using `cloudflareTest()`, which uses the top-level `wrangler.jsonc` with these test bindings: `AUTH_SECRET=test-secret`, `PERSONA_PASSWORD_ADMIN=admin-pw-test`, `PERSONA_PASSWORD_MEMBER=member-pw-test` and `PERSONA_PASSWORD_VIEWER=viewer-pw-test`. Verify that `pnpm test` starts the Workers pool.
- [x] 1.2 Add `runSqlScript(db, sql)` in `src/sql.ts` and the `*.sql` module declaration in `src/sql-modules.d.ts`. Add `test/setup.ts`, which applies `schema.sql` to `env.DB` and exports `devToken(sub, scope)`. Verify that a smoke test can query the `projects` table.
- [x] 1.3 Write `test/routing.test.ts` covering the `deployment-environments` delta scenarios:
  - the hosted hostname, with `ENVIRONMENT=staging` and a matching `RESOURCE_URL`, reaches the `/auth/dev-token` 404 gate;
  - a foreign Host returns `403`;
  - a dev token is issued in development.

  Verify that the hosted-hostname test FAILS with `403` before the fix.
- [x] 1.4 Replace `createMcpHonoApp()` in `src/index.ts` with `new Hono<Env>()` plus a Host middleware that matches `new URL(RESOURCE_URL).host`. Verify that `pnpm test` and `pnpm typecheck` pass.
- [x] 1.5 Add "403 on every request → `RESOURCE_URL` must match the deployed host exactly" to the troubleshooting table in `ENVIRONMENTS.md`. Verify that it reads correctly next to the existing rows.

## 2. Personas

- [x] 2.1 Write `test/personas.test.ts`:
  - Carol plus `viewer-pw-test` resolves to Carol;
  - a wrong password returns `null`;
  - `user-mallory` returns `null`;
  - with the member password unset or `''`, an empty-password login for Bob returns `null` and `passwordFingerprint` returns `null`;
  - the fingerprint changes when the secret changes.

  Verify that the tests FAIL because the module is missing.
- [x] 2.2 Implement `src/personas.ts`:
  - `PERSONAS` (alice/admin, bob/member, carol/viewer, reusing `Role` from `src/store.ts`);
  - `findPersona`;
  - `verifyPersonaPassword`, using a constant-time SHA-256 digest compare;
  - `passwordFingerprint`, as the first 16 hex characters of SHA-256(`id:password`).

  Verify that `pnpm test` passes.

## 3. Demo data

- [x] 3.1 Write `test/demo.test.ts` covering the `demo-data` scenarios:
  - after a reset, the three persona members and 8 issues covering all statuses and priorities exist;
  - a student-created project is gone after a reset;
  - two resets give the same counts;
  - the worker's `scheduled()` re-seeds the data, using `createScheduledController` and awaiting `waitUntil`.

  Verify that the tests FAIL.
- [x] 3.2 Write `seed.sql`:
  - delete activity, comments, issues, members and projects, in that order;
  - insert `proj-demo` ("Demo: Course Issue Tracker") and its three members;
  - insert `demo-issue-1` to `demo-issue-8`, with statuses backlog, open ×2, in_progress ×2, review, done, closed, all four priorities, assignees bob, carol or NULL, and JSON labels;
  - insert 3 comments and 3 activity rows.

  Verify that `pnpm db:migrate:local && npx wrangler d1 execute DB --local --file=seed.sql` runs without errors.
- [x] 3.3 Implement `resetDemoData(db)` in `src/demo.ts` and change the default export in `src/index.ts` to `{ fetch, scheduled }`, where `scheduled` calls `ctx.waitUntil(resetDemoData(env.DB))`. Verify that `pnpm test` passes.
- [x] 3.4 Add `triggers.crons: ["0 * * * *"]` to `env.staging` and `env.production` only, and add the `db:reset:local`, `db:reset:staging` and `db:reset:production` scripts. Verify that `npx wrangler deploy --dry-run --env staging` lists the schedule and that the top-level config has no trigger.
- [x] 3.5 Document the demo project, the hourly reset and the `pnpm db:reset:*` commands in `ENVIRONMENTS.md` (development section, hosted setup and "Shipping a Change"). Verify that every command named exists in `package.json`.

## 4. Authorization server and resource server

- [x] 4.1 Add `@cloudflare/workers-oauth-provider@^1.2.3`.
- [x] 4.2 Update `wrangler.jsonc`:
  - add `compatibility_flags: ["global_fetch_strictly_public"]` at the top level;
  - add `OAUTH_KV` to all three blocks, with a local placeholder ID for development and `TODO_STAGING_OAUTH_KV_ID` / `TODO_PRODUCTION_OAUTH_KV_ID` for the hosted environments;
  - set the staging and production `AUTH_SERVER_URL` to the Worker origin.

  Then add the `PERSONA_PASSWORD_*` placeholders to `.dev.vars.example` and `OAUTH_KV`/`PERSONA_PASSWORD_*` to `Bindings`. Verify that both dry-runs show `env.OAUTH_KV` and the right `ENVIRONMENT`.
- [x] 4.3 Write `test/oauth-wiring.test.ts` covering the `mcp-authorization` scenarios:
  - an unauthenticated `POST /mcp` returns `401` with `resource_metadata`;
  - the protected resource metadata names `RESOURCE_URL` and `AUTH_SERVER_URL`;
  - the authorization server metadata lists the roles and a registration endpoint;
  - DCR returns a `client_id`;
  - a viewer dev token's `create_issue` on `proj-demo` returns `Forbidden`;
  - a dev token returns `401` when `ENVIRONMENT=staging`.

  Verify that the tests FAIL.
- [x] 4.4 Implement `src/oauth.ts`:
  - `AuthProps`;
  - `getAuthorizationServer(env)` and `getResourceServer(env)`, memoized per URL pair with the options in `design.md`;
  - the validator: development dev tokens, then library tokens, then the `pwfp` check;
  - `toAuthInfo`.

  Mount the routes in `src/index.ts`, removing the `oauthMetadataResponse` and `requireBearerAuth` paths. Verify that `pnpm test` and `pnpm typecheck` pass.
- [x] 4.5 Rewrite the "Authentication & Authorization" chain in `README.md`: OAuth login → token → `ctx.props`/`ctx.auth` → `toAuthInfo` → `Store`. Keep the `401` → RFC 9728 → audience narrative accurate to the new code. Note that MCP Inspector uses dev tokens and works in development only. Verify that every path and endpoint named in the section exists in the code.

## 5. Persona login and consent page

- [x] 5.1 Write the end-to-end tests in `test/login.test.ts`. The flow is: register a client by DCR with `client_name: '<b>Test</b>'` and redirect `http://localhost:9999/callback`; use PKCE S256; carry cookies by hand. Assert that:
  - the GET page lists the three personas and escapes the client name;
  - Carol's approval redirects with a `code`, and the code exchange returns access and refresh tokens;
  - Carol's `create_issue` returns `Forbidden` and her `search_issues` returns demo issues;
  - Bob's `create_issue` succeeds and his `delete_project` returns `Forbidden`;
  - `scope=admin` plus a Carol login gives scope `viewer`;
  - a wrong password, or persona `user-mallory`, returns `401` with "Incorrect persona or password." and no echoed password;
  - a reused handle returns `400` with no client redirect;
  - Deny redirects with `error=access_denied`;
  - changing `PERSONA_PASSWORD_VIEWER` makes Carol's token return `401`;
  - a demo reset leaves Carol's token working;
  - no case returns `500`.

  Verify that the tests FAIL.
- [x] 5.2 Implement `src/login.ts` (`registerLoginRoutes`, `renderLoginPage`) following the "Login page" decision in `design.md`, and mount it in `src/index.ts`. Verify that `pnpm test` and `pnpm typecheck` pass.
- [x] 5.3 Add a "Trying the roles" section to `README.md`:
  - connect Claude Code to the hosted URL with no headers;
  - log in as each persona;
  - an expected-results table per tool and role (viewer read-only; member creates but can't delete; admin deletes after confirming);
  - the hourly reset.

  Update the Architecture tree with `src/oauth.ts`, `src/login.ts`, `src/personas.ts`, `src/demo.ts`, `seed.sql` and `test/`. Verify that the table matches the `mcp-authorization` "Roles govern MCP operations" scenarios.
- [x] 5.4 Update `ENVIRONMENTS.md`:
  - hosted setup gains `wrangler kv namespace create OAUTH_KV`, the three `wrangler secret put PERSONA_PASSWORD_* --env <env>` commands, and a Claude Code login as the verify step;
  - add a "Rotating persona passwords" section (set new secrets; old sessions get `401` and re-login);
  - the "Authentication per Environment" table becomes: development = OAuth login + dev token; hosted = OAuth login only;
  - add a troubleshooting row for a CIMD fetch failure (missing `global_fetch_strictly_public`).

  Verify that every command named exists.

## 6. Integration check

- [x] 6.1 Run `pnpm test`, `pnpm typecheck`, `npx wrangler deploy --dry-run --env staging` and `npx wrangler deploy --dry-run --env production`. Verify that all pass and that each dry-run lists `DB`, `OAUTH_KV`, the cron and the environment's vars.
- [ ] 6.2 Run a manual end-to-end check with the user:
  1. Put the persona passwords in `.dev.vars` and run `pnpm db:migrate:local && pnpm db:reset:local && pnpm dev`.
  2. `claude mcp add --transport http issue-tracker-local http://localhost:8787/mcp`, then authenticate with `/mcp`.

  Verify that the browser login opens, that a Carol login can read `proj-demo`, and that `create_issue` is refused.

## Workflow follow-up

- Make an initial commit only if the user approves. The repo has no commits yet.
- Run `openspec validate add-simulated-roles-oauth --strict` before archiving.
- After deploying to staging, archive the change with `/opsx:archive` so `mcp-authorization` and `demo-data` become main specs.
