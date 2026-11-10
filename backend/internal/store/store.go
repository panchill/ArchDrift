// Package store хранит спаны в PostgreSQL.
package store

import (
	"context"
	"embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/panchill/ArchDrift/backend/internal/model"
)

//go:embed migrations/001_spans.sql
var migrations embed.FS

// Store пишет пачки спанов. Повтор (trace_id, span_id) не затирает первую запись.
type Store struct {
	pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Store {
	return &Store{pool: pool}
}

// Migrate применяет SQL-миграции. Повторный вызов ничего не меняет.
func Migrate(ctx context.Context, pool *pgxpool.Pool) error {
	_, err := pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version integer PRIMARY KEY,
			applied_at timestamptz NOT NULL DEFAULT now()
		)`)
	if err != nil {
		return err
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(7040911)`); err != nil {
		return err
	}
	var applied bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = 1)`).Scan(&applied); err != nil {
		return err
	}
	if !applied {
		body, err := migrations.ReadFile("migrations/001_spans.sql")
		if err != nil {
			return err
		}
		if err := execSQL(ctx, tx, string(body)); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO schema_migrations(version) VALUES (1)`); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func execSQL(ctx context.Context, tx pgx.Tx, script string) error {
	for _, stmt := range strings.Split(script, ";") {
		stmt = strings.TrimSpace(stmt)
		if stmt == "" {
			continue
		}
		if _, err := tx.Exec(ctx, stmt); err != nil {
			return fmt.Errorf("миграция: %w", err)
		}
	}
	return nil
}

const insertSQL = `
INSERT INTO spans (
	trace_id, span_id, parent_span_id, service_name, name, kind,
	start_time, end_time, status, status_message,
	attributes, resource_attributes, links
) VALUES (
	$1, $2, $3, $4, $5, $6,
	$7, $8, $9, $10,
	$11::jsonb, $12::jsonb, $13::jsonb
) ON CONFLICT (trace_id, span_id) DO NOTHING`

// InsertSpans сохраняет пачку в одной транзакции. Пустая пачка — успех.
func (s *Store) InsertSpans(ctx context.Context, spans []model.Span) error {
	if len(spans) == 0 {
		return nil
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	batch := &pgx.Batch{}
	for _, sp := range spans {
		args, err := insertArgs(sp)
		if err != nil {
			return err
		}
		batch.Queue(insertSQL, args...)
	}
	results := tx.SendBatch(ctx, batch)
	for range spans {
		if _, err := results.Exec(); err != nil {
			results.Close()
			return err
		}
	}
	if err := results.Close(); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func insertArgs(sp model.Span) ([]any, error) {
	traceID, err := decodeID(sp.TraceID, 16)
	if err != nil {
		return nil, fmt.Errorf("trace_id: %w", err)
	}
	spanID, err := decodeID(sp.SpanID, 8)
	if err != nil {
		return nil, fmt.Errorf("span_id: %w", err)
	}
	var parent []byte
	if sp.ParentSpanID != "" {
		parent, err = decodeID(sp.ParentSpanID, 8)
		if err != nil {
			return nil, fmt.Errorf("parent_span_id: %w", err)
		}
	}
	attrs, err := json.Marshal(nonNilAttrs(sp.Attributes))
	if err != nil {
		return nil, err
	}
	resource, err := json.Marshal(nonNilAttrs(sp.ResourceAttributes))
	if err != nil {
		return nil, err
	}
	links := sp.Links
	if links == nil {
		links = []model.Link{}
	}
	rawLinks, err := json.Marshal(links)
	if err != nil {
		return nil, err
	}
	return []any{
		traceID, spanID, parent, sp.ServiceName, sp.Name, string(sp.Kind),
		sp.Start, sp.End, string(sp.Status), sp.StatusMessage,
		string(attrs), string(resource), string(rawLinks),
	}, nil
}

func nonNilAttrs(m map[string]model.Attr) map[string]model.Attr {
	if m == nil {
		return map[string]model.Attr{}
	}
	return m
}

func decodeID(id string, size int) ([]byte, error) {
	b, err := hex.DecodeString(id)
	if err != nil || len(b) != size {
		return nil, fmt.Errorf("%q", id)
	}
	return b, nil
}
