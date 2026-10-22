# Spec Delta

## ADDED Requirements

### Requirement: Requests to the configured hostname are served
Each environment SHALL serve requests whose Host matches the host of its configured resource URL, and SHALL refuse requests for any other Host with `403`. This keeps DNS-rebinding protection locally and makes hosted environments reachable.

#### Scenario: Hosted hostname is accepted
- **WHEN** a request reaches the staging Worker with the staging workers.dev hostname
- **THEN** it is handled by the application rather than refused by Host validation

#### Scenario: Foreign hostname is refused
- **WHEN** a request arrives with a Host that does not match the configured resource URL
- **THEN** the response is `403`
