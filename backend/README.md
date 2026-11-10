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

Implemented routes: `GET /healthz` (also HEAD), `POST /v1/traces`, and
`PUT` / `GET /api/v1/architecture`. OTLP is protobuf-only with a 4 MiB limit.

## Architecture

PUT accepts a CALM 1.2 JSON document with `Content-Type: application/json`.
Official vocabulary schemas are embedded from `internal/architecture/schemas/`;
validation never fetches schemas or external documents. The parser additionally
checks the ArchDrift profile, bindings, ownership and relationship references,
and exposes canonical nodes/selectors for analysis using the shared `nodeid` package.
The request body is limited to 16 MiB; invalid input returns 400 with field details.

Migration 2 adds one current architecture record, with no revision history.
The JSON document is preserved (including additional fields and exact numbers);
only `metadata.archdrift.version` changes. Whitespace/property order may change.
The initial PUT must contain revision 0 and saves revision 1. Further PUTs must
contain the current revision and save N+1. Unique insertion and conditional SQL
updates arbitrate concurrent writers; stale or replayed PUTs return 409 with
`currentVersion`. GET returns 404 before the first successful PUT.

From the repository root, against an empty local backend:

```sh
curl --fail-with-body -X PUT http://localhost:8081/api/v1/architecture \
  -H 'Content-Type: application/json' \
  --data-binary @examples/opentelemetry-demo.architecture.json
curl --fail-with-body http://localhost:8081/api/v1/architecture
```

To edit an existing model, GET the current `model`, edit it and PUT that document
with its current revision. Re-uploading the example's revision 0 returns 409.
After a conflict, read and merge the current model before retrying.

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

## Checks

```sh
go vet ./...
go test -race ./...
```

Set `TEST_DATABASE_URL` to a disposable PostgreSQL URL to also run architecture,
migration and Fx integration tests. Tests use isolated temporary schemas and check fresh migrations,
concurrent/repeated startup, advisory-lock cancellation, HTTP draining and startup
failure cleanup, concurrent architecture updates, JSON preservation and the
architecture HTTP scenario (including rejected updates). CI supplies PostgreSQL 18 and runs these tests.
Without that variable integration tests explicitly skip.

## Railway

The existing service uses root directory `backend`, `Dockerfile`, `/healthz` and
a 30-second healthcheck timeout. Those settings and the binary entrypoint are
unchanged. `DATABASE_URL` retains pgx TLS/connection-string handling, and `PORT`
is supported without adding an `ADDR` variable. Migrations are embedded, so the
non-root runtime image needs no source tree or migration command at startup.
`GIN_MODE=release` disables Gin debug output in the container.

Before merging, require passing backend, frontend and contract CI checks. Check
new deployment health and OTLP ingestion after rollout; redeploy the preceding
image if startup or ingestion fails. Local validation is not a production deploy.
