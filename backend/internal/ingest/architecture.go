package ingest

import (
	"context"
	"errors"
	"io"
	"mime"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/panchill/ArchDrift/backend/internal/architecture"
	"github.com/panchill/ArchDrift/backend/internal/usecase"
)

const (
	architectureBodyLimit = 16 << 20
	architectureTimeout   = 5 * time.Second
)

type ArchitectureHandler struct {
	architecture *usecase.Architecture
}

func NewArchitectureHandler(architecture *usecase.Architecture) *ArchitectureHandler {
	return &ArchitectureHandler{architecture: architecture}
}

func RegisterArchitectureRoutes(router *gin.Engine, handler *ArchitectureHandler) {
	router.GET("/api/v1/architecture", handler.Get)
	router.PUT("/api/v1/architecture", handler.Put)
}

func (h *ArchitectureHandler) Get(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), architectureTimeout)
	defer cancel()

	model, err := h.architecture.Get(ctx)
	if errors.Is(err, architecture.ErrNotConfigured) {
		c.JSON(http.StatusNotFound, gin.H{
			"code":    "architecture_not_configured",
			"message": "Architecture has not been configured",
		})
		return
	}
	if err != nil {
		writeArchitectureError(c, err)
		return
	}
	c.JSON(http.StatusOK, model)
}

func (h *ArchitectureHandler) Put(c *gin.Context) {
	media, _, err := mime.ParseMediaType(c.GetHeader("Content-Type"))
	if err != nil || media != "application/json" {
		c.JSON(http.StatusUnsupportedMediaType, gin.H{
			"code":    "unsupported_media_type",
			"message": "Expected Content-Type: application/json",
		})
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(c.Writer, c.Request.Body, architectureBodyLimit))
	if err != nil {
		writeValidationError(c, []architecture.Detail{{
			Field:   "/",
			Message: "Could not read JSON body (maximum 16 MiB)",
		}})
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), architectureTimeout)
	defer cancel()
	saved, err := h.architecture.Replace(ctx, body)
	if validation, ok := errors.AsType[*architecture.ValidationError](err); ok {
		writeValidationError(c, validation.Details)
		return
	}
	if conflict, ok := errors.AsType[*architecture.VersionConflict](err); ok {
		c.JSON(http.StatusConflict, gin.H{
			"code":           "architecture_version_conflict",
			"message":        "Reload the current architecture and merge your changes",
			"currentVersion": conflict.CurrentVersion,
		})
		return
	}
	if err != nil {
		writeArchitectureError(c, err)
		return
	}
	c.JSON(http.StatusOK, saved)
}

func writeValidationError(c *gin.Context, details []architecture.Detail) {
	c.JSON(http.StatusBadRequest, gin.H{
		"code":    "validation_error",
		"message": "Invalid CALM architecture",
		"details": details,
	})
}

func writeArchitectureError(c *gin.Context, err error) {
	if errors.Is(err, architecture.ErrUnavailable) {
		c.Header("Retry-After", "1")
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"code":    "service_unavailable",
			"message": "Architecture storage is unavailable",
		})
		return
	}
	c.JSON(http.StatusInternalServerError, gin.H{
		"code":    "internal_error",
		"message": "Could not process architecture",
	})
}
