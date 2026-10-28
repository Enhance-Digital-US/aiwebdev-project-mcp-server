# deployment-environments Specification

## Purpose

Defines the three environments the Issue Tracker MCP server runs in: development (local only), staging and production (hosted on Cloudflare). It also covers how they are kept isolated, and which test-only conveniences are allowed in each.

## Requirements

### Requirement: Three isolated environments
The system SHALL provide a development environment that runs only on a developer's machine, plus staging and production environments that run on Cloudflare. Each hosted environment SHALL have its own Worker, its own database and its own token-signing secret.

#### Scenario: Staging data is separate from production data
- **WHEN** a project is created through the staging server
- **THEN** that project does not exist in the production database

#### Scenario: A token signed for one hosted environment is rejected by the other
- **WHEN** a client presents a token issued by staging to the production server
- **THEN** the production server responds with `401`

### Requirement: Environment identification
Each environment SHALL declare its name (`development`, `staging` or `production`) to the running code, so environment-dependent behavior can be decided at runtime.

#### Scenario: Hosted environment reports its name
- **WHEN** the staging Worker handles a request
- **THEN** the code sees the environment name `staging`

### Requirement: Development configuration is never deployed
Deploying without explicitly naming a hosted environment SHALL fail rather than publish the development configuration.

#### Scenario: Bare deploy is refused
- **WHEN** a developer runs `pnpm deploy`
- **THEN** the command exits with an error that names `pnpm deploy:staging` and `pnpm deploy:production`

#### Scenario: Bare deploy through the tool directly does not publish
- **WHEN** a developer runs a deploy without selecting an environment
- **THEN** the deploy fails because the development database binding does not refer to a real database

### Requirement: Dev token endpoint is development-only
The test-fixture endpoint `POST /auth/dev-token` SHALL issue tokens only when the environment is `development`. In every other case, including a missing or unrecognised environment name, it SHALL respond `404`.

#### Scenario: Dev token issued locally
- **WHEN** a client posts `{"sub":"user-alice","scope":"admin"}` to `/auth/dev-token` in development
- **THEN** the response is `200` with an `access_token`

#### Scenario: Dev token endpoint hidden on hosted environments
- **WHEN** a client posts to `/auth/dev-token` on staging or production
- **THEN** the response is `404`

#### Scenario: Unknown environment fails closed
- **WHEN** the environment name is missing or not one of the three known names
- **THEN** `/auth/dev-token` responds `404`

### Requirement: Requests to the configured hostname are served
Each environment SHALL serve requests whose Host matches the host of its configured resource URL, and SHALL refuse requests for any other Host with `403`. This keeps DNS-rebinding protection locally and makes hosted environments reachable.

#### Scenario: Hosted hostname is accepted
- **WHEN** a request reaches the staging Worker with the staging custom hostname
- **THEN** it is handled by the application rather than refused by Host validation

#### Scenario: Foreign hostname is refused
- **WHEN** a request arrives with a Host that does not match the configured resource URL
- **THEN** the response is `403`

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
