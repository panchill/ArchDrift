package graph

import (
	"time"

	"github.com/panchill/ArchDrift/backend/internal/model"
)

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

func inWindow(ts, from, to time.Time) bool {
	return !ts.Before(from) && ts.Before(to)
}
