package ingest

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/panchill/ArchDrift/backend/internal/architecture"
	"github.com/panchill/ArchDrift/backend/internal/usecase"
)

type AnalysisHandler struct {
	analysis *usecase.Analysis
}

func NewAnalysisHandler(analysis *usecase.Analysis) *AnalysisHandler {
	return &AnalysisHandler{analysis: analysis}
}

func RegisterAnalysisRoutes(router *gin.Engine, handler *AnalysisHandler) {
	router.GET("/api/v1/analysis", handler.Get)
}

func (h *AnalysisHandler) Get(c *gin.Context) {
	from, fromErr := time.Parse(time.RFC3339Nano, c.Query("from"))
	to, toErr := time.Parse(time.RFC3339Nano, c.Query("to"))
	if fromErr != nil || toErr != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code": "validation_error", "message": "from and to must be RFC 3339 timestamps with a timezone",
		})
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()
	result, err := h.analysis.Get(ctx, from, to)
	switch {
	case errors.Is(err, usecase.ErrInvalidInterval):
		c.JSON(http.StatusBadRequest, gin.H{"code": "validation_error", "message": err.Error()})
	case errors.Is(err, architecture.ErrNotConfigured):
		c.JSON(http.StatusConflict, gin.H{
			"code": "architecture_not_configured", "message": "Architecture has not been configured",
		})
	case errors.Is(err, architecture.ErrUnavailable), errors.Is(err, context.DeadlineExceeded):
		c.Header("Retry-After", "1")
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"code": "service_unavailable", "message": "Analysis storage is unavailable",
		})
	case err != nil:
		c.JSON(http.StatusInternalServerError, gin.H{
			"code": "internal_error", "message": "Could not analyze architecture",
		})
	default:
		// The API carries a child's service through parentId only.
		for i := range result.Nodes {
			if result.Nodes[i].Node.Type != "service" {
				result.Nodes[i].Node.ServiceName = ""
			}
		}
		c.JSON(http.StatusOK, result)
	}
}
