package app

import (
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"go.uber.org/fx"

	"github.com/panchill/ArchDrift/backend/internal/ingest"
	"github.com/panchill/ArchDrift/backend/internal/store"
)

func New(options ...fx.Option) *fx.App {
	return fx.New(
		fx.StartTimeout(30*time.Second),
		fx.Provide(
			loadConfig,
			func(lc fx.Lifecycle, cfg config) (*pgxpool.Pool, error) {
				return store.NewPool(lc, cfg.DatabaseURL)
			},
			store.New,
			ingest.NewRouter,
			newServer,
		),
		fx.Invoke(func(*http.Server) {}),
		fx.Options(options...),
	)
}
