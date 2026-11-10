package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/panchill/ArchDrift/backend/internal/architecture"
	"github.com/panchill/ArchDrift/backend/internal/model"
	"github.com/panchill/ArchDrift/backend/internal/usecase"
)

var _ usecase.AnalysisRepository = (*Store)(nil)

func (s *Store) GetAnalysisInput(
	ctx context.Context,
	from, to time.Time,
) (architecture.Snapshot, []model.Span, error) {
	failure := func(err error) (architecture.Snapshot, []model.Span, error) {
		return architecture.Snapshot{}, nil, fmt.Errorf("read analysis snapshot: %w: %w", architecture.ErrUnavailable, err)
	}
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return failure(err)
	}
	defer tx.Rollback(ctx)
	var snapshot architecture.Snapshot
	err = tx.QueryRow(ctx, "SELECT version, updated_at, model FROM architecture WHERE singleton").
		Scan(&snapshot.Version, &snapshot.UpdatedAt, &snapshot.Model)
	if errors.Is(err, pgx.ErrNoRows) {
		return architecture.Snapshot{}, nil, architecture.ErrNotConfigured
	}
	if err != nil {
		return failure(err)
	}
	// The interval selects traces, not context spans: an ancestor or paired
	// SERVER may start outside the interval. Build applies the anchor filter.
	// PostgreSQL timestamps have microsecond precision. Widen the SQL bounds
	// so pgx truncation cannot drop a trace before Build checks nanoseconds.
	queryFrom, queryTo := from.Truncate(time.Microsecond), to.Truncate(time.Microsecond)
	if queryTo.Before(to) {
		queryTo = queryTo.Add(time.Microsecond)
	}
	rows, err := tx.Query(
		ctx,
		`SELECT encode(trace_id, 'hex'), encode(span_id, 'hex'),
		COALESCE(encode(parent_span_id, 'hex'), ''), service_name, kind,
		start_time, end_time, status, attributes
		FROM spans WHERE trace_id IN (
			SELECT trace_id FROM spans WHERE start_time >= $1 AND start_time < $2
		)`,
		queryFrom,
		queryTo,
	)
	if err != nil {
		return failure(err)
	}
	defer rows.Close()
	spans := []model.Span{}
	for rows.Next() {
		var sp model.Span
		if err := rows.Scan(
			&sp.TraceID,
			&sp.SpanID,
			&sp.ParentSpanID,
			&sp.ServiceName,
			&sp.Kind,
			&sp.Start,
			&sp.End,
			&sp.Status,
			&sp.Attributes,
		); err != nil {
			return failure(err)
		}
		spans = append(spans, sp)
	}
	if err := rows.Err(); err != nil {
		return failure(err)
	}
	if err := tx.Commit(ctx); err != nil {
		return failure(err)
	}
	return snapshot, spans, nil
}
