# demo-data Specification

## Purpose

Provides a shared demo project that all three personas belong to. Students can compare roles on the same data, and the data recovers on its own after students change or delete it.

## Requirements

### Requirement: Seeded demo project
After a reset, the database SHALL contain exactly one project, with ID `proj-demo`. All three personas SHALL be members of it, each with their role. It SHALL hold eight issues that together cover every status and every priority, plus some comments and activity.

#### Scenario: Demo project contents after reset
- **WHEN** the demo data is reset
- **THEN** `proj-demo` has members `user-alice` (admin), `user-bob` (member) and `user-carol` (viewer), and 8 issues covering all six statuses and all four priorities

### Requirement: Reset restores the demo state
A reset SHALL remove all projects, issues, comments, members and activity, including anything students created, and then restore the seeded demo state. A reset SHALL be repeatable with the same result and SHALL NOT sign anyone out.

#### Scenario: Student-created data is swept away
- **WHEN** a student has created a project and the demo data is reset
- **THEN** only `proj-demo` remains

#### Scenario: Reset is repeatable
- **WHEN** the demo data is reset twice in a row
- **THEN** the project, member and issue counts are the same after each reset

#### Scenario: Sessions survive a reset
- **WHEN** the demo data is reset while Carol is signed in
- **THEN** Carol's existing token still works

### Requirement: Scheduled reset on hosted environments
Staging and production SHALL reset the demo data automatically every hour, on the hour. Development SHALL NOT reset on a schedule.

#### Scenario: Deleted demo project comes back
- **WHEN** Alice deletes `proj-demo` on staging
- **THEN** `proj-demo` exists again after the next hourly reset

### Requirement: On-demand reset
Each environment SHALL offer a command that resets its demo data immediately: `pnpm db:reset:local`, `pnpm db:reset:staging` and `pnpm db:reset:production`.

#### Scenario: Manual local reset
- **WHEN** a developer runs `pnpm db:reset:local` after applying the schema
- **THEN** the local database contains the seeded demo project
