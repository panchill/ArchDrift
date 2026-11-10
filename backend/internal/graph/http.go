package graph

import (
	"strings"

	"github.com/panchill/ArchDrift/backend/internal/model"
)

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

func isHTTP(sp model.Span) bool {
	_, _, ok := httpView(sp)
	return ok
}

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
