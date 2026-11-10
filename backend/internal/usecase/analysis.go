package usecase

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/panchill/ArchDrift/backend/internal/analysis"
	"github.com/panchill/ArchDrift/backend/internal/architecture"
	"github.com/panchill/ArchDrift/backend/internal/graph"
	"github.com/panchill/ArchDrift/backend/internal/model"
)

var ErrInvalidInterval = errors.New("expected from < to and an interval of at most 24 hours")

// AnalysisRepository returns one consistent snapshot, including related spans
// outside the interval for traces with observations inside it.
type AnalysisRepository interface {
	GetAnalysisInput(context.Context, time.Time, time.Time) (architecture.Snapshot, []model.Span, error)
}

type Analysis struct {
	repository AnalysisRepository
	validator  *architecture.Validator
}

func NewAnalysis(repository AnalysisRepository, validator *architecture.Validator) *Analysis {
	return &Analysis{repository: repository, validator: validator}
}

func (a *Analysis) Get(ctx context.Context, from, to time.Time) (analysis.Result, error) {
	if !from.Before(to) || to.Sub(from) > 24*time.Hour {
		return analysis.Result{}, ErrInvalidInterval
	}
	snapshot, spans, err := a.repository.GetAnalysisInput(ctx, from, to)
	if err != nil {
		return analysis.Result{}, fmt.Errorf("read analysis input: %w", err)
	}
	declared, err := a.validator.Parse(snapshot.Model)
	if err != nil {
		return analysis.Result{}, fmt.Errorf("parse stored architecture: %w", err)
	}
	result := analysis.Compare(declared, graph.Build(spans, from, to))
	if err := ctx.Err(); err != nil {
		return analysis.Result{}, err
	}
	result.From, result.To, result.GeneratedAt = from, to, time.Now().UTC()
	return result, nil
}
