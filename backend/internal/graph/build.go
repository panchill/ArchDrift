// Package graph строит фактический граф из спанов.
// Сопоставление с CALM здесь не делается — это сравнение в анализе.
// Правила — раздел instrumentation в instrumentation.yaml.
package graph

import (
	"slices"
	"strings"
	"time"

	"github.com/panchill/ArchDrift/backend/internal/model"
	"github.com/panchill/ArchDrift/backend/internal/nodeid"
)

const (
	edgeHTTP    = "http_call"
	edgeDB      = "db_query"
	edgePublish = "publish"
	edgeConsume = "consume"
)

// Node — наблюдаемый узел. known и статус ребра появляются при сравнении с моделью.
type Node struct {
	ID          string
	Label       string
	Type        string
	ParentID    string
	ServiceName string
	Method      string
	Route       string
	WorkerName  string
	Instance    string
	Database    string
	Cluster     string
	Topic       string
}

// Edge — агрегат опорных спанов. Ключ: source, target, type, dbOperation.
type Edge struct {
	Source             string
	Target             string
	Type               string
	DBOperation        string
	ObservedOperations int
	ErrorOperations    int
	AvgDurationMs      float64
	FirstSeenAt        time.Time
	LastSeenAt         time.Time
	ExampleTraceID     string
	ExampleSpanID      string
}

// Diagnostics — ограничения наблюдения, не нарушения архитектуры.
type Diagnostics struct {
	UnmatchedHTTPClientSpans int
	ServiceLevelOperations   int
	UnresolvedResourceSpans  int
	IgnoredMessagingSpans    int
}

// Graph — фактический граф за интервал [from, to).
type Graph struct {
	Nodes       []Node
	Edges       []Edge
	Diagnostics Diagnostics
}

type ref struct {
	kind     string
	service  string
	method   string
	route    string
	worker   string
	instance string
	database string
	cluster  string
	topic    string
}

type edgeKey struct {
	source, target, typ, op string
}

type acc struct {
	count  int
	errors int
	durSum float64
	first  time.Time
	last   time.Time
	sample model.Span
}

// Build строит граф. spans — все сохранённые спаны: опорные отбираются по start
// в [from, to), предки и парный SERVER ищутся среди всех переданных.
// Повтор (trace, span) не учитывается: побеждает первая запись.
func Build(spans []model.Span, from, to time.Time) Graph {
	index := make(map[string]model.Span, len(spans))
	for _, sp := range spans {
		if sp.TraceID == "" || sp.SpanID == "" || sp.ServiceName == "" {
			continue
		}
		key := sp.TraceID + "\x00" + sp.SpanID
		if _, ok := index[key]; !ok {
			index[key] = sp
		}
	}
	servers := make(map[string]model.Span)
	for _, sp := range index {
		if sp.Kind != model.KindServer {
			continue
		}
		if _, _, ok := httpView(sp); !ok {
			continue
		}
		key := sp.TraceID + "\x00" + sp.ParentSpanID
		if prev, ok := servers[key]; !ok || sp.SpanID < prev.SpanID {
			servers[key] = sp
		}
	}

	nodes := map[string]Node{}
	edges := map[edgeKey]*acc{}
	var diag Diagnostics

	for _, sp := range index {
		if !inWindow(sp.Start, from, to) {
			continue
		}
		if name, ok := sp.StringAttr("archdrift.worker.name"); ok {
			addRef(nodes, ref{kind: "worker", service: sp.ServiceName, worker: name})
		}
		if sp.Kind != model.KindServer {
			continue
		}
		method, route, ok := httpView(sp)
		if !ok {
			continue
		}
		if method != "" && route != "" {
			addRef(nodes, ref{kind: "endpoint", service: sp.ServiceName, method: method, route: route})
			continue
		}
		addRef(nodes, ref{kind: "service", service: sp.ServiceName})
	}

	for _, sp := range index {
		if !inWindow(sp.Start, from, to) {
			continue
		}
		switch {
		case sp.Kind == model.KindClient && isHTTP(sp):
			addHTTP(sp, index, servers, nodes, edges, &diag)
		case sp.Kind == model.KindClient && isPostgres(sp):
			addDB(sp, index, nodes, edges, &diag)
		case isKafka(sp):
			addKafka(sp, index, nodes, edges, &diag)
		}
	}
	return materialize(nodes, edges, diag)
}

func addHTTP(sp model.Span, index, servers map[string]model.Span, nodes map[string]Node, edges map[edgeKey]*acc, diag *Diagnostics) {
	var target ref
	if srv, ok := servers[sp.TraceID+"\x00"+sp.SpanID]; ok {
		method, route, _ := httpView(srv)
		if method != "" && route != "" {
			target = ref{kind: "endpoint", service: srv.ServiceName, method: method, route: route}
		} else {
			target = ref{kind: "service", service: srv.ServiceName}
		}
	} else if peer, ok := sp.StringAttr("archdrift.peer.service"); ok {
		target = ref{kind: "service", service: peer}
	} else {
		diag.UnmatchedHTTPClientSpans++
		return
	}
	owner := resolveOwner(sp, index, false)
	addEdge(nodes, edges, owner, target, edgeHTTP, "", sp)
	if serviceLevel(owner, target, edgeHTTP) {
		diag.ServiceLevelOperations++
	}
}

func addDB(sp model.Span, index map[string]model.Span, nodes map[string]Node, edges map[edgeKey]*acc, diag *Diagnostics) {
	dbName, okDB := sp.StringAttr("db.namespace")
	instance, okInst := sp.StringAttr("archdrift.postgres.instance")
	if !okDB || !okInst {
		diag.UnresolvedResourceSpans++
		return
	}
	owner := resolveOwner(sp, index, false)
	target := ref{kind: "postgres", instance: instance, database: dbName}
	addEdge(nodes, edges, owner, target, edgeDB, dbOperation(sp), sp)
	if serviceLevel(owner, target, edgeDB) {
		diag.ServiceLevelOperations++
	}
}

func addKafka(sp model.Span, index map[string]model.Span, nodes map[string]Node, edges map[edgeKey]*acc, diag *Diagnostics) {
	op, _ := sp.StringAttr("messaging.operation.type")
	publish := sp.Kind == model.KindProducer && op == "send"
	consume := sp.Kind == model.KindConsumer && op == "process"
	if !publish && !consume {
		diag.IgnoredMessagingSpans++
		return
	}
	topic, okTopic := sp.StringAttr("messaging.destination.name")
	cluster, okCluster := sp.StringAttr("archdrift.kafka.cluster")
	if !okTopic || !okCluster {
		diag.UnresolvedResourceSpans++
		return
	}
	topicRef := ref{kind: "kafka", cluster: cluster, topic: topic}
	owner := resolveOwner(sp, index, consume)
	if publish {
		addEdge(nodes, edges, owner, topicRef, edgePublish, "", sp)
		if serviceLevel(owner, topicRef, edgePublish) {
			diag.ServiceLevelOperations++
		}
		return
	}
	addEdge(nodes, edges, topicRef, owner, edgeConsume, "", sp)
	if serviceLevel(owner, topicRef, edgeConsume) {
		diag.ServiceLevelOperations++
	}
}

func serviceLevel(owner, target ref, edgeType string) bool {
	if owner.kind == "service" {
		return true
	}
	return edgeType == edgeHTTP && target.kind == "service"
}

func resolveOwner(sp model.Span, index map[string]model.Span, selfFirst bool) ref {
	if selfFirst {
		if owner, ok := asOwner(sp); ok {
			return owner
		}
	}
	seen := map[string]bool{sp.SpanID: true}
	cur := sp
	for {
		if cur.ParentSpanID == "" || seen[cur.ParentSpanID] {
			break
		}
		seen[cur.ParentSpanID] = true
		parent, ok := index[sp.TraceID+"\x00"+cur.ParentSpanID]
		if !ok || parent.ServiceName != sp.ServiceName {
			break
		}
		if owner, ok := asOwner(parent); ok {
			return owner
		}
		cur = parent
	}
	return ref{kind: "service", service: sp.ServiceName}
}

func asOwner(sp model.Span) (ref, bool) {
	if name, ok := sp.StringAttr("archdrift.worker.name"); ok {
		return ref{kind: "worker", service: sp.ServiceName, worker: name}, true
	}
	if sp.Kind != model.KindServer {
		return ref{}, false
	}
	method, route, ok := httpView(sp)
	if !ok || method == "" || route == "" {
		return ref{}, false
	}
	return ref{kind: "endpoint", service: sp.ServiceName, method: method, route: route}, true
}

func addEdge(nodes map[string]Node, edges map[edgeKey]*acc, source, target ref, edgeType, op string, sp model.Span) {
	key := edgeKey{
		source: addRef(nodes, source),
		target: addRef(nodes, target),
		typ:    edgeType,
		op:     op,
	}
	slot := edges[key]
	if slot == nil {
		slot = &acc{}
		edges[key] = slot
	}
	slot.add(sp)
}

func (a *acc) add(sp model.Span) {
	if a.count == 0 || earlier(sp, a.sample) {
		a.sample = sp
	}
	if a.count == 0 || sp.Start.Before(a.first) {
		a.first = sp.Start
	}
	if a.count == 0 || sp.Start.After(a.last) {
		a.last = sp.Start
	}
	a.count++
	a.durSum += durationMs(sp)
	if sp.Status == model.StatusError {
		a.errors++
	}
}

func earlier(a, b model.Span) bool {
	if a.Start.Before(b.Start) {
		return true
	}
	if b.Start.Before(a.Start) {
		return false
	}
	if a.TraceID != b.TraceID {
		return a.TraceID < b.TraceID
	}
	return a.SpanID < b.SpanID
}

func durationMs(sp model.Span) float64 {
	d := sp.End.Sub(sp.Start)
	if d < 0 {
		return 0
	}
	return float64(d) / float64(time.Millisecond)
}

func addRef(nodes map[string]Node, r ref) string {
	switch r.kind {
	case "endpoint":
		parent := addRef(nodes, ref{kind: "service", service: r.service})
		id := nodeid.Endpoint(r.service, r.method, r.route)
		putNode(nodes, Node{
			ID: id, Type: "endpoint", Label: clip(r.method + " " + r.route),
			ParentID: parent, ServiceName: r.service, Method: r.method, Route: r.route,
		})
		return id
	case "worker":
		parent := addRef(nodes, ref{kind: "service", service: r.service})
		id := nodeid.Worker(r.service, r.worker)
		putNode(nodes, Node{
			ID: id, Type: "worker", Label: clip(r.worker),
			ParentID: parent, ServiceName: r.service, WorkerName: r.worker,
		})
		return id
	case "postgres":
		id := nodeid.Postgres(r.instance, r.database)
		putNode(nodes, Node{
			ID: id, Type: "postgres_database", Label: clip(r.instance + "/" + r.database),
			Instance: r.instance, Database: r.database,
		})
		return id
	case "kafka":
		id := nodeid.Kafka(r.cluster, r.topic)
		putNode(nodes, Node{
			ID: id, Type: "kafka_topic", Label: clip(r.topic),
			Cluster: r.cluster, Topic: r.topic,
		})
		return id
	default:
		id := nodeid.Service(r.service)
		putNode(nodes, Node{ID: id, Type: "service", Label: clip(r.service), ServiceName: r.service})
		return id
	}
}

func putNode(nodes map[string]Node, n Node) {
	if _, ok := nodes[n.ID]; ok {
		return
	}
	nodes[n.ID] = n
}

func clip(s string) string {
	r := []rune(s)
	if len(r) <= 255 {
		return s
	}
	return string(r[:255])
}

func materialize(nodes map[string]Node, edges map[edgeKey]*acc, diag Diagnostics) Graph {
	outNodes := make([]Node, 0, len(nodes))
	for _, n := range nodes {
		outNodes = append(outNodes, n)
	}
	slices.SortFunc(outNodes, func(a, b Node) int { return strings.Compare(a.ID, b.ID) })

	outEdges := make([]Edge, 0, len(edges))
	for key, slot := range edges {
		outEdges = append(outEdges, Edge{
			Source:             key.source,
			Target:             key.target,
			Type:               key.typ,
			DBOperation:        key.op,
			ObservedOperations: slot.count,
			ErrorOperations:    slot.errors,
			AvgDurationMs:      slot.durSum / float64(slot.count),
			FirstSeenAt:        slot.first,
			LastSeenAt:         slot.last,
			ExampleTraceID:     slot.sample.TraceID,
			ExampleSpanID:      slot.sample.SpanID,
		})
	}
	slices.SortFunc(outEdges, func(a, b Edge) int {
		if c := strings.Compare(a.Source, b.Source); c != 0 {
			return c
		}
		if c := strings.Compare(a.Target, b.Target); c != 0 {
			return c
		}
		if c := strings.Compare(a.Type, b.Type); c != 0 {
			return c
		}
		return strings.Compare(a.DBOperation, b.DBOperation)
	})
	return Graph{Nodes: outNodes, Edges: outEdges, Diagnostics: diag}
}

func inWindow(ts, from, to time.Time) bool {
	return !ts.Before(from) && ts.Before(to)
}

func isHTTP(sp model.Span) bool {
	_, _, ok := httpView(sp)
	return ok
}

func isPostgres(sp model.Span) bool {
	system, ok := sp.StringAttr("db.system.name")
	return ok && system == "postgresql"
}

func isKafka(sp model.Span) bool {
	system, ok := sp.StringAttr("messaging.system")
	return ok && system == "kafka"
}

func dbOperation(sp model.Span) string {
	raw, ok := sp.StringAttr("db.operation.name")
	if !ok {
		return "OTHER"
	}
	switch strings.ToUpper(raw) {
	case "SELECT", "INSERT", "UPDATE", "DELETE":
		return strings.ToUpper(raw)
	default:
		return "OTHER"
	}
}

// httpView описывает HTTP-спан. gRPC без http.request.method — это POST и маршрут
// /<package.Service>/<Method>. route пустой, если шаблон не восстановить.
func httpView(sp model.Span) (method, route string, ok bool) {
	if m, has := sp.StringAttr("http.request.method"); has {
		route, _ = sp.StringAttr("http.route")
		if route != "" && !strings.HasPrefix(route, "/") {
			route = ""
		}
		return strings.ToUpper(m), route, true
	}
	if !isGRPC(sp) {
		return "", "", false
	}
	route, _ = grpcRoute(sp)
	return "POST", route, true
}

func isGRPC(sp model.Span) bool {
	if v, ok := sp.StringAttr("rpc.system"); ok && v == "grpc" {
		return true
	}
	v, ok := sp.StringAttr("rpc.system.name")
	return ok && v == "grpc"
}

func grpcRoute(sp model.Span) (string, bool) {
	method, ok := sp.StringAttr("rpc.method")
	if !ok {
		return "", false
	}
	method = strings.TrimPrefix(method, "/")
	if method == "" {
		return "", false
	}
	if strings.Contains(method, "/") {
		return "/" + method, true
	}
	service, ok := sp.StringAttr("rpc.service")
	if !ok {
		return "", false
	}
	service = strings.Trim(service, "/")
	if service == "" {
		return "", false
	}
	return "/" + service + "/" + method, true
}
