package graph

import (
	"github.com/panchill/ArchDrift/backend/internal/model"
)

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
