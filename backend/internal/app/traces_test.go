package app

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/ptrace/ptraceotlp"
	"go.uber.org/fx"
	statuspb "google.golang.org/genproto/googleapis/rpc/status"
	"google.golang.org/protobuf/proto"

	"github.com/panchill/ArchDrift/backend/internal/testdb"
)

func TestTracesHTTP(t *testing.T) {
	dsn, _ := testdb.New(t)
	t.Setenv("DATABASE_URL", dsn)
	t.Setenv("ADDR", "127.0.0.1:0")
	var router *gin.Engine
	var pool *pgxpool.Pool
	application := New(fx.NopLogger, fx.Populate(&router, &pool))
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	defer cancel()
	if err := application.Start(ctx); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := application.Stop(ctx); err != nil {
			t.Error(err)
		}
	})

	export := ptraceotlp.NewExportRequest()
	resource := export.Traces().ResourceSpans().AppendEmpty()
	resource.Resource().Attributes().PutStr("service.name", "checkout")
	spans := resource.ScopeSpans().AppendEmpty().Spans()
	valid := spans.AppendEmpty()
	valid.SetTraceID(pcommon.TraceID{15: 1})
	valid.SetSpanID(pcommon.SpanID{7: 1})
	valid.SetName("first")
	valid.SetStartTimestamp(1)
	valid.SetEndTimestamp(2)
	valid.CopyTo(spans.AppendEmpty())
	spans.At(1).SetName("duplicate")
	spans.AppendEmpty() // No IDs: rejected, not persisted.

	post := func(want int) *httptest.ResponseRecorder {
		t.Helper()
		raw, err := export.MarshalProto()
		if err != nil {
			t.Fatal(err)
		}
		request := httptest.NewRequest(http.MethodPost, "/v1/traces", bytes.NewReader(raw))
		request.Header.Set("Content-Type", "application/x-protobuf")
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		if response.Code != want {
			t.Fatalf("status=%d want=%d", response.Code, want)
		}
		return response
	}
	for range 2 {
		response := ptraceotlp.NewExportResponse()
		if err := response.UnmarshalProto(post(http.StatusOK).Body.Bytes()); err != nil {
			t.Fatal(err)
		}
		if response.PartialSuccess().RejectedSpans() != 1 {
			t.Fatalf("rejected=%d", response.PartialSuccess().RejectedSpans())
		}
	}
	var count int
	var name string
	if err := pool.QueryRow(ctx, "SELECT count(*), min(name) FROM spans").Scan(&count, &name); err != nil || count != 1 || name != "first" {
		t.Fatalf("persisted count=%d name=%q error=%v", count, name, err)
	}

	// Force the second insert to fail; the first must roll back with it.
	if _, err := pool.Exec(ctx, "ALTER TABLE spans ADD CHECK (name <> 'duplicate')"); err != nil {
		t.Fatal(err)
	}
	spans.At(0).SetSpanID(pcommon.SpanID{7: 2})
	spans.At(1).SetSpanID(pcommon.SpanID{7: 3})
	post(http.StatusServiceUnavailable)
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM spans").Scan(&count); err != nil || count != 1 {
		t.Fatalf("failed batch partially saved: count=%d error=%v", count, err)
	}
	pool.Close()
	response := post(http.StatusServiceUnavailable)
	var status statuspb.Status
	if err := proto.Unmarshal(response.Body.Bytes(), &status); err != nil || status.Code != 14 || response.Header().Get("Retry-After") != "1" {
		t.Fatalf("unavailable response: status=%v error=%v", &status, err)
	}
}
