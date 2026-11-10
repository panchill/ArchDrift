package ingest

import (
	"io"
	"log"
	"net/http"
	"runtime/debug"

	"github.com/gin-gonic/gin"
)

func NewRouter() *gin.Engine {
	router := gin.New()
	router.Use(gin.CustomRecoveryWithWriter(io.Discard, recoverPanic))
	router.RedirectTrailingSlash = false
	router.HandleMethodNotAllowed = true
	return router
}

func recoverPanic(c *gin.Context, _ any) {
	// Keep diagnostics without logging the request or panic payload.
	log.Printf("HTTP handler panic\n%s", debug.Stack())
	c.AbortWithStatus(http.StatusInternalServerError)
}

func RegisterHealthRoutes(router *gin.Engine) {
	router.GET("/healthz", health)
	router.HEAD("/healthz", healthHead)
}

func health(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

func healthHead(c *gin.Context) {
	c.Header("Content-Type", "application/json")
	c.Status(http.StatusOK)
}
