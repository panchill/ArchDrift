package ingest

import (
	"math"
	"testing"
	"time"

	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/ptrace"
	"go.opentelemetry.io/collector/pdata/ptrace/ptraceotlp"

	"github.com/panchill/ArchDrift/backend/internal/model"
)

func TestParse(t *testing.T) {
	start := time.Date(2026, 11, 10, 12, 0, 0, 0, time.UTC)
	end := start.Add(15 * time.Millisecond)

	spans, rejected, err := Parse(mustExport(t, func(td ptrace.Traces) {
		rs := td.ResourceSpans().AppendEmpty()
		rs.Resource().Attributes().PutStr("service.name", "checkout")
		rs.Resource().Attributes().PutBool("archdrift.flag", true)
		rs.Resource().Attributes().PutInt("archdrift.n", 7)
		rs.Resource().Attributes().PutDouble("archdrift.d", 1.5)
		ss := rs.ScopeSpans().AppendEmpty().Spans()

		ok := ss.AppendEmpty()
		ok.SetTraceID(traceID(1))
		ok.SetSpanID(spanID(1))
		ok.SetParentSpanID(spanID(2))
		ok.SetName("PlaceOrder")
		ok.SetKind(ptrace.SpanKindClient)
		ok.SetStartTimestamp(pcommon.NewTimestampFromTime(start))
		ok.SetEndTimestamp(pcommon.NewTimestampFromTime(end))
		ok.Status().SetCode(ptrace.StatusCodeError)
		ok.Status().SetMessage("boom")
		ok.Attributes().PutStr("http.request.method", "POST")
		ok.Attributes().PutEmptyBytes("archdrift.bin").FromRaw([]byte{0x00, 0xff})
		link := ok.Links().AppendEmpty()
		link.SetTraceID(traceID(2))
		link.SetSpanID(spanID(3))
		_ = ok.Links().AppendEmpty()

		dup := ss.AppendEmpty()
		dup.SetTraceID(traceID(1))
		dup.SetSpanID(spanID(1))
		dup.SetName("duplicate")
		dup.SetStartTimestamp(pcommon.NewTimestampFromTime(start))
		dup.SetEndTimestamp(pcommon.NewTimestampFromTime(end))

		badEnd := ss.AppendEmpty()
		badEnd.SetTraceID(traceID(1))
		badEnd.SetSpanID(spanID(4))
		badEnd.SetStartTimestamp(pcommon.NewTimestampFromTime(end))
		badEnd.SetEndTimestamp(pcommon.NewTimestampFromTime(start))

		zero := ss.AppendEmpty()
		zero.SetName("zero")
		zero.SetStartTimestamp(pcommon.NewTimestampFromTime(start))
		zero.SetEndTimestamp(pcommon.NewTimestampFromTime(end))

		noService := td.ResourceSpans().AppendEmpty()
		lonely := noService.ScopeSpans().AppendEmpty().Spans().AppendEmpty()
		lonely.SetTraceID(traceID(1))
		lonely.SetSpanID(spanID(5))
		lonely.SetStartTimestamp(pcommon.NewTimestampFromTime(start))
		lonely.SetEndTimestamp(pcommon.NewTimestampFromTime(end))
	}))
	if err != nil {
		t.Fatal(err)
	}
	// Reject invalid wire records early; deduplication belongs to the use case.
	if len(spans) != 2 || rejected != 3 {
		t.Fatalf("spans=%d rejected=%d, want 2 and 3", len(spans), rejected)
	}
	got := spans[0]
	if got.ServiceName != "checkout" || got.Name != "PlaceOrder" || got.Kind != model.KindClient {
		t.Fatalf("спан: %+v", got)
	}
	if got.Status != model.StatusError || got.StatusMessage != "boom" {
		t.Fatalf("статус: %s %s", got.Status, got.StatusMessage)
	}
	if got.ParentSpanID != spanID(2).String() {
		t.Fatalf("parent: %s", got.ParentSpanID)
	}
	if got.Attributes["http.request.method"] != (model.Attr{Type: "string", Value: "POST"}) {
		t.Fatalf("method: %+v", got.Attributes["http.request.method"])
	}
	if got.Attributes["archdrift.bin"].Type != "bytes" || got.Attributes["archdrift.bin"].Value != "AP8=" {
		t.Fatalf("bytes: %+v", got.Attributes["archdrift.bin"])
	}
	if got.ResourceAttributes["archdrift.flag"] != (model.Attr{Type: "bool", Value: "true"}) {
		t.Fatalf("bool: %+v", got.ResourceAttributes["archdrift.flag"])
	}
	if got.ResourceAttributes["archdrift.n"].Value != "7" || got.ResourceAttributes["archdrift.d"].Value != "1.5" {
		t.Fatalf("числа: %+v", got.ResourceAttributes)
	}
	if len(got.Links) != 1 || got.Links[0].SpanID != spanID(3).String() {
		t.Fatalf("links: %+v", got.Links)
	}
	if !got.End.Equal(end) || !got.Start.Equal(start) {
		t.Fatalf("время: %s %s", got.Start, got.End)
	}
}

func TestParseEmptyAndGarbage(t *testing.T) {
	spans, rejected, err := Parse(nil)
	if err != nil || rejected != 0 || len(spans) != 0 {
		t.Fatalf("пустое тело: spans=%d err=%v", len(spans), err)
	}
	spans, rejected, err = Parse([]byte{})
	if err != nil || rejected != 0 || len(spans) != 0 {
		t.Fatalf("нулевая длина: spans=%d err=%v", len(spans), err)
	}
	if _, _, err := Parse([]byte{0xff}); err == nil {
		t.Fatal("мусорный protobuf должен давать ошибку")
	}
}

func TestParseArrayAndSpecialFloats(t *testing.T) {
	spans, _, err := Parse(mustExport(t, func(td ptrace.Traces) {
		rs := td.ResourceSpans().AppendEmpty()
		rs.Resource().Attributes().PutStr("service.name", "checkout")
		sp := rs.ScopeSpans().AppendEmpty().Spans().AppendEmpty()
		sp.SetTraceID(traceID(1))
		sp.SetSpanID(spanID(1))
		sp.SetStartTimestamp(pcommon.NewTimestampFromTime(time.Unix(0, 0).UTC()))
		sp.SetEndTimestamp(pcommon.NewTimestampFromTime(time.Unix(0, 0).UTC()))
		arr := sp.Attributes().PutEmptySlice("archdrift.arr")
		arr.AppendEmpty().SetStr("a")
		kv := sp.Attributes().PutEmptyMap("archdrift.kv")
		kv.PutBool("on", false)
		sp.Attributes().PutDouble("nan", math.NaN())
		sp.Attributes().PutDouble("pinf", math.Inf(1))
		sp.Attributes().PutDouble("ninf", math.Inf(-1))
	}))
	if err != nil {
		t.Fatal(err)
	}
	got := spans[0].Attributes
	if got["archdrift.arr"].Type != "array" || got["archdrift.arr"].Value != `[{"type":"string","value":"a"}]` {
		t.Fatalf("array: %+v", got["archdrift.arr"])
	}
	if got["archdrift.kv"].Type != "kvlist" || got["archdrift.kv"].Value != `{"on":{"type":"bool","value":"false"}}` {
		t.Fatalf("kvlist: %+v", got["archdrift.kv"])
	}
	if got["nan"].Value != "NaN" || got["pinf"].Value != "Infinity" || got["ninf"].Value != "-Infinity" {
		t.Fatalf("floats: %+v", got)
	}
}

func mustExport(t *testing.T, fill func(ptrace.Traces)) []byte {
	t.Helper()
	td := ptrace.NewTraces()
	if fill != nil {
		fill(td)
	}
	raw, err := ptraceotlp.NewExportRequestFromTraces(td).MarshalProto()
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func traceID(n byte) pcommon.TraceID {
	var id pcommon.TraceID
	id[15] = n
	return id
}

func spanID(n byte) pcommon.SpanID {
	var id pcommon.SpanID
	id[7] = n
	return id
}
