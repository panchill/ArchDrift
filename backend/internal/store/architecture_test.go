package store

import (
	"encoding/json"
	"errors"
	"sync"
	"testing"

	"github.com/panchill/ArchDrift/backend/internal/architecture"
	"github.com/panchill/ArchDrift/backend/internal/testdb"
	"github.com/panchill/ArchDrift/backend/migrations"
)

func TestArchitecturePersistenceAndConcurrentWrites(t *testing.T) {
	_, pool := testdb.New(t)
	if err := migrations.Up(t.Context(), pool); err != nil {
		t.Fatal(err)
	}
	s := New(pool)
	if _, err := s.GetArchitecture(t.Context()); !errors.Is(err, architecture.ErrNotConfigured) {
		t.Fatalf("empty model: %v", err)
	}
	raw := json.RawMessage(`{"metadata":{"archdrift":{"version":0},"extra":{"number":9007199254740993}},"custom":[true,"unchanged"],"nul":"\u0000","huge":1e131072}`)
	if _, err := s.PutArchitecture(t.Context(), raw, 7); err == nil {
		t.Fatal("created with nonzero revision")
	}
	for expected := range int64(2) {
		var wg sync.WaitGroup
		type outcome struct {
			a   architecture.Snapshot
			err error
		}
		results := make(chan outcome, 2)
		for range 2 {
			wg.Go(func() {
				a, err := s.PutArchitecture(t.Context(), raw, expected)
				results <- outcome{a: a, err: err}
			})
		}
		wg.Wait()
		close(results)
		success, conflict := 0, 0
		var saved architecture.Snapshot
		for r := range results {
			vc, isConflict := errors.AsType[*architecture.VersionConflict](r.err)
			switch {
			case r.err == nil:
				success++
				saved = r.a
			case isConflict:
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

func TestDeleteArchitectureKeepsSpans(t *testing.T) {
	_, pool := testdb.New(t)
	if err := migrations.Up(t.Context(), pool); err != nil {
		t.Fatal(err)
	}
	s := New(pool)
	if err := s.DeleteArchitecture(t.Context(), 1); !errors.Is(err, architecture.ErrNotConfigured) {
		t.Fatalf("missing model: %v", err)
	}
	raw := json.RawMessage(`{"metadata":{"archdrift":{"version":0}}}`)
	saved, err := s.PutArchitecture(t.Context(), raw, 0)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(t.Context(), `INSERT INTO spans (
		trace_id, span_id, service_name, name, kind, start_time, end_time, status,
		attributes, resource_attributes, links
	) VALUES ('\x01', '\x02', 'checkout', 'GET', 'CLIENT', now(), now(), 'OK', '{}', '{}', '[]')`); err != nil {
		t.Fatal(err)
	}
	stale, ok := errors.AsType[*architecture.VersionConflict](s.DeleteArchitecture(t.Context(), saved.Version+1))
	if !ok || stale.CurrentVersion != saved.Version {
		t.Fatalf("stale delete: %v", stale)
	}
	if _, err := s.GetArchitecture(t.Context()); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteArchitecture(t.Context(), saved.Version); err != nil {
		t.Fatal(err)
	}
	if _, err := s.GetArchitecture(t.Context()); !errors.Is(err, architecture.ErrNotConfigured) {
		t.Fatalf("after delete: %v", err)
	}
	var spans int
	if err := pool.QueryRow(t.Context(), "SELECT count(*) FROM spans").Scan(&spans); err != nil || spans != 1 {
		t.Fatalf("spans after delete: %d %v", spans, err)
	}
	saved, err = s.PutArchitecture(t.Context(), raw, 0)
	if err != nil || saved.Version != 1 {
		t.Fatalf("recreate: %+v %v", saved, err)
	}
	var wg sync.WaitGroup
	type outcome struct {
		op  string
		err error
	}
	results := make(chan outcome, 2)
	wg.Go(func() {
		_, err := s.PutArchitecture(t.Context(), raw, saved.Version)
		results <- outcome{"put", err}
	})
	wg.Go(func() {
		results <- outcome{"delete", s.DeleteArchitecture(t.Context(), saved.Version)}
	})
	wg.Wait()
	close(results)
	var putErr, deleteErr error
	seen := 0
	for result := range results {
		seen++
		if result.op == "put" {
			putErr = result.err
		} else {
			deleteErr = result.err
		}
	}
	if seen != 2 || (putErr == nil) == (deleteErr == nil) {
		t.Fatalf("put=%v delete=%v", putErr, deleteErr)
	}
	if err := pool.QueryRow(t.Context(), "SELECT count(*) FROM spans").Scan(&spans); err != nil || spans != 1 {
		t.Fatalf("spans after race: %d %v", spans, err)
	}
	if deleteErr == nil {
		if _, err := s.GetArchitecture(t.Context()); !errors.Is(err, architecture.ErrNotConfigured) {
			t.Fatalf("delete winner left a model: %v", err)
		}
		conflict, ok := errors.AsType[*architecture.VersionConflict](putErr)
		if !ok || conflict.CurrentVersion != 0 {
			t.Fatalf("put against deleted model: %v", putErr)
		}
		return
	}
	got, err := s.GetArchitecture(t.Context())
	if err != nil || got.Version != saved.Version+1 {
		t.Fatalf("put winner: %+v %v", got, err)
	}
	conflict, ok := errors.AsType[*architecture.VersionConflict](deleteErr)
	if !ok || conflict.CurrentVersion != got.Version {
		t.Fatalf("delete against replaced model: %v", deleteErr)
	}
}
