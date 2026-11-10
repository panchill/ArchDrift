package app

import (
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"go.uber.org/fx"

	"github.com/panchill/ArchDrift/backend/internal/architecture"
	"github.com/panchill/ArchDrift/backend/internal/ingest"
	"github.com/panchill/ArchDrift/backend/internal/store"
	"github.com/panchill/ArchDrift/backend/internal/usecase"
)

func New(options ...fx.Option) *fx.App {
	return fx.New(
		fx.StartTimeout(30*time.Second),
		fx.Provide(
			loadConfig,
			func(lc fx.Lifecycle, cfg config) (*pgxpool.Pool, error) {
				return store.NewPool(lc, cfg.DatabaseURL)
			},
			fx.Annotate(store.New,
				fx.As(new(usecase.ArchitectureRepository)),
				fx.As(new(usecase.SpanRepository)),
			),
			architecture.NewValidator,
			usecase.NewArchitecture,
			usecase.NewTraces,
			ingest.NewArchitectureHandler,
			ingest.NewTracesHandler,
			ingest.NewRouter,
			newServer,
		),
		fx.Invoke(
			ingest.RegisterHealthRoutes,
			ingest.RegisterTracesRoutes,
			ingest.RegisterArchitectureRoutes,
			func(*http.Server) {},
		),
		fx.Options(options...),
	)
}
