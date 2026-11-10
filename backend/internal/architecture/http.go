package architecture

import (
	"context"
	"errors"
	"io"
	"mime"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/panchill/ArchDrift/backend/internal/store"
)

func Register(router *gin.Engine, db *store.Store) {
	router.GET("/api/v1/architecture", func(c *gin.Context) {
		ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
		defer cancel()
		a, err := db.GetArchitecture(ctx)
		if errors.Is(err, pgx.ErrNoRows) {
			c.JSON(http.StatusNotFound, gin.H{"code": "architecture_not_configured", "message": "Architecture has not been configured"})
		} else if err != nil {
			databaseError(c)
		} else {
			c.JSON(http.StatusOK, a)
		}
	})
	router.PUT("/api/v1/architecture", func(c *gin.Context) {
		media, _, err := mime.ParseMediaType(c.GetHeader("Content-Type"))
		if err != nil || media != "application/json" {
			c.JSON(http.StatusUnsupportedMediaType, gin.H{"code": "unsupported_media_type", "message": "Expected Content-Type: application/json"})
			return
		}
		body, err := io.ReadAll(http.MaxBytesReader(c.Writer, c.Request.Body, 16<<20))
		if err != nil {
			validationError(c, []Detail{{"/", "Could not read JSON body (maximum 16 MiB)"}})
			return
		}
		m, details := Parse(body)
		if len(details) != 0 {
			validationError(c, details)
			return
		}
		ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
		defer cancel()
		a, err := db.PutArchitecture(ctx, body, m.Version)
		var conflict *store.VersionConflict
		if errors.As(err, &conflict) {
			c.JSON(http.StatusConflict, gin.H{"code": "architecture_version_conflict", "message": "Reload the current architecture and merge your changes", "currentVersion": conflict.CurrentVersion})
		} else if err != nil {
			databaseError(c)
		} else {
			c.JSON(http.StatusOK, a)
		}
	})
}

func validationError(c *gin.Context, details []Detail) {
	c.JSON(http.StatusBadRequest, gin.H{"code": "validation_error", "message": "Invalid CALM architecture", "details": details})
}

func databaseError(c *gin.Context) {
	c.Header("Retry-After", "1")
	c.JSON(http.StatusServiceUnavailable, gin.H{"code": "service_unavailable", "message": "Architecture storage is unavailable"})
}
