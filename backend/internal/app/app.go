package app

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"go.uber.org/fx"

	"github.com/panchill/ArchDrift/backend/internal/store"
	"github.com/panchill/ArchDrift/backend/migrations"
)

func New(options ...fx.Option) *fx.App {
	return fx.New(
		fx.StartTimeout(30*time.Second),
		fx.Provide(loadConfig, newPool, store.New, newRouter, newServer),
		fx.Invoke(func(*http.Server) {}),
		fx.Options(options...),
	)
}

func newPool(lc fx.Lifecycle, cfg config) (*pgxpool.Pool, error) {
	parsed, err := pgxpool.ParseConfig(cfg.DatabaseURL)
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
