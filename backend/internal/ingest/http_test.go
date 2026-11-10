package ingest

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	statuspb "google.golang.org/genproto/googleapis/rpc/status"
	"google.golang.org/protobuf/proto"

	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/ptrace"
	"go.opentelemetry.io/collector/pdata/ptrace/ptraceotlp"

	"github.com/panchill/ArchDrift/backend/internal/model"
)

type memStore struct {
	spans []model.Span
	err   error
}

func (m *memStore) InsertSpans(_ context.Context, spans []model.Span) error {
	if m.err != nil {
		return m.err
	}
	m.spans = append(m.spans, spans...)
	return nil
}

func TestHandle(t *testing.T) {
	start := time.Date(2026, 11, 10, 12, 0, 0, 0, time.UTC)
	body := mustExport(t, func(td ptrace.Traces) {
		rs := td.ResourceSpans().AppendEmpty()
		rs.Resource().Attributes().PutStr("service.name", "checkout")
		ok := rs.ScopeSpans().AppendEmpty().Spans().AppendEmpty()
		ok.SetTraceID(traceID(1))
		ok.SetSpanID(spanID(1))
		ok.SetName("PlaceOrder")
		ok.SetKind(ptrace.SpanKindClient)
		ok.SetStartTimestamp(pcommon.NewTimestampFromTime(start))
		ok.SetEndTimestamp(pcommon.NewTimestampFromTime(start.Add(time.Millisecond)))
		bad := rs.ScopeSpans().AppendEmpty().Spans().AppendEmpty()
		bad.SetName("no-id")
		bad.SetStartTimestamp(pcommon.NewTimestampFromTime(start))
		bad.SetEndTimestamp(pcommon.NewTimestampFromTime(start))
	})

	db := &memStore{}
	rec := postTraces(t, db, body, "application/x-protobuf", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d, body %s", rec.Code, rec.Body.Bytes())
	}
	if rec.Header().Get("Content-Type") != "application/x-protobuf" {
		t.Fatalf("content-type %s", rec.Header().Get("Content-Type"))
	}
	resp := ptraceotlp.NewExportResponse()
	if err := resp.UnmarshalProto(rec.Body.Bytes()); err != nil {
		t.Fatal(err)
	}
	if resp.PartialSuccess().RejectedSpans() != 1 {
		t.Fatalf("rejected %d", resp.PartialSuccess().RejectedSpans())
	}
	if len(db.spans) != 1 || db.spans[0].Name != "PlaceOrder" {
		t.Fatalf("сохранено: %+v", db.spans)
	}
}

func TestHandleRejectsEncodingAndType(t *testing.T) {
	db := &memStore{}
	rec := postTraces(t, db, []byte{}, "application/json", "")
	if rec.Code != http.StatusUnsupportedMediaType {
		t.Fatalf("json: %d", rec.Code)
	}
	rec = postTraces(t, db, []byte{}, "application/x-protobuf", "gzip")
	if rec.Code != http.StatusUnsupportedMediaType {
		t.Fatalf("gzip: %d", rec.Code)
	}
	if len(db.spans) != 0 {
		t.Fatal("отклонённый запрос не должен писаться")
	}
	var st statuspb.Status
	if err := proto.Unmarshal(rec.Body.Bytes(), &st); err != nil {
		t.Fatal(err)
	}
	if st.Code != codeInvalidArgument {
		t.Fatalf("rpc code %d", st.Code)
	}
}

func TestHandleBadProtobufAndDatabase(t *testing.T) {
	db := &memStore{}
	rec := postTraces(t, db, []byte{0xff}, "application/x-protobuf", "")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("мусор: %d", rec.Code)
	}

	db.err = io.ErrClosedPipe
	body := mustExport(t, func(td ptrace.Traces) {
		rs := td.ResourceSpans().AppendEmpty()
		rs.Resource().Attributes().PutStr("service.name", "checkout")
		sp := rs.ScopeSpans().AppendEmpty().Spans().AppendEmpty()
		sp.SetTraceID(traceID(1))
		sp.SetSpanID(spanID(1))
		sp.SetStartTimestamp(pcommon.NewTimestampFromTime(time.Unix(0, 0).UTC()))
		sp.SetEndTimestamp(pcommon.NewTimestampFromTime(time.Unix(0, 0).UTC()))
	})
	rec = postTraces(t, db, body, "application/x-protobuf", "")
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("бд: %d", rec.Code)
	}
	if rec.Header().Get("Retry-After") != "1" {
		t.Fatalf("retry-after %q", rec.Header().Get("Retry-After"))
	}
}

func TestHandleTooLarge(t *testing.T) {
	db := &memStore{}
	req := httptest.NewRequest(http.MethodPost, "/v1/traces", strings.NewReader("x"))
	req.Header.Set("Content-Type", "application/x-protobuf")
	req.ContentLength = maxBody + 1
	rec := httptest.NewRecorder()
	Handle(rec, req, db)
	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status %d", rec.Code)
	}
}

func postTraces(t *testing.T, db SpanStore, body []byte, contentType, encoding string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/v1/traces", strings.NewReader(string(body)))
	req.Header.Set("Content-Type", contentType)
	if encoding != "" {
		req.Header.Set("Content-Encoding", encoding)
	}
	rec := httptest.NewRecorder()
	Handle(rec, req, db)
	return rec
}
