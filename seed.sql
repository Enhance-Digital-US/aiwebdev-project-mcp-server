-- Demo data shared by every student. Resetting wipes everything students created
-- and restores this state. Used by the hourly cron (staging/production) and by
-- `pnpm db:reset:<env>`. One statement per `;` at end of line (see src/sql.ts).

DELETE FROM activity;
DELETE FROM comments;
DELETE FROM issues;
DELETE FROM members;
DELETE FROM projects;

INSERT INTO projects (id, name, description) VALUES
  ('proj-demo', 'Demo: Course Issue Tracker',
   'Shared demo project. Sign in as Alice (admin), Bob (member) or Carol (viewer) and compare what each can do. Resets every hour.');

INSERT INTO members (project_id, user_id, role) VALUES
  ('proj-demo', 'user-alice', 'admin'),
  ('proj-demo', 'user-bob', 'member'),
  ('proj-demo', 'user-carol', 'viewer');

INSERT INTO issues (id, project_id, title, description, status, priority, assignee_id, labels, created_at, updated_at) VALUES
  ('demo-issue-1', 'proj-demo', 'Token refresh fails after 7 days',
   'Clients get a 401 once the refresh token expires instead of being sent back to the login page.',
   'open', 'critical', 'user-bob', '["bug","auth"]', datetime('now', '-6 days'), datetime('now', '-1 days')),
  ('demo-issue-2', 'proj-demo', 'Add dark mode to the login page',
   'The persona login page ignores prefers-color-scheme.',
   'backlog', 'low', NULL, '["feature","ui"]', datetime('now', '-9 days'), datetime('now', '-9 days')),
  ('demo-issue-3', 'proj-demo', 'search_issues misses matches in descriptions',
   'Searching for "refresh" only matches titles.',
   'in_progress', 'high', 'user-bob', '["bug","search"]', datetime('now', '-5 days'), datetime('now', '-2 hours')),
  ('demo-issue-4', 'proj-demo', 'Document the 401 to login flow for students',
   'Walk through discovery, the login page and the token exchange step by step.',
   'review', 'medium', 'user-carol', '["docs","auth"]', datetime('now', '-4 days'), datetime('now', '-1 days')),
  ('demo-issue-5', 'proj-demo', 'Sprint report shows the wrong completion percentage',
   'Closed issues are counted twice.',
   'in_progress', 'medium', 'user-carol', '["bug","reports"]', datetime('now', '-3 days'), datetime('now', '-3 hours')),
  ('demo-issue-6', 'proj-demo', 'Board resource is slow with many issues',
   'tracker://projects/{projectId}/board loads every issue with no limit.',
   'open', 'low', NULL, '["performance"]', datetime('now', '-8 days'), datetime('now', '-8 days')),
  ('demo-issue-7', 'proj-demo', 'Viewer can see the delete button in the client',
   'The tool is listed for viewers even though the server refuses it. Expected behaviour: tools are listed, permissions are enforced on call.',
   'done', 'high', 'user-bob', '["bug","rbac"]', datetime('now', '-12 days'), datetime('now', '-2 days')),
  ('demo-issue-8', 'proj-demo', 'Add labels filter to search',
   'Duplicate of the search improvements epic.',
   'closed', 'low', NULL, '["feature","search"]', datetime('now', '-15 days'), datetime('now', '-10 days'));

INSERT INTO comments (id, issue_id, author_id, text, created_at) VALUES
  ('demo-comment-1', 'demo-issue-1', 'user-alice', 'Reproduced on staging. Bob, can you take this one?', datetime('now', '-5 days')),
  ('demo-comment-2', 'demo-issue-1', 'user-bob', 'On it. Looks like the client never retries the login after the refresh fails.', datetime('now', '-1 days')),
  ('demo-comment-3', 'demo-issue-4', 'user-carol', 'Draft is ready for review.', datetime('now', '-1 days'));

INSERT INTO activity (id, project_id, issue_id, user_id, action, details, created_at) VALUES
  ('demo-activity-1', 'proj-demo', 'demo-issue-7', 'user-bob', 'status_changed', '{"from":"review","to":"done"}', datetime('now', '-2 days')),
  ('demo-activity-2', 'proj-demo', 'demo-issue-4', 'user-carol', 'status_changed', '{"from":"in_progress","to":"review"}', datetime('now', '-1 days')),
  ('demo-activity-3', 'proj-demo', 'demo-issue-3', 'user-bob', 'assigned', '{"assignee_id":"user-bob"}', datetime('now', '-2 hours'));
