-- One-off migration for databases created before `issues.external_id` existed
-- (lesson-13 and earlier). Fresh databases get the same column and index from
-- schema.sql, so they must NOT run this.
--
-- Run it ONCE per database, before `pnpm db:migrate:<env>` and before deploying
-- code that writes external_id:
--   wrangler d1 execute DB --local --file=migrations/0001_issue_external_id.sql
--   wrangler d1 execute DB --env staging --remote --file=migrations/0001_issue_external_id.sql
--   wrangler d1 execute DB --env production --remote --file=migrations/0001_issue_external_id.sql
--
-- ALTER TABLE is not re-runnable: a second run fails with "duplicate column name".
-- This is not a `wrangler d1 migrations` migration; don't use `migrations apply` on it.

ALTER TABLE issues ADD COLUMN external_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_issues_external_id ON issues(project_id, external_id);
