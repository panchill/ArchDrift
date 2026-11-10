package store

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/panchill/ArchDrift/backend/internal/model"
)

type Store struct {
	pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Store {
	return &Store{pool: pool}
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
