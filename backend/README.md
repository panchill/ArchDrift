# Backend

Go + Gin, pgx, goose and Uber Fx. The HTTP contract stays in `api/api.yaml`.

## Run and configuration

Run `go run ./cmd/archdrift` with `DATABASE_URL` set. Address selection:

1. Explicit `ADDR`, when set (existing Compose behavior).
2. Otherwise `0.0.0.0`/all interfaces on `PORT` (Railway).
3. Otherwise port 8080.

Fx applies migrations before opening the HTTP listener. On SIGTERM/SIGINT it
stops accepting requests, drains active requests, then closes the database pool.
Startup has a 30-second budget; shutdown uses Fx's 15-second budget.

The implemented routes remain `GET /healthz` (also HEAD) and `POST /v1/traces`.
OTLP stays protobuf-only with the existing 4 MiB limit and partial-success/error
responses. This refactor does not implement the remaining API endpoints.

## Migrations

SQL lives in `migrations/`, uses goose Up/Down annotations and is embedded in the
binary. No working-directory assumption, runtime SQL files or separate migration
CLI is required. Add new numbered migrations; do not modify an applied migration.

Migration 1 preserves the original idempotent table/index DDL. On an existing
installation it leaves spans and `schema_migrations` intact and initializes
`goose_db_version`. Both the old runner and goose use advisory lock `7040911`, so
old/new starts serialize during an upgrade. Fresh installations use goose history.

For deployment rollback, redeploy the previous binary/image. Its migration is
idempotent and remains compatible with the schema. Do **not** run goose Down as a
release rollback: migration 1 Down intentionally drops the spans table.

## OpenAPI types

```sh
go generate ./internal/api
```

The generator version is pinned in `go.mod` as a Go tool. Commit
`internal/api/types.gen.go`; CI checks regeneration produces no diff. Configuration
generates models only, including unreferenced schemas: no client, server bindings,
routing or embedded OpenAPI document. `Health` is used by the Gin handler. Graph
observation types remain internal: API graph types also require declaration and
matching fields that the observation builder does not compute.

## Checks

```sh
go vet ./...
go test -race ./...
```

Set `TEST_DATABASE_URL` to a disposable PostgreSQL URL to also run migration and
Fx integration tests. Tests use isolated temporary schemas, check the old schema
upgrade, concurrent/repeated startup, advisory-lock cancellation, HTTP draining
and startup failure cleanup. CI supplies PostgreSQL 18 and runs these tests.
Without that variable integration tests explicitly skip.

## Railway

The existing service uses root directory `backend`, `Dockerfile`, `/healthz` and
a 30-second healthcheck timeout. Those settings and the binary entrypoint are
unchanged. `DATABASE_URL` retains pgx TLS/connection-string handling, and `PORT`
is supported without adding an `ADDR` variable. Generated code is committed and
migrations are embedded, so the non-root runtime image needs no source tree or
code-generation/migration command at startup.

Before merging, require passing backend, frontend and contract CI checks. Check
new deployment health and OTLP ingestion after rollout; redeploy the preceding
image if startup or ingestion fails. Local validation is not a production deploy.
