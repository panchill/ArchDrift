# CALM 1.2 schemas

Unmodified official schemas from https://calm.finos.org/release/1.2/meta/:
`core.json`, `interface.json`, `control.json`, `flow.json` (FINOS CALM).

Copied from `frontend/tests/schemas/` and embedded in the backend binary.
`core.json` validates CALM vocabulary; ArchDrift-specific bindings and cross
references are checked separately. The schema loader has no network or filesystem
access; uploaded `$schema`/external document URLs are never fetched.
