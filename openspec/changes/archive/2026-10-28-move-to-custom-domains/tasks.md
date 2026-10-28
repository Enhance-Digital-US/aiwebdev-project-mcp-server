# Tasks

## 1. Repo changes (config, test, docs)

- [x] 1.1 In `wrangler.jsonc` `env.staging`, make these changes:
  - set `workers_dev: false`
  - add `"routes": [{ "pattern": "staging.issue-tracker.course-projects.ai-web.dev", "custom_domain": true }]`
  - set `RESOURCE_URL` to `https://staging.issue-tracker.course-projects.ai-web.dev/mcp`
  - set `AUTH_SERVER_URL` to `https://staging.issue-tracker.course-projects.ai-web.dev`
  - update the block comment to name the hostname

  Verify: `npx wrangler deploy --dry-run --env staging` succeeds and its output shows the new vars.
- [x] 1.2 In `wrangler.jsonc` `env.production`, make the same changes for `issue-tracker.course-projects.ai-web.dev`.

  Verify: `npx wrangler deploy --dry-run --env production` succeeds and its output shows the new vars. Then confirm `grep -n workers.dev wrangler.jsonc` returns nothing.
- [x] 1.3 In `test/routing.test.ts`, change `STAGING_URL` to a custom-domain-style placeholder (`https://staging.issue-tracker.example.test`) to match the updated "Hosted hostname is accepted" scenario.

  Verify: `pnpm test` passes.
- [x] 1.4 Update `ENVIRONMENTS.md`:
  - Rewrite setup step 2 ("Fill In the URLs") as: choose a hostname in a zone on your account, then set `RESOURCE_URL`, `AUTH_SERVER_URL`, `routes` with `custom_domain: true`, and `workers_dev: false`.
  - Point step 6 ("Verify") `URL=` at the custom hostname, and add a check that the workers.dev URL no longer serves the Worker.
  - Rewrite the `1050` troubleshooting row so it applies to any Access policy that covers the hostname, not just workers.dev.
  - Add a row for a TLS or handshake failure in the first minutes after the first deploy, while the certificate is being issued.

  Verify: `grep -n 'workers.dev' ENVIRONMENTS.md` only matches intentional mentions, such as "workers.dev is disabled".
- [x] 1.5 Update `README.md`:
  - Change the `claude mcp add` example to `https://staging.issue-tracker.course-projects.ai-web.dev/mcp`.
  - Add both hostnames to the Environments & Deployment table.
  - Check that the RFC 9728 discovery, `401` challenge and audience narrative still reads correctly with the new URLs.

  Verify: `grep -n 'workers.dev\|<subdomain>' README.md` returns nothing.

## 2. Deploy staging (needs the course owner's go-ahead)

- [x] 2.1 Confirm with the course owner that Zero Trust Access lets `staging.issue-tracker.course-projects.ai-web.dev` through, using an exact-host Bypass or by confirming no Access app covers it. Then run `pnpm deploy:staging`.

  Verify: the deploy output lists the Custom Domain, and `dig +short staging.issue-tracker.course-projects.ai-web.dev` resolves.
- [x] 2.2 Check staging over HTTP:
  - `curl https://staging.issue-tracker.course-projects.ai-web.dev/.well-known/oauth-protected-resource/mcp` names the new resource and authorization server URLs
  - an unauthenticated `POST /mcp` returns `401` with a `WWW-Authenticate` header pointing at the new host
  - `POST /auth/dev-token` returns `404`
  - `https://issue-tracker-mcp-staging.enhancedigital.workers.dev` no longer reaches the Worker
- [x] 2.3 Run an end-to-end persona check on staging:
  1. `claude mcp add --transport http issue-tracker-staging https://staging.issue-tracker.course-projects.ai-web.dev/mcp`
  2. Sign in as Carol.

  Verify: searching issues succeeds and creating an issue is refused with `Forbidden`.

## 3. Deploy production (same commit, needs the course owner's go-ahead)

- [x] 3.1 Confirm with the course owner that Zero Trust Access lets `issue-tracker.course-projects.ai-web.dev` through. Then run `pnpm deploy:production` from the same commit that passed on staging.

  Verify: the deploy output lists the Custom Domain, and the hostname resolves.
- [x] 3.2 Repeat the HTTP checks from 2.2 and the persona check from 2.3 against `https://issue-tracker.course-projects.ai-web.dev`.

  Verify: all the same outcomes, and the old production workers.dev URL no longer reaches the Worker.

## Workflow follow-up

- The course owner removes the old workers.dev Zero Trust Bypass applications once both environments are verified.
- Tell anyone connected to the old URLs to remove the server and add the new URL.
- Archive the change with `/opsx:archive` after review, so the `deployment-environments` main spec picks up the delta.
