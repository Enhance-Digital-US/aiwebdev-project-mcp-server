# Tasks

## 1. Preconditions

- [x] 1.1 Confirm `add-simulated-roles-oauth` is archived (`openspec list` no longer shows it); verify its `mcp-authorization` and `demo-data` specs exist under `openspec/specs/`
- [x] 1.2 Tag the current `main` as `lesson-13` and push the tag (design §5); verify `git ls-remote --tags origin` lists `lesson-13` at the commit before any code from this change

## 2. Idempotent creation

- [x] 2.1 Add the nullable `external_id` column and the `(project_id, external_id)` unique index to `schema.sql`; verify `pnpm db:migrate:local` on a fresh local database creates both, and `pnpm db:reset:local` still seeds the demo project
- [x] 2.2 Implement insert-or-skip in `Store.createIssue`, keeping `requireScope` first, and return `replayed` (design §2–3); add tests: same key twice → one issue and `replayed: true` on the second; changed title on replay → first title kept; same key in another project → new issue; no key → two issues; viewer replaying an existing key → refused
- [x] 2.3 Accept `external_id` in the `create_issue` tool's input schema, and include `external_id` in issue tool results and resources; verify with tests, and confirm `pnpm typecheck` and `pnpm test` pass
- [x] 2.4 Add `migrations/0001_issue_external_id.sql` (design §4); verify locally by applying the old `schema.sql` to a fresh database, then the migration, then `create_issue` with a key

## 3. Documentation and rollout

- [x] 3.1 Document `external_id`, `replayed`, and why durable callers need them in the README's tool reference, plus the one-off migration step; verify the README's teaching narrative still reads correctly end to end
- [x] 3.2 Run the one-off migration on staging, then production; verify on each that `create_issue` with a key, called twice, returns `replayed: true` the second time
  - Neither hosted environment existed before this change, so both were provisioned fresh and `schema.sql` created `external_id` directly; the one-off migration was not needed. Verified on both through the real persona login: first call `replayed: false`, retry `replayed: true` with the same id and the first title, viewer refused.
- [ ] 3.3 Tag `main` as `lesson-16` and push the tag; verify `git ls-remote --tags origin` lists both `lesson-13` and `lesson-16`
