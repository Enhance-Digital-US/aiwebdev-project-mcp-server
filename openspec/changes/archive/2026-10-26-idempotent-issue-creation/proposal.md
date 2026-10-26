# Proposal

## Why

The course chatbot files bug reports through `create_issue` from a durable workflow (ai-web.dev lesson 16, Durable Workflows). Durable engines retry failed steps, so the same request can arrive more than once. Today each call creates a new issue, which teaches the opposite of what the lesson is about. The server needs a way for a caller to say "this is the same request as before".

## What Changes

- `create_issue` accepts an optional `external_id`: a key chosen by the caller.
- Within a project, a second `create_issue` with an `external_id` that already exists returns the existing issue unchanged instead of creating another. The result says it was a replay.
- Calls without `external_id` behave exactly as today.
- Existing hosted databases gain the new column through a one-off migration. `schema.sql` alone can't add a column to an existing table.
- The README's tool reference documents `external_id` and why retries need it.

## Capabilities

### New Capabilities
- `issue-tools`: behavior of the issue tools exposed over MCP, starting with idempotent creation through a caller-supplied key.

### Modified Capabilities
<!-- none: role enforcement ("Roles govern MCP operations" in mcp-authorization) is unchanged and applies to replays too -->

## Impact

- `schema.sql`: nullable `external_id` column, plus a unique index on `(project_id, external_id)`.
- `src/store.ts`, `src/tools/issues.ts`: the lookup-or-insert path.
- A new one-off migration file for staging and production databases.
- `README.md`: tool reference.
- Depends on `add-simulated-roles-oauth` being archived first, because its `mcp-authorization` and `demo-data` specs are the base this builds on.
- Course checkpoint tags: `lesson-13` marks the server *before* this change, and `lesson-16` marks it after (ai-web.dev change `chatbot-build-along`).
