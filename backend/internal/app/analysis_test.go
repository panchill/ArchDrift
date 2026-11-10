package app

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	"go.uber.org/fx"

	"github.com/panchill/ArchDrift/backend/internal/analysis"
	"github.com/panchill/ArchDrift/backend/internal/architecture"
	"github.com/panchill/ArchDrift/backend/internal/model"
	"github.com/panchill/ArchDrift/backend/internal/nodeid"
	"github.com/panchill/ArchDrift/backend/internal/store"
	"github.com/panchill/ArchDrift/backend/internal/testdb"
)

func TestAnalysisHTTP(t *testing.T) {
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
	request := func(method, path string, body []byte, want int) []byte {
		t.Helper()
		r := httptest.NewRequest(method, path, bytes.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		if w.Code != want {
			t.Fatalf(
				"%s: status=%d want=%d body=%s",
				path,
				w.Code,
				want,
				w.Body.String(),
			)
		}
		if want != 200 {
			code := map[int]string{400: "validation_error", 409: "architecture_not_configured", 503: "service_unavailable"}[want]
			if !strings.Contains(w.Body.String(), code) {
				t.Fatalf("error code missing: %s", w.Body.String())
			}
		}
		return w.Body.Bytes()
	}
	base := "/api/v1/analysis"
	for _, query := range []string{
		"", "?from=bad&to=bad", "?from=2026-11-10T00:00:00&to=2026-11-10T01:00:00Z",
		"?from=2026-11-10T00:00:00Z&to=2026-11-10T00:00:00Z",
		"?from=2026-11-10T01:00:00Z&to=2026-11-10T00:00:00Z",
		"?from=2026-11-10T00:00:00Z&to=2026-11-11T00:00:00.000000001Z",
	} {
		request(
			"GET",
			base+query,
			nil,
			400,
		)
	}
	from := time.Date(
		2026,
		11,
		10,
		0,
		0,
		0,
		0,
		time.UTC,
	)
	to := from.Add(24 * time.Hour)
	path := base + "?" + url.Values{
		"from": {from.Format(time.RFC3339Nano)},
		"to":   {to.In(time.FixedZone("+03", 3*60*60)).Format(time.RFC3339Nano)},
	}.Encode()
	request(
		"GET",
		path,
		nil,
		409,
	)
	raw, err := os.ReadFile("../../../examples/opentelemetry-demo.architecture.json")
	if err != nil {
		t.Fatal(err)
	}
	var saved architecture.Snapshot
	put := func(raw []byte) {
		t.Helper()
		if err := json.Unmarshal(request(
			"PUT",
			"/api/v1/architecture",
			raw,
			200,
		), &saved); err != nil {
			t.Fatal(err)
		}
	}
	get := func() analysis.Result {
		t.Helper()
		var got analysis.Result
		body := request(
			"GET",
			path,
			nil,
			200,
		)
		decoder := json.NewDecoder(bytes.NewReader(body))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&got); err != nil {
			t.Fatal(err)
		}
		if !got.From.Equal(from) || !got.To.Equal(to) || got.GeneratedAt.IsZero() {
			t.Fatalf("interval/timestamp: %+v", got)
		}
		if got.Nodes == nil || got.Edges == nil || got.Violations == nil {
			t.Fatal("null response arrays")
		}
		for _, n := range got.Nodes {
			if n.Node.Type != "service" && n.Node.ServiceName != "" {
				t.Fatalf("serviceName on a child/resource: %+v", n)
			}
		}
		return got
	}
	put(raw)
	empty := get()
	if len(empty.Nodes) == 0 || len(empty.Edges) != 0 || len(empty.Violations) != 0 {
		t.Fatalf("empty interval: %+v", empty)
	}
	for _, n := range empty.Nodes {
		if !n.Known || n.Observed {
			t.Fatalf("unobserved model node: %+v", n)
		}
	}
	span := func(id, parent, service string, kind model.Kind, start time.Time, attrs map[string]model.Attr) model.Span {
		return model.Span{
			TraceID: "0123456789abcdef0123456789abcdef", SpanID: id, ParentSpanID: parent,
			ServiceName: service, Name: service, Kind: kind, Start: start, End: start.Add(10 * time.Millisecond),
			Status: model.StatusOK, Attributes: attrs,
		}
	}
	attrs := func(method, route string) map[string]model.Attr {
		return map[string]model.Attr{
			"http.request.method": {Type: "string", Value: method},
			"http.route":          {Type: "string", Value: route},
		}
	}
	// Both the owner and the paired server are outside the requested interval.
	spans := []model.Span{
		span(
			"0000000000000001",
			"",
			"checkout",
			model.KindServer,
			from.Add(-time.Second),
			attrs("POST", "/oteldemo.CheckoutService/PlaceOrder"),
		),
		span(
			"0000000000000002",
			"0000000000000001",
			"checkout",
			model.KindClient,
			from,
			attrs("POST", ""),
		),
		span(
			"0000000000000003",
			"0000000000000002",
			"email",
			model.KindServer,
			to,
			attrs("POST", "/send_order_confirmation"),
		),
		span(
			"0000000000000004",
			"",
			"other",
			model.KindClient,
			to,
			attrs("GET", ""),
		),
	}
	spans[1].Status = model.StatusError
	if err := store.New(pool).InsertSpans(t.Context(), spans); err != nil {
		t.Fatal(err)
	}
	check := func(status string, version int64) {
		t.Helper()
		got := get()
		if got.ArchitectureVersion != version || len(got.Edges) != 1 || got.Edges[0].Status != status {
			t.Fatalf("version/edges: %+v", got)
		}
		e := got.Edges[0]
		if e.ObservedOperations != 1 || e.ErrorOperations != 1 || e.AvgDurationMs != 10 ||
			!e.FirstSeenAt.Equal(from) || !e.LastSeenAt.Equal(from) || e.ExampleSpanID != spans[1].SpanID {
			t.Fatalf("anchor metrics: %+v", e)
		}
		if e.Source != nodeid.Endpoint("checkout", "POST", "/oteldemo.CheckoutService/PlaceOrder") ||
			e.Target != nodeid.Endpoint("email", "POST", "/send_order_confirmation") {
			t.Fatalf("lost context outside interval: %+v", e)
		}
		if got.Diagnostics.UnmatchedHTTPClientSpans != 0 || got.Diagnostics.ServiceLevelOperations != 0 {
			t.Fatalf("outside-window anchor was counted: %+v", got.Diagnostics)
		}
		if status == "unexpected" {
			if len(got.Violations) != 1 || got.Violations[0].ExampleTraceID != e.ExampleTraceID {
				t.Fatalf("violation sample: %+v", got.Violations)
			}
		} else if len(got.Violations) != 0 || len(e.MatchedRelationshipIDs) != 1 {
			t.Fatalf("declared edge: %+v", got)
		}
	}
	check("declared", 1)
	for _, interval := range []struct {
		from, to time.Time
		edges    int
	}{
		{from: from.Add(-time.Second), to: from.Add(time.Nanosecond), edges: 1},
		{from: from.Add(time.Nanosecond), to: to, edges: 0},
	} {
		query := url.Values{
			"from": {interval.from.Format(time.RFC3339Nano)},
			"to":   {interval.to.Format(time.RFC3339Nano)},
		}.Encode()
		var got analysis.Result
		if err := json.Unmarshal(request(
			"GET",
			base+"?"+query,
			nil,
			200,
		), &got); err != nil {
			t.Fatal(err)
		}
		if len(got.Edges) != interval.edges {
			t.Fatalf("nanosecond interval: got %d edges want %d", len(got.Edges), interval.edges)
		}
	}
	var doc map[string]any
	if err := json.Unmarshal(saved.Model, &doc); err != nil {
		t.Fatal(err)
	}
	relationships := doc["relationships"].([]any)
	stale := []any{}
	for _, r := range relationships {
		kinds := r.(map[string]any)["relationship-type"].(map[string]any)
		if connects, ok := kinds["connects"].(map[string]any); ok {
			source := connects["source"].(map[string]any)["node"]
			target := connects["destination"].(map[string]any)["node"]
			if source == "checkout" && target == "email" {
				continue
			}
		}
		stale = append(stale, r)
	}
	if len(stale) != len(relationships)-1 {
		t.Fatal("expected checkout-to-email declaration")
	}
	update := func(rels []any) {
		t.Helper()
		doc["relationships"] = rels
		doc["metadata"].(map[string]any)["archdrift"].(map[string]any)["version"] = saved.Version
		body, err := json.Marshal(doc)
		if err != nil {
			t.Fatal(err)
		}
		put(body)
	}
	update(stale)
	check("unexpected", 2)
	update(relationships)
	check("declared", 3)
	pool.Close()
	request(
		"GET",
		path,
		nil,
		503,
	)
}
