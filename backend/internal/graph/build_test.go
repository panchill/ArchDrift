package graph

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/panchill/ArchDrift/backend/internal/model"
	"github.com/panchill/ArchDrift/backend/internal/nodeid"
)

const (
	tr  = "0123456789abcdef0123456789abcdef"
	tr2 = "fedcba9876543210fedcba9876543210"
)

var (
	t0   = time.Date(2026, 11, 10, 12, 0, 0, 0, time.UTC)
	from = t0
	to   = t0.Add(time.Minute)
)

func TestBuild(t *testing.T) {
	cases := []struct {
		name  string
		spans []model.Span
		check func(*testing.T, Graph)
	}{
		{
			name: "http endpoint to endpoint",
			spans: []model.Span{
				sp("01", "", "checkout", model.KindServer, t0, strs("http.request.method", "GET", "http.route", "/checkout")),
				sp("02", "01", "checkout", model.KindClient, t0, strs("http.request.method", "post")),
				sp("03", "02", "payment", model.KindServer, t0, strs("http.request.method", "POST", "http.route", "/charge")),
			},
			check: func(t *testing.T, g Graph) {
				e := mustEdge(t, g, nodeid.Endpoint("checkout", "GET", "/checkout"), nodeid.Endpoint("payment", "POST", "/charge"), "http_call", "")
				if e.ObservedOperations != 1 || e.ErrorOperations != 0 || e.AvgDurationMs != 10 {
					t.Fatalf("метрики: %+v", e)
				}
				if g.Diagnostics != (Diagnostics{}) {
					t.Fatalf("diagnostics: %+v", g.Diagnostics)
				}
				ep := findNode(t, g, e.Source)
				if ep.ParentID != nodeid.Service("checkout") || ep.Method != "GET" || ep.Route != "/checkout" {
					t.Fatalf("endpoint: %+v", ep)
				}
				if !hasNode(g, nodeid.Service("payment")) {
					t.Fatal("нет родительского сервиса payment")
				}
			},
		},
		{
			name: "server does not count as a second call",
			spans: []model.Span{
				sp("02", "", "checkout", model.KindClient, t0, strs("http.request.method", "GET")),
				sp("03", "02", "payment", model.KindServer, t0, strs("http.request.method", "GET", "http.route", "/pay")),
			},
			check: func(t *testing.T, g Graph) {
				if len(g.Edges) != 1 || g.Edges[0].ObservedOperations != 1 {
					t.Fatalf("рёбра: %+v", g.Edges)
				}
				if g.Edges[0].Source != nodeid.Service("checkout") {
					t.Fatalf("владелец без предка — сервис, получили %s", g.Edges[0].Source)
				}
				if g.Diagnostics.ServiceLevelOperations != 1 {
					t.Fatalf("service level: %+v", g.Diagnostics)
				}
			},
		},
		{
			name: "no route falls back to service",
			spans: []model.Span{
				sp("01", "", "checkout", model.KindServer, t0, strs("http.request.method", "GET", "http.route", "/checkout")),
				sp("02", "01", "checkout", model.KindClient, t0, strs("http.request.method", "GET", "archdrift.peer.service", "ignored")),
				sp("03", "02", "payment", model.KindServer, t0, strs("http.request.method", "GET")),
			},
			check: func(t *testing.T, g Graph) {
				e := mustEdge(t, g, nodeid.Endpoint("checkout", "GET", "/checkout"), nodeid.Service("payment"), "http_call", "")
				if e.ObservedOperations != 1 {
					t.Fatal(e)
				}
				if g.Diagnostics.ServiceLevelOperations != 1 || g.Diagnostics.UnmatchedHTTPClientSpans != 0 {
					t.Fatalf("diagnostics: %+v", g.Diagnostics)
				}
			},
		},
		{
			name: "route without slash is not an endpoint",
			spans: []model.Span{
				sp("02", "", "checkout", model.KindClient, t0, strs("http.request.method", "get")),
				sp("03", "02", "frontend", model.KindServer, t0, strs("http.request.method", "GET", "http.route", "home")),
			},
			check: func(t *testing.T, g Graph) {
				mustEdge(t, g, nodeid.Service("checkout"), nodeid.Service("frontend"), "http_call", "")
				if hasNode(g, nodeid.Endpoint("frontend", "GET", "home")) {
					t.Fatal("маршрут без / не должен стать endpoint")
				}
			},
		},
		{
			name: "unmatched client and peer service",
			spans: []model.Span{
				sp("01", "", "checkout", model.KindClient, t0, strs("http.request.method", "POST", "archdrift.worker.name", "orphan")),
				sp("02", "", "checkout", model.KindClient, t0.Add(time.Second), strs("http.request.method", "POST", "archdrift.peer.service", "email")),
			},
			check: func(t *testing.T, g Graph) {
				if g.Diagnostics.UnmatchedHTTPClientSpans != 1 {
					t.Fatalf("unmatched: %+v", g.Diagnostics)
				}
				mustEdge(t, g, nodeid.Service("checkout"), nodeid.Service("email"), "http_call", "")
				if !hasNode(g, nodeid.Worker("checkout", "orphan")) {
					t.Fatal("воркер без ребра всё равно узел")
				}
				if g.Diagnostics.ServiceLevelOperations != 1 {
					t.Fatalf("service level только у ребра с peer: %+v", g.Diagnostics)
				}
			},
		},
		{
			name: "grpc is http_call",
			spans: []model.Span{
				sp("01", "", "checkout", model.KindServer, t0, strs("http.request.method", "POST", "http.route", "/checkout")),
				sp("02", "01", "checkout", model.KindClient, t0, strs("rpc.system.name", "grpc", "rpc.method", "oteldemo.CurrencyService/Convert")),
				sp("03", "02", "currency", model.KindServer, t0, strs("rpc.system", "grpc", "rpc.service", "oteldemo.CurrencyService", "rpc.method", "Convert")),
			},
			check: func(t *testing.T, g Graph) {
				src := nodeid.Endpoint("checkout", "POST", "/checkout")
				dst := nodeid.Endpoint("currency", "POST", "/oteldemo.CurrencyService/Convert")
				e := mustEdge(t, g, src, dst, "http_call", "")
				if e.ObservedOperations != 1 || len(g.Edges) != 1 {
					t.Fatalf("рёбра: %+v", g.Edges)
				}
				if g.Diagnostics != (Diagnostics{}) {
					t.Fatalf("diagnostics: %+v", g.Diagnostics)
				}
			},
		},
		{
			name: "nearest worker beats server, stops at other service and cycle",
			spans: []model.Span{
				sp("01", "", "checkout", model.KindServer, t0, strs("http.request.method", "GET", "http.route", "/api")),
				sp("02", "01", "checkout", model.KindInternal, t0, strs("archdrift.worker.name", "fraud")),
				sp("03", "02", "checkout", model.KindClient, t0, strs("http.request.method", "POST")),
				sp("04", "03", "payment", model.KindServer, t0, strs("http.request.method", "POST", "http.route", "/charge")),
				func() model.Span {
					s := sp("11", "12", "checkout", model.KindClient, t0, strs("http.request.method", "GET", "archdrift.peer.service", "email"))
					return s
				}(),
				sp("12", "11", "checkout", model.KindInternal, t0, nil),
				sp("21", "22", "checkout", model.KindClient, t0, strs("http.request.method", "GET", "archdrift.peer.service", "shipping")),
				sp("22", "", "frontend", model.KindServer, t0, strs("http.request.method", "GET", "http.route", "/home")),
			},
			check: func(t *testing.T, g Graph) {
				mustEdge(t, g, nodeid.Worker("checkout", "fraud"), nodeid.Endpoint("payment", "POST", "/charge"), "http_call", "")
				mustEdge(t, g, nodeid.Service("checkout"), nodeid.Service("email"), "http_call", "")
				mustEdge(t, g, nodeid.Service("checkout"), nodeid.Service("shipping"), "http_call", "")
			},
		},
		{
			name: "ancestor outside the window still owns the call",
			spans: []model.Span{
				sp("01", "", "checkout", model.KindServer, t0.Add(-time.Hour), strs("http.request.method", "GET", "http.route", "/checkout")),
				sp("02", "01", "checkout", model.KindClient, t0, strs("http.request.method", "POST")),
				sp("03", "02", "email", model.KindServer, t0.Add(-time.Minute), strs("http.request.method", "POST", "http.route", "/send")),
				sp("04", "", "quote", model.KindClient, t0.Add(-time.Second), strs("http.request.method", "GET", "archdrift.peer.service", "shipping")),
				sp("05", "", "quote", model.KindServer, to, strs("http.request.method", "GET", "http.route", "/quote")),
				sp("06", "", "ad", model.KindServer, t0, strs("http.request.method", "GET", "http.route", "/ad")),
			},
			check: func(t *testing.T, g Graph) {
				mustEdge(t, g, nodeid.Endpoint("checkout", "GET", "/checkout"), nodeid.Endpoint("email", "POST", "/send"), "http_call", "")
				if len(g.Edges) != 1 {
					t.Fatalf("клиент вне окна не должен дать ребро: %+v", g.Edges)
				}
				if hasNode(g, nodeid.Endpoint("quote", "GET", "/quote")) {
					t.Fatal("start == to уже вне интервала")
				}
				if !hasNode(g, nodeid.Endpoint("ad", "GET", "/ad")) {
					t.Fatal("server в окне создаёт endpoint даже без исходящего ребра")
				}
			},
		},
		{
			name: "postgres operation and missing identity",
			spans: []model.Span{
				sp("01", "", "checkout", model.KindServer, t0, strs("http.request.method", "POST", "http.route", "/checkout")),
				func() model.Span {
					s := sp("02", "01", "checkout", model.KindClient, t0, strs(
						"db.system.name", "postgresql",
						"db.namespace", "otel",
						"archdrift.postgres.instance", "shop",
						"db.operation.name", "select",
					))
					s.Status = model.StatusError
					s.End = s.Start.Add(30 * time.Millisecond)
					return s
				}(),
				sp("03", "01", "checkout", model.KindClient, t0.Add(time.Second), strs(
					"db.system.name", "postgresql",
					"db.namespace", "otel",
					"archdrift.postgres.instance", "shop",
					"db.operation.name", "BEGIN",
				)),
				sp("04", "", "checkout", model.KindClient, t0, strs("db.system.name", "postgresql", "db.namespace", "otel")),
				sp("05", "", "checkout", model.KindClient, t0, strs("db.system.name", "mysql", "db.namespace", "x")),
				sp("06", "", "checkout", model.KindClient, t0, strs(
					"http.request.method", "GET",
					"db.system.name", "postgresql",
					"db.namespace", "otel",
					"archdrift.postgres.instance", "shop",
					"archdrift.peer.service", "frontend",
				)),
			},
			check: func(t *testing.T, g Graph) {
				sel := mustEdge(t, g, nodeid.Endpoint("checkout", "POST", "/checkout"), nodeid.Postgres("shop", "otel"), "db_query", "SELECT")
				if sel.ErrorOperations != 1 || sel.ObservedOperations != 1 || sel.AvgDurationMs != 30 {
					t.Fatalf("select: %+v", sel)
				}
				other := mustEdge(t, g, nodeid.Endpoint("checkout", "POST", "/checkout"), nodeid.Postgres("shop", "otel"), "db_query", "OTHER")
				if other.ObservedOperations != 1 {
					t.Fatal(other)
				}
				if g.Diagnostics.UnresolvedResourceSpans != 1 {
					t.Fatalf("diagnostics: %+v", g.Diagnostics)
				}
				mustEdge(t, g, nodeid.Service("checkout"), nodeid.Service("frontend"), "http_call", "")
				dbEdges := 0
				for _, e := range g.Edges {
					if e.Type == "db_query" {
						dbEdges++
					}
				}
				if dbEdges != 2 {
					t.Fatalf("db рёбер %d: %+v", dbEdges, g.Edges)
				}
			},
		},
		{
			name: "kafka publish and consume are independent",
			spans: []model.Span{
				func() model.Span {
					s := sp("01", "", "checkout", model.KindProducer, t0, strs(
						"messaging.system", "kafka",
						"messaging.operation.type", "send",
						"messaging.destination.name", "orders",
						"archdrift.kafka.cluster", "demo",
					))
					s.TraceID = tr
					s.End = s.Start.Add(4 * time.Millisecond)
					return s
				}(),
				func() model.Span {
					s := sp("02", "", "checkout", model.KindProducer, t0.Add(2*time.Second), strs(
						"messaging.system", "kafka",
						"messaging.operation.type", "send",
						"messaging.destination.name", "orders",
						"archdrift.kafka.cluster", "demo",
					))
					s.Status = model.StatusError
					s.End = s.Start.Add(8 * time.Millisecond)
					return s
				}(),
				func() model.Span {
					s := sp("11", "", "accounting", model.KindConsumer, t0, strs(
						"messaging.system", "kafka",
						"messaging.operation.type", "process",
						"messaging.destination.name", "orders",
						"archdrift.kafka.cluster", "demo",
						"archdrift.worker.name", "invoice",
					))
					s.TraceID = tr2
					return s
				}(),
				func() model.Span {
					s := sp("21", "22", "payment", model.KindConsumer, t0, strs(
						"messaging.system", "kafka",
						"messaging.operation.type", "process",
						"messaging.destination.name", "orders",
						"archdrift.kafka.cluster", "demo",
					))
					s.TraceID = tr2
					return s
				}(),
				func() model.Span {
					s := sp("22", "", "payment", model.KindServer, t0, strs("http.request.method", "POST", "http.route", "/charge"))
					s.TraceID = tr2
					return s
				}(),
				sp("31", "", "checkout", model.KindConsumer, t0, strs("messaging.system", "kafka", "messaging.operation.type", "receive")),
				sp("32", "", "checkout", model.KindProducer, t0, strs("messaging.system", "kafka", "messaging.operation.type", "send", "messaging.destination.name", "orders")),
				sp("33", "", "checkout", model.KindProducer, t0, strs("messaging.system", "kafka", "messaging.operation.type", "create")),
			},
			check: func(t *testing.T, g Graph) {
				pub := mustEdge(t, g, nodeid.Service("checkout"), nodeid.Kafka("demo", "orders"), "publish", "")
				if pub.ObservedOperations != 2 || pub.ErrorOperations != 1 || pub.AvgDurationMs != 6 {
					t.Fatalf("publish: %+v", pub)
				}
				if pub.ExampleSpanID != id(1) || !pub.FirstSeenAt.Equal(t0) || !pub.LastSeenAt.Equal(t0.Add(2*time.Second)) {
					t.Fatalf("пример и время: %+v", pub)
				}
				mustEdge(t, g, nodeid.Kafka("demo", "orders"), nodeid.Worker("accounting", "invoice"), "consume", "")
				mustEdge(t, g, nodeid.Kafka("demo", "orders"), nodeid.Endpoint("payment", "POST", "/charge"), "consume", "")
				if g.Diagnostics.IgnoredMessagingSpans != 2 || g.Diagnostics.UnresolvedResourceSpans != 1 {
					t.Fatalf("diagnostics: %+v", g.Diagnostics)
				}
				if g.Diagnostics.ServiceLevelOperations != 2 {
					t.Fatalf("оба publish без владельца — service level: %+v", g.Diagnostics)
				}
			},
		},
		{
			name: "duplicate span is counted once and nodes are sorted",
			spans: []model.Span{
				sp("02", "", "payment", model.KindClient, t0, strs("http.request.method", "GET", "archdrift.peer.service", "shipping")),
				func() model.Span {
					s := sp("02", "", "payment", model.KindClient, t0, strs("http.request.method", "GET", "archdrift.peer.service", "email"))
					s.Name = "second"
					return s
				}(),
				sp("01", "", "aaa", model.KindServer, t0, strs("http.request.method", "GET", "http.route", "/a")),
			},
			check: func(t *testing.T, g Graph) {
				e := mustEdge(t, g, nodeid.Service("payment"), nodeid.Service("shipping"), "http_call", "")
				if e.ObservedOperations != 1 {
					t.Fatal(e)
				}
				if hasNode(g, nodeid.Service("email")) {
					t.Fatal("вторая запись того же спана не должна победить")
				}
				for i := 1; i < len(g.Nodes); i++ {
					if g.Nodes[i-1].ID > g.Nodes[i].ID {
						t.Fatalf("узлы не отсортированы: %s затем %s", g.Nodes[i-1].ID, g.Nodes[i].ID)
					}
				}
			},
		},
		{
			name: "long label is clipped",
			spans: []model.Span{
				sp("01", "", strings.Repeat("я", 300), model.KindServer, t0, strs("http.request.method", "GET", "http.route", "/x")),
			},
			check: func(t *testing.T, g Graph) {
				n := findNode(t, g, nodeid.Service(strings.Repeat("я", 300)))
				if len([]rune(n.Label)) != 255 {
					t.Fatalf("label %d", len([]rune(n.Label)))
				}
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			g := Build(tc.spans, from, to)
			tc.check(t, g)
		})
	}
}

func sp(span, parent, service string, kind model.Kind, start time.Time, attrs map[string]model.Attr) model.Span {
	if attrs == nil {
		attrs = map[string]model.Attr{}
	}
	return model.Span{
		TraceID:      tr,
		SpanID:       id(unhex(span)),
		ParentSpanID: parentID(parent),
		ServiceName:  service,
		Name:         service,
		Kind:         kind,
		Start:        start,
		End:          start.Add(10 * time.Millisecond),
		Status:       model.StatusOK,
		Attributes:   attrs,
	}
}

func parentID(parent string) string {
	if parent == "" {
		return ""
	}
	return id(unhex(parent))
}

func unhex(s string) byte {
	var n byte
	fmt.Sscanf(s, "%x", &n)
	return n
}

func id(n byte) string {
	return fmt.Sprintf("%016x", n)
}

func strs(kv ...string) map[string]model.Attr {
	m := make(map[string]model.Attr, len(kv)/2)
	for i := 0; i < len(kv); i += 2 {
		m[kv[i]] = model.Attr{Type: "string", Value: kv[i+1]}
	}
	return m
}

func mustEdge(t *testing.T, g Graph, source, target, typ, op string) Edge {
	t.Helper()
	for _, e := range g.Edges {
		if e.Source == source && e.Target == target && e.Type == typ && e.DBOperation == op {
			return e
		}
	}
	t.Fatalf("нет ребра %s -> %s %s %q среди %+v", source, target, typ, op, g.Edges)
	return Edge{}
}

func hasNode(g Graph, id string) bool {
	for _, n := range g.Nodes {
		if n.ID == id {
			return true
		}
	}
	return false
}

func findNode(t *testing.T, g Graph, id string) Node {
	t.Helper()
	for _, n := range g.Nodes {
		if n.ID == id {
			return n
		}
	}
	t.Fatalf("нет узла %s", id)
	return Node{}
}
