package store

import (
	"encoding/json"
	"errors"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/panchill/ArchDrift/backend/internal/testdb"
	"github.com/panchill/ArchDrift/backend/migrations"
)

func TestArchitecturePersistenceAndConcurrentWrites(t *testing.T) {
	_, pool := testdb.New(t)
	if err := migrations.Up(t.Context(), pool); err != nil {
		t.Fatal(err)
	}
	s := New(pool)
	if _, err := s.GetArchitecture(t.Context()); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("empty model: %v", err)
	}
	raw := json.RawMessage(`{"metadata":{"archdrift":{"version":0},"extra":{"number":9007199254740993}},"custom":[true,"unchanged"],"nul":"\u0000","huge":1e131072}`)
	if _, err := s.PutArchitecture(t.Context(), raw, 7); err == nil {
		t.Fatal("created with nonzero revision")
	}
	for expected := int64(0); expected < 2; expected++ {
		var wg sync.WaitGroup
		type outcome struct {
			a   Architecture
			err error
		}
		results := make(chan outcome, 2)
		for range 2 {
			wg.Go(func() { a, err := s.PutArchitecture(t.Context(), raw, expected); results <- outcome{a, err} })
		}
		wg.Wait()
		close(results)
		success, conflict := 0, 0
		var saved Architecture
		for r := range results {
			var vc *VersionConflict
			switch {
			case r.err == nil:
				success++
				saved = r.a
			case errors.As(r.err, &vc):
				conflict++
				if vc.CurrentVersion != expected+1 {
					t.Fatalf("current version: %d", vc.CurrentVersion)
				}
			default:
				t.Fatal(r.err)
			}
		}
		if success != 1 || conflict != 1 {
			t.Fatalf("success=%d conflict=%d", success, conflict)
		}
		// A new Store reads persisted state; no process-local model cache exists.
		got, err := New(pool).GetArchitecture(t.Context())
		if err != nil {
			t.Fatal(err)
		}
		if got.Version != expected+1 || !got.UpdatedAt.Equal(saved.UpdatedAt) {
			t.Fatalf("incorrect persisted revision: %+v", got)
		}
		var doc struct {
			Nul      string
			Huge     json.Number
			Metadata struct {
				Archdrift struct{ Version int64 }
				Extra     struct{ Number json.Number }
			}
			Custom []any
		}
		if err := json.Unmarshal(got.Model, &doc); err != nil {
			t.Fatal(err)
		}
		if doc.Metadata.Archdrift.Version != got.Version || doc.Metadata.Extra.Number != "9007199254740993" || len(doc.Custom) != 2 || doc.Nul != "\x00" || doc.Huge != "1e131072" {
			t.Fatalf("model lost fields: %s", got.Model)
		}
		if _, err := s.PutArchitecture(t.Context(), raw, expected); err == nil {
			t.Fatal("replay accepted")
		}
		after, err := s.GetArchitecture(t.Context())
		if err != nil || !after.UpdatedAt.Equal(got.UpdatedAt) || string(after.Model) != string(got.Model) {
			t.Fatal("conflict changed model")
		}
	}
}
