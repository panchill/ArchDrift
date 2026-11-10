package ingest

import (
	"errors"
	"io"
	"log"
	"mime"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	statuspb "google.golang.org/genproto/googleapis/rpc/status"
	"google.golang.org/protobuf/proto"

	"go.opentelemetry.io/collector/pdata/ptrace/ptraceotlp"

	"github.com/panchill/ArchDrift/backend/internal/usecase"
)

const maxBody = 4 << 20

const (
	codeInvalidArgument   int32 = 3
	codeResourceExhausted int32 = 8
	codeUnavailable       int32 = 14
)

type TracesHandler struct {
	traces *usecase.Traces
}

func NewTracesHandler(traces *usecase.Traces) *TracesHandler {
	return &TracesHandler{traces: traces}
}

func RegisterTracesRoutes(router *gin.Engine, handler *TracesHandler) {
	router.POST("/v1/traces", handler.Post)
}

func (h *TracesHandler) Post(c *gin.Context) {
	r := c.Request
	if enc := r.Header.Get("Content-Encoding"); enc != "" && !strings.EqualFold(enc, "identity") {
		writeStatus(c, http.StatusUnsupportedMediaType, codeInvalidArgument, "поддерживается только Content-Encoding: identity")
		return
	}
	media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || media != "application/x-protobuf" {
		writeStatus(c, http.StatusUnsupportedMediaType, codeInvalidArgument, "ожидается Content-Type: application/x-protobuf")
		return
	}
	if r.ContentLength > maxBody {
		writeStatus(c, http.StatusRequestEntityTooLarge, codeResourceExhausted, "тело больше 4 МиБ")
		return
	}

	r.Body = http.MaxBytesReader(c.Writer, r.Body, maxBody)
	body, err := io.ReadAll(r.Body)
	if err != nil {
		if _, ok := errors.AsType[*http.MaxBytesError](err); ok {
			writeStatus(c, http.StatusRequestEntityTooLarge, codeResourceExhausted, "тело больше 4 МиБ")
			return
		}
		writeStatus(c, http.StatusBadRequest, codeInvalidArgument, "не удалось прочитать тело")
		return
	}

	spans, rejected, err := Parse(body)
	if err != nil {
		writeStatus(c, http.StatusBadRequest, codeInvalidArgument, "неразбираемый protobuf")
		return
	}
	invalid, err := h.traces.Ingest(r.Context(), spans)
	if err != nil {
		log.Printf("запись спанов: %v", err)
		c.Header("Retry-After", "1")
		writeStatus(c, http.StatusServiceUnavailable, codeUnavailable, "база временно недоступна")
		return
	}

	rejected += invalid
	resp := ptraceotlp.NewExportResponse()
	if rejected > 0 {
		resp.PartialSuccess().SetRejectedSpans(int64(rejected))
		resp.PartialSuccess().SetErrorMessage("отклонены спаны с невалидным id, без service.name или с end < start")
	}
	out, err := resp.MarshalProto()
	if err != nil {
		log.Printf("ответ otlp: %v", err)
		c.Header("Retry-After", "1")
		writeStatus(c, http.StatusServiceUnavailable, codeUnavailable, "не удалось собрать ответ")
		return
	}
	c.Data(http.StatusOK, "application/x-protobuf", out)
}

func writeStatus(c *gin.Context, httpCode int, code int32, msg string) {
	raw, err := proto.Marshal(&statuspb.Status{Code: code, Message: msg})
	if err != nil {
		c.AbortWithStatus(http.StatusInternalServerError)
		return
	}
	c.Data(httpCode, "application/x-protobuf", raw)
}
