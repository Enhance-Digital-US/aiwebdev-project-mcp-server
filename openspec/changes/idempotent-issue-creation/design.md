# Design

## Context

See proposal.md for motivation. Constraints:

- `schema.sql` is applied with `CREATE TABLE IF NOT EXISTS` by `db:migrate:*`. Editing a table there changes fresh databases only. The existing staging and production databases keep their old `issues` table.
- `seed.sql` (demo data, hourly reset on hosted environments) inserts issues with an explicit column list and deletes every issue first. A new nullable column needs no seed change.
- `Store.createIssue` already calls `requireScope(this.auth, 'admin', 'member')` before writing. That check must stay first.
- The caller is a Cloudflare Workflow step that may run more than once, possibly concurrently after a timeout.

## Goals / Non-Goals

**Goals:** retries of `create_issue` with the same key never create a second issue, even if two arrive at the same moment.

**Non-Goals:**
- Idempotency for other tools (`update_issue`, `bulk_update_status` are naturally idempotent or out of scope).
- Expiring keys.
- Rejecting a replay whose fields differ from the first call. The first write wins, which is the usual idempotency-key contract.

## Decisions

### 1. Uniqueness enforced by the database, per project

`external_id TEXT` (nullable) plus `CREATE UNIQUE INDEX IF NOT EXISTS idx_issues_external_id ON issues(project_id, external_id)`. SQLite treats NULLs as distinct in a unique index, so issues without a key are unaffected. A partial index isn't needed.

*Alternative:* a global unique key. Rejected, because keys are only meaningful inside the project they were filed in.

### 2. Insert-or-skip, then read

```sql
INSERT INTO issues (...) VALUES (...) ON CONFLICT (project_id, external_id) DO NOTHING;
SELECT ... FROM issues WHERE project_id = ? AND external_id = ?;
```

The second statement runs only when a key was given. `meta.changes` (0 or 1) on the insert tells created from replayed. This is atomic against two concurrent retries, which a check-then-insert would not be.

*Alternative:* `SELECT` first, then `INSERT`. Rejected: two retries arriving together could both find nothing and both insert, and the unique index would then turn the second into an error instead of a replay.

### 3. Result shape

The tool keeps returning the issue as JSON, with an added top-level `"replayed": true | false`. Existing callers that read issue fields are unaffected.

### 4. Hosted databases: a one-off migration file

`migrations/0001_issue_external_id.sql` holds the `ALTER TABLE issues ADD COLUMN external_id TEXT` and the index. It runs once per hosted environment with `wrangler d1 execute DB --env <env> --remote --file=…`. `schema.sql` gains the same column and index, for fresh databases.

The `ALTER` isn't re-runnable, and the README says so. There are no real users, so if it's ever run twice, the error is harmless.

*Alternative:* drop and recreate the hosted databases. Rejected, because it would also wipe persona sessions and tokens.

### 5. Checkpoint tags

Before any code from this change lands, tag the current `main` as `lesson-13`: the server learners connect to in the MCP lesson. After this change, tag `lesson-16`. Both tags are pushed to the public remote (ai-web.dev `chatbot-build-along`, design §3).

## Risks / Trade-offs

- [The one-off migration is forgotten on an environment, so `create_issue` with a key fails there] → tasks run it on staging and production and verify the column exists; the README states it.
- [A replay with different fields silently returns the old issue] → intended (first write wins) and documented; `replayed: true` makes it visible.
- [Tagging `lesson-13` after this change lands loses the pre-change checkpoint] → tagging is task 1, before any code.

## Migration Plan

1. Tag `lesson-13` on current `main` and push the tag.
2. Ship the code and `schema.sql` change, then run the one-off migration on staging, verify, then production.
3. Tag `lesson-16` and push it.

Rollback: revert the code. The column and index can stay; nothing reads them once the code is reverted.
