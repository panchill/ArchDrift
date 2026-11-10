// Package migrations embeds the database schema in the application binary.
package migrations

import (
	"context"
	"embed"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
	"github.com/pressly/goose/v3/lock"
)

//go:embed *.sql
var files embed.FS

// Up also accepts databases initialized by the original schema_migrations runner:
// migration 1 is idempotent, preserves spans and leaves the old history intact.
func Up(ctx context.Context, pool *pgxpool.Pool) error {
	db := stdlib.OpenDBFromPool(pool)
	db.SetMaxOpenConns(1)
	defer db.Close()
	// Share the legacy runner's lock during rolling upgrades and binary rollbacks.
	locker, err := lock.NewPostgresSessionLocker(lock.WithLockID(7040911), lock.WithLockTimeout(1, 30))
	if err != nil {
		return err
	}
	provider, err := goose.NewProvider(goose.DialectPostgres, db, files, goose.WithSessionLocker(locker))
	if err != nil {
		return err
	}
	_, err = provider.Up(ctx)
	return err
}
