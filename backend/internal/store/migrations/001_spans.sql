-- Спаны для построения графа и GET /api/v1/traces/{traceId}.
-- Дедупликация: первая запись (trace_id, span_id) побеждает.
-- Предки и парный SERVER ищутся по trace_id во всех сохранённых данных,
-- опорные спаны отбираются по start_time в интервале [from, to).

CREATE TABLE IF NOT EXISTS spans (
    trace_id bytea NOT NULL,
    span_id bytea NOT NULL,
    parent_span_id bytea,
    service_name text NOT NULL,
    name text NOT NULL,
    kind text NOT NULL,
    start_time timestamptz NOT NULL,
    end_time timestamptz NOT NULL,
    status text NOT NULL,
    status_message text NOT NULL DEFAULT '',
    attributes jsonb NOT NULL,
    resource_attributes jsonb NOT NULL,
    links jsonb NOT NULL,
    PRIMARY KEY (trace_id, span_id)
);

CREATE INDEX IF NOT EXISTS spans_start_time_idx ON spans (start_time);
