# Design

## Context

Two vars in `wrangler.jsonc` decide every hostname-dependent behavior: `RESOURCE_URL` and `AUTH_SERVER_URL`. Specifically:

- The Host check (`src/index.ts`) serves only `new URL(RESOURCE_URL).host`.
- The OAuth authorization server takes `AUTH_SERVER_URL` as its issuer and `RESOURCE_URL` as its only resource (`src/oauth.ts`).
- The protected-resource metadata and the `401` challenge are built from the same pair.

Hosted environments currently set `workers_dev: true` and no `routes`, and both vars point at `*.enhancedigital.workers.dev`. The `ai-web.dev` zone uses Cloudflare nameservers, is in the same account as the Workers, and has no record yet for either target hostname.

## Goals / Non-Goals

**Goals:**
- Serve each hosted environment from its custom hostname (see the spec delta), with DNS and TLS managed by Cloudflare.
- Make the change by editing config only, so the Host-check, OAuth and audience code stays the same.
- Keep staging and production configured the same way, so a successful staging run is good evidence for production.

**Non-Goals:**
- Serving the old and new hostnames at the same time. The Host check accepts exactly one host, and a transition period isn't worth the code change while there are no real users.
- Migrating existing OAuth grants or tokens to the new issuer. Clients sign in again.
- Configuring Zero Trust Access. The course owner handles this outside the repo.
- Changing development. It stays on `http://localhost:8787`.

## Decisions

### Workers Custom Domains, not routes with manual DNS
Each hosted env gets `"routes": [{ "pattern": "<host>", "custom_domain": true }]`. On deploy, Wrangler creates the proxied DNS record and the edge certificate for that exact hostname.

- *Alternative: a zone route (`<host>/*`) plus a hand-made DNS record.* Rejected. Both hostnames are more than one level below `ai-web.dev`, and Universal SSL only covers `ai-web.dev` and `*.ai-web.dev`. A route would need Advanced Certificate Manager, plus a DNS record kept outside the repo.
- Custom Domains also keep the hostname in `wrangler.jsonc`, so the config file is still the only record of where each environment lives.

### `workers_dev: false` in both hosted environments
Once `RESOURCE_URL` moves, the Host check would refuse the workers.dev URL with `403` anyway. Leaving it enabled would expose a URL that always fails. It would also keep the account's Zero Trust policy, and the `1050` trap that comes with it, in the setup guide. Turning it off makes the custom domain the only way in, as the spec requires.

- *Alternative: keep workers.dev as a fallback.* Rejected. It can't serve requests without code changes to the Host check, and it's the source of the Access problem this change removes.

### Staging nested under production's hostname
Staging is `staging.issue-tracker.course-projects.ai-web.dev` (the user's choice). This is safe because the server sets no cookies: OAuth is bearer-token only, and the login page posts a form with no session cookie. Nothing scoped to the production host can reach staging.

Each environment still has its own Worker, D1 database, KV namespace and secrets, so the "Three isolated environments" requirement is unaffected.

### No source changes
The URL pair already flows through `Bindings` into the Host check, the OAuth servers and the metadata. Editing it in `wrangler.jsonc` is the whole behavior change.

The one test fixture that names a workers.dev host (`test/routing.test.ts`) gets a custom-domain-style placeholder, `staging.issue-tracker.example.test`. This keeps the test matched to the spec wording. Its assertions don't change.

## Risks / Trade-offs

- **[Certificate not yet issued right after the first deploy]** → Requests can fail TLS for a short time while the edge certificate is issued. Mitigation: check `/.well-known/oauth-protected-resource/mcp` on the new host before announcing it. Don't treat a TLS failure in the first minutes as a config error.
- **[Zero Trust Access covers the new hostnames]** → An Access app with a wildcard such as `*.ai-web.dev` would return `403 error code: 1050` at the edge, the same failure as today. Mitigation: the course owner adds exact-host Bypass rules for both hostnames, or confirms none apply. A troubleshooting row in `ENVIRONMENTS.md` keeps the symptom documented.
- **[Connected clients break]** → After the move, every client configured with a workers.dev URL fails. Mitigation: there are no real users yet. The docs give the new URLs and say that existing connections must be removed and re-added.
- **[Hostname already claimed]** → A Custom Domain deploy fails if a DNS record for the hostname already exists. Neither hostname resolves today, so this is low risk. Wrangler names the conflict if it happens.

## Migration Plan

1. **Staging.**
   1. Update `env.staging` in `wrangler.jsonc` (vars, `routes`, `workers_dev: false`).
   2. Run `wrangler deploy --dry-run --env staging`.
   3. Run `pnpm deploy:staging`.
   4. Verify metadata, the `401` challenge, the `404` from dev-token, and an end-to-end persona sign-in on the new host.
   5. Confirm the old workers.dev URL no longer reaches the Worker.
2. **Production.** Repeat the same steps with `env.production`, from the same commit.
3. **Clean up.** Remove the old workers.dev Access Bypass apps (course owner) and update the docs.

**Rollback:** Revert the `wrangler.jsonc` change and redeploy the affected environment. This restores the workers.dev URL and its vars. Grants issued on the custom domain won't validate on the restored host, so clients sign in again, just as they do going forward. The Custom Domain can be detached in the dashboard or by redeploying without the route.
