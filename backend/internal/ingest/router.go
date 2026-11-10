package ingest

import (
	"io"
	"log"
	"net/http"
	"runtime/debug"

	"github.com/gin-gonic/gin"

	"github.com/panchill/ArchDrift/backend/internal/store"
)

func NewRouter(db *store.Store) *gin.Engine {
	router := gin.New()
	router.Use(gin.CustomRecoveryWithWriter(io.Discard, func(c *gin.Context, _ any) {
		// Keep Railway diagnostics without logging the request or panic payload.
		log.Printf("HTTP handler panic\n%s", debug.Stack())
		c.AbortWithStatus(http.StatusInternalServerError)
	}))
	router.RedirectTrailingSlash = false
	router.HandleMethodNotAllowed = true
	router.GET("/healthz", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"status": "ok"}) })
	router.HEAD("/healthz", func(c *gin.Context) { c.Header("Content-Type", "application/json"); c.Status(http.StatusOK) })
	router.POST("/v1/traces", Handler(db))
	return router
}
