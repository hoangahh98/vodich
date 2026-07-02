# Duhy Java

Duhy is now a Spring Boot modular monolith for tournament management, team monthly funds, external registration, and realtime livescore.

Removed from the old Flask app:

- Entertainment scorekeeper
- To lieng
- Ba cay

## Stack

- Java 21
- Spring Boot 3
- Thymeleaf
- Spring WebSocket + STOMP for realtime livescore
- Spring Data JPA
- Flyway migrations
- Supabase Postgres
- Render deploy

## Local Run

```bash
mvn spring-boot:run
```

Required environment:

```bash
DATABASE_URL=postgresql://user:password@host:5432/postgres?sslmode=require
APP_ADMIN_USERNAME=admin
APP_ADMIN_PASSWORD=123456789
```

The app converts Render/Supabase `DATABASE_URL` into Spring's JDBC datasource settings automatically.

## Architecture

```text
controller/view layer -> application service -> domain entity -> repository
                                  |
                                  +-> domain event -> websocket broadcast
```

The project is intentionally split by domain:

- `auth`: session login
- `player`: manually managed players
- `tournament`: tournaments, registrations, fees
- `match`: schedule, score rules, realtime scoring
- `team`: teams and monthly fee tracking
- `shared`: formatting, errors, base web helpers

## Realtime

Clients subscribe to:

```text
/topic/tournaments/{tournamentId}/matches
```

Score updates are accepted at:

```text
/app/tournaments/{tournamentId}/matches/{matchId}/score
```

The server saves the score to Postgres, applies domain score rules, and broadcasts a snapshot to every subscribed client.

## UI Rules

- Every submit/action button uses a loading state on tap/click.
- Numeric inputs are comma-formatted in the browser.
- Tournament detail is split into bottom-menu sections: players, fund, ranking, schedule, fees, settings.

## Redis Later

The current version supports one Render instance. When scaling to multiple instances, add Render Key Value/Redis and bridge score events through Pub/Sub so every instance can broadcast to its own connected WebSocket clients.

## Permissions

- Root admin is configured by `APP_ADMIN_USERNAME`.
- Root admin sees every menu and the permission screen.
- Secondary admins only see modules granted in `admin_feature_permission`.
- Player accounts are read-only and only see tournaments attached to their email.
- Manually created players are unique by email.
- External tournament registration is stored in `tournament_registration`, not in the shared player table, so the same email can be used both as an existing player and as an external registration for a specific tournament.
