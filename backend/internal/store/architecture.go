package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strconv"

	"github.com/jackc/pgx/v5"

	"github.com/panchill/ArchDrift/backend/internal/architecture"
	"github.com/panchill/ArchDrift/backend/internal/usecase"
)

var _ usecase.ArchitectureRepository = (*Store)(nil)

func (s *Store) GetArchitecture(ctx context.Context) (architecture.Snapshot, error) {
	var a architecture.Snapshot
	const query = "SELECT version, updated_at, model FROM architecture WHERE singleton"
	if err := s.pool.QueryRow(ctx, query).Scan(&a.Version, &a.UpdatedAt, &a.Model); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return architecture.Snapshot{}, fmt.Errorf("get architecture: %w", architecture.ErrNotConfigured)
		}
		return architecture.Snapshot{}, fmt.Errorf("get architecture: %w: %w", architecture.ErrUnavailable, err)
	}
	return a, nil
}

// PutArchitecture requires a validated CALM document. The unique singleton key
// arbitrates first creation; conditional UPDATE arbitrates later revisions.
// JSON (rather than JSONB) also retains JSON numbers outside PostgreSQL numeric's
// range and escaped NUL characters in descriptive fields. Only revision changes.
func (s *Store) PutArchitecture(
	ctx context.Context,
	model json.RawMessage,
	expected int64,
) (architecture.Snapshot, error) {
	if expected < 0 {
		return architecture.Snapshot{}, errors.New("negative revision")
	}
	next := expected
	if next < math.MaxInt64 {
		next++
	}
	// If the counter is exhausted, UPDATE's bigint increment fails atomically.
	// A stale MaxInt64 expectation must still produce a normal version conflict.
	model, err := withVersion(model, next)
	if err != nil {
		return architecture.Snapshot{}, fmt.Errorf("set architecture revision: %w", err)
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
	var a architecture.Snapshot
	err = s.pool.QueryRow(ctx, query, args...).Scan(&a.Version, &a.UpdatedAt, &a.Model)
	if err == nil {
		return a, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return architecture.Snapshot{}, fmt.Errorf("save architecture: %w: %w", architecture.ErrUnavailable, err)
	}
	var current int64
	const currentVersionQuery = "SELECT COALESCE((SELECT version FROM architecture WHERE singleton), 0)"
	if err := s.pool.QueryRow(ctx, currentVersionQuery).Scan(&current); err != nil {
		return architecture.Snapshot{}, fmt.Errorf(
			"get current architecture revision: %w: %w", architecture.ErrUnavailable, err,
		)
	}
	return architecture.Snapshot{}, &architecture.VersionConflict{CurrentVersion: current}
}

// DeleteArchitecture removes the model only. Spans stay, so the next upload
// can be compared with traffic that was already collected.
func (s *Store) DeleteArchitecture(ctx context.Context, version int64) error {
	if version < 1 {
		return errors.New("invalid architecture revision")
	}
	tag, err := s.pool.Exec(ctx, "DELETE FROM architecture WHERE singleton AND version = $1", version)
	if err != nil {
		return fmt.Errorf("delete architecture: %w: %w", architecture.ErrUnavailable, err)
	}
	if tag.RowsAffected() == 1 {
		return nil
	}
	var current int64
	const currentVersionQuery = "SELECT COALESCE((SELECT version FROM architecture WHERE singleton), 0)"
	if err := s.pool.QueryRow(ctx, currentVersionQuery).Scan(&current); err != nil {
		return fmt.Errorf("get current architecture revision: %w: %w", architecture.ErrUnavailable, err)
	}
	if current == 0 {
		return fmt.Errorf("delete architecture: %w", architecture.ErrNotConfigured)
	}
	return &architecture.VersionConflict{CurrentVersion: current}
}

func withVersion(raw json.RawMessage, version int64) (json.RawMessage, error) {
	doc := map[string]json.RawMessage{}
	metadata := map[string]json.RawMessage{}
	binding := map[string]json.RawMessage{}
	if err := json.Unmarshal(raw, &doc); err != nil {
		return nil, fmt.Errorf("decode architecture: %w", err)
	}
	if err := json.Unmarshal(doc["metadata"], &metadata); err != nil {
		return nil, fmt.Errorf("decode architecture metadata: %w", err)
	}
	if err := json.Unmarshal(metadata["archdrift"], &binding); err != nil {
		return nil, fmt.Errorf("decode architecture revision binding: %w", err)
	}
	if binding == nil {
		return nil, errors.New("missing architecture revision binding")
	}
	binding["version"] = json.RawMessage(strconv.FormatInt(version, 10))
	var err error
	metadata["archdrift"], err = json.Marshal(binding)
	if err != nil {
		return nil, fmt.Errorf("encode architecture revision binding: %w", err)
	}
	doc["metadata"], err = json.Marshal(metadata)
	if err != nil {
		return nil, fmt.Errorf("encode architecture metadata: %w", err)
	}
	model, err := json.Marshal(doc)
	if err != nil {
		return nil, fmt.Errorf("encode architecture: %w", err)
	}
	return model, nil
}
