package usecase

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"

	"github.com/panchill/ArchDrift/backend/internal/model"
)

type spanRepository struct {
	spans []model.Span
	ctx   context.Context
	err   error
}

func (r *spanRepository) InsertSpans(ctx context.Context, spans []model.Span) error {
	r.ctx, r.spans = ctx, spans
	return r.err
}

func TestIngestTraces(t *testing.T) {
	valid := model.Span{
		TraceID: "00000000000000000000000000000001", SpanID: "0000000000000001",
		ServiceName: "checkout", Start: time.Unix(1, 0), End: time.Unix(2, 0),
	}
	for _, tc := range []struct {
		name   string
		change func(*model.Span)
	}{
		{name: "zero trace", change: func(s *model.Span) { s.TraceID = "00000000000000000000000000000000" }},
		{name: "zero span", change: func(s *model.Span) { s.SpanID = "0000000000000000" }},
		{name: "empty id", change: func(s *model.Span) { s.TraceID = "" }},
		{name: "invalid id", change: func(s *model.Span) { s.SpanID = "invalid-span-id!!" }},
		{name: "missing service", change: func(s *model.Span) { s.ServiceName = " \t" }},
		{name: "end before start", change: func(s *model.Span) { s.End = s.Start.Add(-time.Second) }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			invalid, duplicate := valid, valid
			tc.change(&invalid)
			duplicate.Name = "duplicate"
			repository := &spanRepository{}
			input := []model.Span{invalid, valid, duplicate}
			before := append([]model.Span(nil), input...)
			rejected, err := NewTraces(repository).Ingest(t.Context(), input)
			if err != nil || rejected != 1 {
				t.Fatalf("rejected=%d error=%v", rejected, err)
			}
			if !reflect.DeepEqual(repository.spans, []model.Span{valid}) {
				t.Fatalf("saved spans: %+v", repository.spans)
			}
			if !reflect.DeepEqual(input, before) || repository.ctx != t.Context() {
				t.Fatal("input mutated or request context lost")
			}
		})
	}
}

func TestIngestTracesEmptyAndRepositoryError(t *testing.T) {
	repository := &spanRepository{}
	traces := NewTraces(repository)
	if rejected, err := traces.Ingest(t.Context(), nil); err != nil || rejected != 0 {
		t.Fatalf("empty batch: rejected=%d error=%v", rejected, err)
	}
	repository.err = context.Canceled
	if _, err := traces.Ingest(t.Context(), nil); !errors.Is(err, context.Canceled) {
		t.Fatalf("repository error identity lost: %v", err)
	}
}
