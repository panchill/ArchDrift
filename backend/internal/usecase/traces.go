package usecase

import (
	"context"
	"fmt"

	"github.com/panchill/ArchDrift/backend/internal/model"
)

// SpanRepository atomically saves a batch, ignoring already stored trace/span IDs.
type SpanRepository interface {
	InsertSpans(ctx context.Context, spans []model.Span) error
}

type Traces struct {
	repository SpanRepository
}

func NewTraces(repository SpanRepository) *Traces {
	return &Traces{repository: repository}
}

// Ingest rejects invalid spans and keeps the first valid occurrence of each ID.
// Duplicates are ignored, not counted as rejected spans.
func (t *Traces) Ingest(ctx context.Context, spans []model.Span) (int, error) {
	var accepted []model.Span
	seen := make(map[[2]string]struct{})
	rejected := 0
	for _, span := range spans {
		if !span.Valid() {
			rejected++
			continue
		}
		key := [2]string{span.TraceID, span.SpanID}
		if _, duplicate := seen[key]; duplicate {
			continue
		}
		seen[key] = struct{}{}
		accepted = append(accepted, span)
	}
	if err := t.repository.InsertSpans(ctx, accepted); err != nil {
		return 0, fmt.Errorf("ingest traces: %w", err)
	}
	return rejected, nil
}
