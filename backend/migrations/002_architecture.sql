-- +goose Up
CREATE TABLE architecture (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    version bigint NOT NULL CHECK (version >= 1),
    updated_at timestamptz NOT NULL,
    model json NOT NULL CHECK (json_typeof(model) = 'object')
);

-- +goose Down
DROP TABLE architecture;
