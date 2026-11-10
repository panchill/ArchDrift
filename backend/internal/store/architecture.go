package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
)

type Architecture struct {
	Version   int64           `json:"version"`
	UpdatedAt time.Time       `json:"updatedAt"`
	Model     json.RawMessage `json:"model"`
}

type VersionConflict struct{ CurrentVersion int64 }

func (*VersionConflict) Error() string { return "architecture version conflict" }

func (s *Store) GetArchitecture(ctx context.Context) (Architecture, error) {
	var a Architecture
	err := s.pool.QueryRow(ctx, "SELECT version, updated_at, model FROM architecture WHERE singleton").Scan(&a.Version, &a.UpdatedAt, &a.Model)
	return a, err
}

// PutArchitecture requires a validated CALM document. The unique singleton key
// arbitrates first creation; conditional UPDATE arbitrates later revisions.
// JSON (rather than JSONB) also retains JSON numbers outside PostgreSQL numeric's
// range and escaped NUL characters in descriptive fields. Only revision changes.
func (s *Store) PutArchitecture(ctx context.Context, model json.RawMessage, expected int64) (Architecture, error) {
	if expected < 0 {
		return Architecture{}, fmt.Errorf("negative revision")
	}
	next := expected
	if next < math.MaxInt64 {
		next++
	}
	// If the counter is exhausted, UPDATE's bigint increment fails atomically.
	// A stale MaxInt64 expectation must still produce a normal version conflict.
	model, err := withVersion(model, next)
	if err != nil {
		return Architecture{}, err
	}
	query := `UPDATE architecture
		SET model = $1::json,
		    version = version + 1, updated_at = clock_timestamp()
		WHERE singleton AND version = $2
		RETURNING version, updated_at, model`
	args := []any{model, expected}
	if expected == 0 {
		query = `INSERT INTO architecture (singleton, version, updated_at, model)
			VALUES (true, 1, clock_timestamp(), $1::json)
			ON CONFLICT (singleton) DO NOTHING RETURNING version, updated_at, model`
		args = args[:1]
	}
	var a Architecture
	err = s.pool.QueryRow(ctx, query, args...).Scan(&a.Version, &a.UpdatedAt, &a.Model)
	if !errors.Is(err, pgx.ErrNoRows) {
		return a, err
	}
	var current int64
	if err := s.pool.QueryRow(ctx, "SELECT COALESCE((SELECT version FROM architecture WHERE singleton), 0)").Scan(&current); err != nil {
		return Architecture{}, err
	}
	return Architecture{}, &VersionConflict{CurrentVersion: current}
}

func withVersion(raw json.RawMessage, version int64) (json.RawMessage, error) {
	var doc, metadata, binding map[string]json.RawMessage
	if err := json.Unmarshal(raw, &doc); err != nil {
		return nil, err
	}
	if err := json.Unmarshal(doc["metadata"], &metadata); err != nil {
		return nil, err
	}
	if err := json.Unmarshal(metadata["archdrift"], &binding); err != nil {
		return nil, err
	}
	if binding == nil {
		return nil, fmt.Errorf("missing architecture revision binding")
	}
	binding["version"] = json.RawMessage(strconv.FormatInt(version, 10))
	var err error
	metadata["archdrift"], err = json.Marshal(binding)
	if err != nil {
		return nil, err
	}
	doc["metadata"], err = json.Marshal(metadata)
	if err != nil {
		return nil, err
	}
	return json.Marshal(doc)
}
