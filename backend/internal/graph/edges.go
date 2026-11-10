package graph

import (
	"slices"
	"strings"
	"time"

	"github.com/panchill/ArchDrift/backend/internal/model"
)

const (
	edgeHTTP    = "http_call"
	edgeDB      = "db_query"
	edgePublish = "publish"
	edgeConsume = "consume"
)

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
