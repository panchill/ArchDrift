package migrations

import (
	"context"
	"errors"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/panchill/ArchDrift/backend/internal/testdb"
)

func TestUpFreshConcurrentAndRepeat(t *testing.T) {
	_, pool := testdb.New(t)
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for range 2 {
		wg.Go(func() { results <- Up(t.Context(), pool) })
	}
	wg.Wait()
	close(results)
	for err := range results {
		if err != nil {
			t.Fatal(err)
		}
	}
	if err := Up(t.Context(), pool); err != nil {
		t.Fatal(err)
	}
	var applied int
	if err := pool.QueryRow(t.Context(), "SELECT count(*) FROM goose_db_version WHERE version_id=1 AND is_applied").Scan(&applied); err != nil {
		t.Fatal(err)
	}
	if applied != 1 {
		t.Fatalf("migration applied %d times", applied)
	}
	if _, err := pool.Exec(t.Context(), "SELECT trace_id,span_id FROM spans"); err != nil {
		t.Fatal(err)
	}
}

func TestUpPreservesLegacyDataAndHistory(t *testing.T) {
	_, pool := testdb.New(t)
	legacy, err := os.ReadFile("testdata/legacy.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(t.Context(), string(legacy)); err != nil {
		t.Fatal(err)
	}
	if err := Up(t.Context(), pool); err != nil {
		t.Fatal(err)
	}
	var count int
	for _, query := range []string{
		"SELECT count(*) FROM spans WHERE service_name='legacy'",
		"SELECT count(*) FROM schema_migrations WHERE version=1",
		"SELECT count(*) FROM goose_db_version WHERE version_id=1 AND is_applied",
	} {
		if err := pool.QueryRow(t.Context(), query).Scan(&count); err != nil {
			t.Fatal(err)
		}
		if count != 1 {
			t.Fatalf("expected preserved record for %s; got %d", query, count)
		}
	}
}

func TestUpHonorsLegacyLockAndCancellation(t *testing.T) {
	_, pool := testdb.New(t)
	tx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(context.Background())
	if _, err := tx.Exec(t.Context(), "SELECT pg_advisory_xact_lock(7040911)"); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 150*time.Millisecond)
	defer cancel()
	if err := Up(ctx, pool); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("migration did not respect legacy lock/deadline: %v", err)
	}
	if err := tx.Rollback(t.Context()); err != nil {
		t.Fatal(err)
	}
	if err := Up(t.Context(), pool); err != nil {
		t.Fatal(err)
	}
}
