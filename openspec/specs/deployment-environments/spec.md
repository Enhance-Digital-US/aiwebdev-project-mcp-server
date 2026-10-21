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
