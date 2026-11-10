package app

import (
	"context"
	"errors"
	"io"
	"log"
	"net"
	"net/http"
	"runtime/debug"
	"time"

	"github.com/gin-gonic/gin"
	"go.uber.org/fx"

	"github.com/panchill/ArchDrift/backend/internal/api"
	"github.com/panchill/ArchDrift/backend/internal/ingest"
	"github.com/panchill/ArchDrift/backend/internal/store"
)

func newRouter(db *store.Store) *gin.Engine {
	router := gin.New()
	router.Use(gin.CustomRecoveryWithWriter(io.Discard, func(c *gin.Context, _ any) {
		// Keep Railway diagnostics without logging the request or panic payload.
		log.Printf("HTTP handler panic\n%s", debug.Stack())
		c.AbortWithStatus(http.StatusInternalServerError)
	}))
	router.RedirectTrailingSlash = false
	router.HandleMethodNotAllowed = true
	router.GET("/healthz", func(c *gin.Context) { c.JSON(http.StatusOK, api.Health{Status: api.Ok}) })
	router.HEAD("/healthz", func(c *gin.Context) { c.Header("Content-Type", "application/json"); c.Status(http.StatusOK) })
	router.POST("/v1/traces", ingest.Handler(db))
	return router
}

func newServer(lc fx.Lifecycle, cfg config, router *gin.Engine, shutdown fx.Shutdowner) *http.Server {
	server := &http.Server{Addr: cfg.Addr, Handler: router, ReadHeaderTimeout: 5 * time.Second}
	lc.Append(fx.Hook{
		OnStart: func(ctx context.Context) error {
			listener, err := (&net.ListenConfig{}).Listen(ctx, "tcp", server.Addr)
			if err != nil {
				return err
			}
			server.Addr = listener.Addr().String()
			go func() {
				if err := server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
					log.Printf("HTTP server stopped: %v", err)
					_ = shutdown.Shutdown(fx.ExitCode(1))
				}
			}()
			return nil
		},
		OnStop: func(ctx context.Context) error {
			if err := server.Shutdown(ctx); err != nil {
				_ = server.Close()
				return err
			}
			return nil
		},
	})
	return server
}
