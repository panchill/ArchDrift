package usecase

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/panchill/ArchDrift/backend/internal/architecture"
)

// ArchitectureRepository replaces the current document only when expected
// matches its revision. Both the comparison and replacement must be atomic.
type ArchitectureRepository interface {
	GetArchitecture(ctx context.Context) (architecture.Snapshot, error)
	PutArchitecture(ctx context.Context, model json.RawMessage, expected int64) (architecture.Snapshot, error)
}

type Architecture struct {
	repository ArchitectureRepository
	validator  *architecture.Validator
}

func NewArchitecture(repository ArchitectureRepository, validator *architecture.Validator) *Architecture {
	return &Architecture{repository: repository, validator: validator}
}

func (a *Architecture) Get(ctx context.Context) (architecture.Snapshot, error) {
	snapshot, err := a.repository.GetArchitecture(ctx)
	if err != nil {
		return architecture.Snapshot{}, fmt.Errorf("get architecture: %w", err)
	}
	return snapshot, nil
}

func (a *Architecture) Replace(ctx context.Context, raw json.RawMessage) (architecture.Snapshot, error) {
	model, err := a.validator.Parse(raw)
	if err != nil {
		return architecture.Snapshot{}, fmt.Errorf("validate architecture: %w", err)
	}
	snapshot, err := a.repository.PutArchitecture(ctx, raw, model.Version)
	if err != nil {
		return architecture.Snapshot{}, fmt.Errorf("replace architecture: %w", err)
	}
	return snapshot, nil
}
