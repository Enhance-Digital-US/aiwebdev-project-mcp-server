# issue-tools Specification

## Purpose

Defines how the issue tools exposed over MCP behave for callers, starting with safe retries of issue creation through a caller-supplied key.

## Requirements

### Requirement: Idempotent issue creation
`create_issue` SHALL accept an optional `external_id` string. When an issue with the same `external_id` already exists in the same project, the call SHALL return that existing issue unchanged and SHALL NOT create another.

#### Scenario: Retried create returns the first issue
- **WHEN** a member calls `create_issue` twice in project `proj-demo` with `external_id` `wf-123`
- **THEN** both calls return the same issue id, and the project contains exactly one issue with that `external_id`

#### Scenario: Replay ignores changed fields
- **WHEN** the second call with `external_id` `wf-123` sends a different title
- **THEN** the returned issue keeps the title from the first call

#### Scenario: Same key in another project
- **WHEN** `create_issue` uses `external_id` `wf-123` in a different project
- **THEN** a new issue is created in that project

#### Scenario: No key, no deduplication
- **WHEN** `create_issue` is called twice without `external_id`
- **THEN** two issues are created, exactly as before this change

### Requirement: Replays are identifiable
The result of `create_issue` SHALL state whether the issue was newly created or returned from an earlier call with the same `external_id`.

#### Scenario: First call
- **WHEN** a call creates a new issue
- **THEN** the result marks it as created

#### Scenario: Replayed call
- **WHEN** a call returns an existing issue because of its `external_id`
- **THEN** the result marks it as a replay

### Requirement: Replays follow the same role rules
A replayed `create_issue` SHALL be authorized exactly like a new one. A caller whose role may not create issues SHALL be refused even if an issue with that `external_id` exists.

#### Scenario: Viewer replays a key
- **WHEN** a `viewer` calls `create_issue` with an `external_id` that a member already used
- **THEN** the call is refused and the existing issue is not returned

### Requirement: External ids are readable
Issues returned by the issue tools and resources SHALL include their `external_id` (or null), so a caller can match an issue back to the request that created it.

#### Scenario: Issue detail
- **WHEN** a caller reads an issue created with `external_id` `wf-123`
- **THEN** the issue's data includes `external_id` `wf-123`
