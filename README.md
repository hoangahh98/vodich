# Vodich Java

Vodich is a Spring Boot modular monolith for tournament management, team monthly funds, external registration, and realtime livescore.

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
- Render deploy with Docker

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

## Permissions

- Root admin is configured by `APP_ADMIN_USERNAME`.
- Root admin sees every menu and the permission screen.
- Secondary admins only see modules granted in `admin_feature_permission`.
- Player accounts are read-only and only see tournaments attached to their email.
- Manually created players are unique by email.
- External tournament registration is stored in `tournament_registration`, not in the shared player table.
