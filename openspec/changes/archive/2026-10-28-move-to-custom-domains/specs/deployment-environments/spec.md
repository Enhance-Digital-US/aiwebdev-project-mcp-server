# Spec Delta

## MODIFIED Requirements

### Requirement: Requests to the configured hostname are served
Each environment SHALL serve requests whose Host matches the host of its configured resource URL, and SHALL refuse requests for any other Host with `403`. This keeps DNS-rebinding protection locally and makes hosted environments reachable.

#### Scenario: Hosted hostname is accepted
- **WHEN** a request reaches the staging Worker with the staging custom hostname
- **THEN** it is handled by the application rather than refused by Host validation

#### Scenario: Foreign hostname is refused
- **WHEN** a request arrives with a Host that does not match the configured resource URL
- **THEN** the response is `403`

## ADDED Requirements

### Requirement: Hosted environments are served on their custom hostname
Staging SHALL be served only at `staging.issue-tracker.course-projects.ai-web.dev` and production only at `issue-tracker.course-projects.ai-web.dev`, both over HTTPS. Each environment's resource URL SHALL be its hostname followed by `/mcp`, and its authorization server URL SHALL be its hostname. Neither hosted Worker SHALL be reachable on a `workers.dev` hostname.

#### Scenario: Production advertises its custom hostname
- **WHEN** a client fetches `https://issue-tracker.course-projects.ai-web.dev/.well-known/oauth-protected-resource/mcp`
- **THEN** the response names `https://issue-tracker.course-projects.ai-web.dev/mcp` as the resource and `https://issue-tracker.course-projects.ai-web.dev` as the authorization server

#### Scenario: Staging advertises its custom hostname
- **WHEN** a client fetches `https://staging.issue-tracker.course-projects.ai-web.dev/.well-known/oauth-protected-resource/mcp`
- **THEN** the response names `https://staging.issue-tracker.course-projects.ai-web.dev/mcp` as the resource and `https://staging.issue-tracker.course-projects.ai-web.dev` as the authorization server

#### Scenario: Unauthenticated MCP request is challenged on the custom hostname
- **WHEN** a client posts to `/mcp` on either custom hostname without a token
- **THEN** the response is `401` with a `WWW-Authenticate` header pointing at that hostname's protected resource metadata

#### Scenario: workers.dev hostname is not served
- **WHEN** a client requests `issue-tracker-mcp-production.enhancedigital.workers.dev` or `issue-tracker-mcp-staging.enhancedigital.workers.dev`
- **THEN** the Worker does not handle the request

#### Scenario: Tokens from the old hostname are not accepted
- **WHEN** a client presents an access token issued before the move, for the old workers.dev resource URL
- **THEN** the server responds `401`, and the client must sign in again through the persona login
