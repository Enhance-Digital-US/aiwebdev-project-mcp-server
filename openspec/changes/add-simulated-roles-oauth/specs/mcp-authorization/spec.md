# Spec Delta

## Purpose

Lets students sign in to the MCP server as one of three simulated personas through the standard MCP OAuth flow, so they can watch each role change what the server allows.

## ADDED Requirements

### Requirement: Simulated personas
The system SHALL recognise exactly three personas, and no other identities SHALL be able to sign in:
- `user-alice`, named Alice, with role `admin`
- `user-bob`, named Bob, with role `member`
- `user-carol`, named Carol, with role `viewer`

#### Scenario: Unknown persona cannot sign in
- **WHEN** a login is submitted for persona `user-mallory`
- **THEN** the login is refused with the message "Incorrect persona or password."

### Requirement: Persona passwords are secret, per-environment configuration
Each persona's password SHALL be configured separately in every environment and SHALL never appear in source control, configuration files, logs or responses. A persona whose password is not configured SHALL be unable to sign in.

#### Scenario: Unconfigured password blocks sign-in
- **WHEN** the member persona's password is not configured and a login is submitted for Bob with an empty password
- **THEN** the login is refused

#### Scenario: Wrong password is not echoed
- **WHEN** a login is submitted for Carol with an incorrect password
- **THEN** the response is `401`, shows "Incorrect persona or password.", and does not contain the submitted password

### Requirement: Authorization discovery
An unauthenticated request to the MCP endpoint SHALL receive a `401` whose challenge points to protected resource metadata. That metadata SHALL name the environment's configured resource URL and the server's own authorization server. The authorization server metadata SHALL advertise the scopes `admin`, `member` and `viewer`, and a client registration endpoint.

#### Scenario: Unauthenticated MCP request is challenged
- **WHEN** a client sends `POST /mcp` with no token
- **THEN** the response is `401` with a `WWW-Authenticate` header containing a `resource_metadata` URL ending in `/.well-known/oauth-protected-resource/mcp`

#### Scenario: Protected resource metadata names this server
- **WHEN** a client fetches `/.well-known/oauth-protected-resource/mcp`
- **THEN** `resource` equals the configured resource URL and `authorization_servers` contains only the server's own origin

#### Scenario: Authorization server metadata lists the roles
- **WHEN** a client fetches `/.well-known/oauth-authorization-server`
- **THEN** `scopes_supported` includes `admin`, `member` and `viewer`, and a `registration_endpoint` is present

### Requirement: Client registration
The authorization server SHALL accept MCP clients that identify themselves with a Client ID Metadata Document, and SHALL also accept Dynamic Client Registration.

#### Scenario: Dynamic registration
- **WHEN** a client posts a registration with a loopback redirect URI to the registration endpoint
- **THEN** it receives a `client_id`

### Requirement: Persona login and consent page
The authorization endpoint SHALL show a page where the student chooses a persona and enters its password, then allows or denies access. Data that came from the client SHALL be HTML-escaped. The page SHALL show:
- the requesting client's name, and whether that name is verified;
- the host the tokens will be sent to, with a warning when that host is on the user's own machine;
- every persona, with its role.

#### Scenario: Login page lists personas
- **WHEN** a registered client starts an authorization request
- **THEN** the page lists Alice (admin), Bob (member) and Carol (viewer) with a password field

#### Scenario: Client-supplied name is escaped
- **WHEN** a client registered with the name `<b>Test</b>` starts an authorization request
- **THEN** the page shows the name as text and contains no `<b>` element from it

#### Scenario: Denied consent
- **WHEN** the student chooses Deny
- **THEN** the browser is redirected to the client with `error=access_denied`

#### Scenario: Reused or expired form
- **WHEN** a login form that was already submitted, or has expired, is submitted again
- **THEN** the response is a `400` page offering to start again, and no redirect to the client is issued

### Requirement: Token role is fixed by the persona
After a successful login, the issued token SHALL carry exactly the persona's role as its only role scope, whatever scope the client requested.

#### Scenario: Escalation attempt is ignored
- **WHEN** a client requests scope `admin` and the student signs in as Carol
- **THEN** the issued token's scope is `viewer`

### Requirement: Token lifetimes
Access tokens SHALL expire one hour after issue. Refresh tokens SHALL be issued and SHALL stop working no later than seven days after the login that created them.

#### Scenario: Refresh token issued
- **WHEN** an authorization code is exchanged at the token endpoint
- **THEN** the response contains both an `access_token` and a `refresh_token`

### Requirement: Password change invalidates sessions
A token issued under a persona's previous password SHALL be rejected once that password changes.

#### Scenario: Rotated password logs out old sessions
- **WHEN** Carol's password is changed after a token was issued to her
- **THEN** the next MCP request with that token receives `401`

#### Scenario: Rotated password blocks refresh
- **WHEN** Carol's password is changed and her client presents her refresh token
- **THEN** the token endpoint responds `400` with `invalid_grant`, so the client must sign in again

### Requirement: Roles govern MCP operations
The role in the token SHALL determine what MCP operations are allowed:
- `viewer` SHALL be read-only;
- `member` SHALL be able to create and update issues and projects, but not delete projects;
- `admin` SHALL be able to delete projects.

A refused operation SHALL report `Forbidden`.

#### Scenario: Viewer can read but not write
- **WHEN** Carol searches issues and then calls `create_issue` on the demo project
- **THEN** the search returns demo issues and `create_issue` reports `Forbidden`

#### Scenario: Member can write but not delete
- **WHEN** Bob calls `create_issue` and then `delete_project` on the demo project
- **THEN** the issue is created and `delete_project` reports `Forbidden`

#### Scenario: Refusal comes before the confirmation prompt
- **WHEN** Bob calls `delete_project` on the demo project
- **THEN** he is told `Forbidden` straight away and is never asked to confirm the deletion

#### Scenario: Non-member is told the project does not exist
- **WHEN** a signed-in user who is not a member of the demo project calls `delete_project` on it
- **THEN** the result is "Project not found", not `Forbidden`

#### Scenario: Admin can delete after confirmation
- **WHEN** Alice calls `delete_project` on the demo project from a client that supports input requests and confirms
- **THEN** the project is deleted

### Requirement: Dev tokens accepted only in development
Tokens from the development token endpoint SHALL be accepted by the MCP endpoint only when the environment is `development`, alongside tokens from the persona login.

#### Scenario: Dev token works locally
- **WHEN** a development-signed token for Carol calls `tools/list` in development
- **THEN** the call succeeds

#### Scenario: Dev token rejected when hosted
- **WHEN** the same kind of token is presented on staging
- **THEN** the response is `401`
