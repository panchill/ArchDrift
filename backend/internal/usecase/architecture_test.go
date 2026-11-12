package usecase

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"testing"

	"github.com/panchill/ArchDrift/backend/internal/architecture"
)

type architectureRepositoryStub struct {
	snapshot architecture.Snapshot
	err      error
	writes   int
	expected int64
	model    json.RawMessage
}

func (r *architectureRepositoryStub) GetArchitecture(context.Context) (architecture.Snapshot, error) {
	return r.snapshot, r.err
}

func (r *architectureRepositoryStub) PutArchitecture(
	_ context.Context,
	model json.RawMessage,
	expected int64,
) (architecture.Snapshot, error) {
	r.writes++
	r.expected = expected
	r.model = model
	return r.snapshot, r.err
}

func (r *architectureRepositoryStub) DeleteArchitecture(_ context.Context, expected int64) error {
	r.writes++
	r.expected = expected
	return r.err
}

func TestArchitectureReplaceValidatesBeforeWriting(t *testing.T) {
	validator, err := architecture.NewValidator()
	if err != nil {
		t.Fatal(err)
	}
	repository := &architectureRepositoryStub{snapshot: architecture.Snapshot{Version: 1}}
	service := NewArchitecture(repository, validator)
	_, err = service.Replace(t.Context(), json.RawMessage(`{}`))
	if _, ok := errors.AsType[*architecture.ValidationError](err); !ok {
		t.Fatalf("validation error identity lost: %v", err)
	}
	if repository.writes != 0 {
		t.Fatal("invalid architecture reached the repository")
	}
	raw, err := os.ReadFile("../../../examples/opentelemetry-demo.architecture.json")
	if err != nil {
		t.Fatal(err)
	}
	saved, err := service.Replace(t.Context(), raw)
	if err != nil {
		t.Fatal(err)
	}
	if saved.Version != 1 || repository.writes != 1 {
		t.Fatalf("unexpected write result: version=%d writes=%d", saved.Version, repository.writes)
	}
	if repository.expected != 0 || !bytes.Equal(repository.model, raw) {
		t.Fatal("expected revision or original document changed before atomic persistence")
	}
	for _, source := range []error{
		&architecture.VersionConflict{CurrentVersion: 2},
		architecture.ErrUnavailable,
	} {
		repository.err = source
		if _, err := service.Replace(t.Context(), raw); !errors.Is(err, source) {
			t.Fatalf("repository error identity lost: %v", err)
		}
	}
}

func TestArchitectureDeletePreservesErrors(t *testing.T) {
	validator, err := architecture.NewValidator()
	if err != nil {
		t.Fatal(err)
	}
	repository := &architectureRepositoryStub{}
	service := NewArchitecture(repository, validator)
	if err := service.Delete(t.Context(), 3); err != nil || repository.writes != 1 || repository.expected != 3 {
		t.Fatalf("delete: err=%v writes=%d version=%d", err, repository.writes, repository.expected)
	}
	for _, source := range []error{
		architecture.ErrNotConfigured,
		architecture.ErrUnavailable,
		&architecture.VersionConflict{CurrentVersion: 4},
	} {
		repository.err = source
		if err := service.Delete(t.Context(), 3); !errors.Is(err, source) {
			t.Fatalf("repository error identity lost: %v", err)
		}
	}
}

func TestArchitectureGetPreservesErrors(t *testing.T) {
	validator, err := architecture.NewValidator()
	if err != nil {
		t.Fatal(err)
	}
	for _, source := range []error{architecture.ErrNotConfigured, architecture.ErrUnavailable} {
		repository := &architectureRepositoryStub{err: source}
		service := NewArchitecture(repository, validator)
		if _, err := service.Get(t.Context()); !errors.Is(err, source) {
			t.Fatalf("repository error identity lost: %v", err)
		}
	}
}
