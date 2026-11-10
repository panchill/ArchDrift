package store

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
	"go.uber.org/fx"

	"github.com/panchill/ArchDrift/backend/migrations"
)

func NewPool(lc fx.Lifecycle, databaseURL string) (*pgxpool.Pool, error) {
	parsed, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, errors.New("invalid DATABASE_URL")
	}
	pool, err := pgxpool.NewWithConfig(context.Background(), parsed)
	if err != nil {
		return nil, errors.New("create database pool")
	}
	lc.Append(fx.Hook{
		OnStart: func(ctx context.Context) error {
			if err := migrations.Up(ctx, pool); err != nil {
				pool.Close()
				return fmt.Errorf("migrate database: %w", err)
			}
			return nil
		},
		OnStop: func(context.Context) error { pool.Close(); return nil },
	})
	return pool, nil
}
