package ingest

import (
	"context"
	"errors"
	"io"
	"log"
	"mime"
	"net/http"
	"strings"

	statuspb "google.golang.org/genproto/googleapis/rpc/status"
	"google.golang.org/protobuf/proto"

	"go.opentelemetry.io/collector/pdata/ptrace/ptraceotlp"

	"github.com/panchill/ArchDrift/backend/internal/model"
)

const maxBody = 4 << 20

const (
	codeInvalidArgument   int32 = 3
	codeResourceExhausted int32 = 8
	codeUnavailable       int32 = 14
)

// SpanStore сохраняет принятые спаны до ответа 200.
type SpanStore interface {
	InsertSpans(ctx context.Context, spans []model.Span) error
}

// Handle — POST /v1/traces. Protobuf без сжатия, тело до 4 МиБ.
func Handle(w http.ResponseWriter, r *http.Request, db SpanStore) {
	if enc := r.Header.Get("Content-Encoding"); enc != "" && !strings.EqualFold(enc, "identity") {
		writeStatus(w, http.StatusUnsupportedMediaType, codeInvalidArgument, "поддерживается только Content-Encoding: identity")
		return
	}
	media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || media != "application/x-protobuf" {
		writeStatus(w, http.StatusUnsupportedMediaType, codeInvalidArgument, "ожидается Content-Type: application/x-protobuf")
		return
	}
	if r.ContentLength > maxBody {
		writeStatus(w, http.StatusRequestEntityTooLarge, codeResourceExhausted, "тело больше 4 МиБ")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxBody)
	body, err := io.ReadAll(r.Body)
	if err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			writeStatus(w, http.StatusRequestEntityTooLarge, codeResourceExhausted, "тело больше 4 МиБ")
			return
		}
		writeStatus(w, http.StatusBadRequest, codeInvalidArgument, "не удалось прочитать тело")
		return
	}

	spans, rejected, err := Parse(body)
	if err != nil {
		writeStatus(w, http.StatusBadRequest, codeInvalidArgument, "неразбираемый protobuf")
		return
	}
	if err := db.InsertSpans(r.Context(), spans); err != nil {
		log.Printf("запись спанов: %v", err)
		w.Header().Set("Retry-After", "1")
		writeStatus(w, http.StatusServiceUnavailable, codeUnavailable, "база временно недоступна")
		return
	}

	resp := ptraceotlp.NewExportResponse()
	if rejected > 0 {
		resp.PartialSuccess().SetRejectedSpans(int64(rejected))
		resp.PartialSuccess().SetErrorMessage("отклонены спаны с невалидным id, без service.name или с end < start")
	}
	out, err := resp.MarshalProto()
	if err != nil {
		log.Printf("ответ otlp: %v", err)
		w.Header().Set("Retry-After", "1")
		writeStatus(w, http.StatusServiceUnavailable, codeUnavailable, "не удалось собрать ответ")
		return
	}
	w.Header().Set("Content-Type", "application/x-protobuf")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(out)
}

func writeStatus(w http.ResponseWriter, httpCode int, code int32, msg string) {
	raw, err := proto.Marshal(&statuspb.Status{Code: code, Message: msg})
	if err != nil {
		http.Error(w, "internal", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/x-protobuf")
	w.WriteHeader(httpCode)
	_, _ = w.Write(raw)
}
