# Proposal

## Why

Staging and production are served on `*.enhancedigital.workers.dev`. Cloudflare Zero Trust Access protects every host on that account subdomain, so each Worker needs its own Access Bypass application before an MCP client can reach it. The URLs also carry the account's internal name instead of the course's. Moving both environments to hostnames under the course domain `course-projects.ai-web.dev` gives students stable, branded URLs. It also removes the workers.dev Access workaround from the setup guide.

## What Changes

- Production is served at `https://issue-tracker.course-projects.ai-web.dev`, with the MCP endpoint at `/mcp`.
- Staging is served at `https://staging.issue-tracker.course-projects.ai-web.dev`, with the MCP endpoint at `/mcp`.
- Both hosted environments attach their hostname as a Workers Custom Domain. Cloudflare then manages the DNS record and certificate.
- **BREAKING**: Both hosted environments stop serving their `*.workers.dev` URLs (`workers_dev: false`). Clients configured with the old URLs stop working.
- **BREAKING**: `RESOURCE_URL` and `AUTH_SERVER_URL` change for both hosted environments, which changes the OAuth issuer and token audience. Existing grants and tokens can't be used on the new hosts. Each MCP client must be re-added with the new URL and sign in through the persona login again. Persona passwords and other secrets don't change.
- `ENVIRONMENTS.md` and `README.md` describe choosing a custom hostname in place of looking up the workers.dev subdomain. Their example URLs and troubleshooting entries are updated to match.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `deployment-environments`: The "Requests to the configured hostname are served" scenario no longer names the workers.dev hostname. A new requirement says hosted environments are reachable only on their own custom hostname.

## Impact

- **Config:** `wrangler.jsonc`, in `env.staging` and `env.production`:
  - `vars.RESOURCE_URL` and `vars.AUTH_SERVER_URL`
  - a new `routes` entry with `custom_domain: true`
  - `workers_dev: false`
- **Code:** No source changes. The Host check, OAuth issuer, token audience and protected-resource metadata already come from the two vars.
- **Tests:** `test/routing.test.ts` uses a placeholder workers.dev host. Change it to a custom-domain-style placeholder so it matches the spec wording.
- **Docs:** `ENVIRONMENTS.md` (setup step 2, verify step 6, troubleshooting table) and `README.md` (the `claude mcp add` example).
- **Infrastructure:**
  - DNS records and certificates are created in the `ai-web.dev` zone, which is in the same Cloudflare account as the Workers.
  - Zero Trust Access must let both new hostnames through without an Access login. The course owner handles this.
  - The old workers.dev Bypass applications can be removed.
- **Users:** Anyone connected to the old URLs must re-add the server and sign in again.
