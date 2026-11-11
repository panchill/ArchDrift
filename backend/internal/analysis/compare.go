// Package analysis compares observed interactions with resolved CALM declarations.
package analysis

import (
	"cmp"
	"fmt"
	"slices"
	"time"

	"github.com/panchill/ArchDrift/backend/internal/architecture"
	"github.com/panchill/ArchDrift/backend/internal/graph"
)

type Node struct {
	Node            graph.Node `json:"node"`
	Known           bool       `json:"known"`
	Observed        bool       `json:"observed"`
	CalmNodeID      string     `json:"calmNodeId,omitempty"`
	CalmInterfaceID string     `json:"calmInterfaceId,omitempty"`
}

type Edge struct {
	graph.Edge
	Status                 string   `json:"status"`
	MatchedRelationshipIDs []string `json:"matchedRelationshipIds"`
}

type Violation struct {
	Type           string `json:"type"`
	Source         string `json:"source"`
	Target         string `json:"target"`
	EdgeType       string `json:"edgeType"`
	DBOperation    string `json:"dbOperation,omitempty"`
	Message        string `json:"message"`
	ExampleTraceID string `json:"exampleTraceId"`
	ExampleSpanID  string `json:"exampleSpanId"`
}

type Result struct {
	ArchitectureVersion int64             `json:"architectureVersion"`
	From                time.Time         `json:"from"`
	To                  time.Time         `json:"to"`
	GeneratedAt         time.Time         `json:"generatedAt"`
	Nodes               []Node            `json:"nodes"`
	Edges               []Edge            `json:"edges"`
	Violations          []Violation       `json:"violations"`
	Diagnostics         graph.Diagnostics `json:"diagnostics"`
}

func Compare(model *architecture.Model, observed graph.Graph) Result {
	nodes := make(map[string]Node, len(model.Nodes)+len(observed.Nodes))
	for _, n := range observed.Nodes {
		nodes[n.ID] = Node{Node: n, Observed: true}
	}
	for _, n := range model.Nodes {
		nodes[n.ID] = Node{
			Node: n.Node, Known: true, Observed: nodes[n.ID].Observed,
			CalmNodeID: n.CalmNodeID, CalmInterfaceID: n.CalmInterfaceID,
		}
	}
	out := Result{
		ArchitectureVersion: model.Version, Diagnostics: observed.Diagnostics,
		Nodes: make([]Node, 0, len(nodes)), Edges: make([]Edge, 0, len(observed.Edges)),
		Violations: []Violation{},
	}
	for _, n := range nodes {
		out.Nodes = append(out.Nodes, n)
	}
	slices.SortFunc(out.Nodes, func(a, b Node) int { return cmp.Compare(a.Node.ID, b.Node.ID) })
	for _, e := range observed.Edges {
		edge := Edge{Edge: e, Status: "unexpected", MatchedRelationshipIDs: []string{}}
		for _, r := range model.Relationships {
			if !slices.Contains(r.Types, e.Type) {
				continue
			}
			source := matchEnd(r.Sources, nodes[e.Source].Node, nodes)
			target := matchEnd(r.Targets, nodes[e.Target].Node, nodes)
			if source == 2 && target == 2 {
				edge.MatchedRelationshipIDs = append(edge.MatchedRelationshipIDs, r.ID)
			}
			if source > 0 && target > 0 {
				edge.Status = "indeterminate"
			}
		}
		if len(edge.MatchedRelationshipIDs) > 0 {
			edge.Status = "declared"
			slices.Sort(edge.MatchedRelationshipIDs)
		}
		out.Edges = append(out.Edges, edge)
	}
	slices.SortFunc(out.Edges, func(a, b Edge) int {
		return cmp.Or(
			cmp.Compare(a.Source, b.Source),
			cmp.Compare(a.Target, b.Target),
			cmp.Compare(a.Type, b.Type),
			cmp.Compare(a.DBOperation, b.DBOperation),
		)
	})
	// Every violation has the same type, so edge order is also violation order.
	for _, e := range out.Edges {
		if e.Status != "unexpected" {
			continue
		}
		action := "вызывает"
		switch e.Type {
		case "db_query":
			action = "обращается к базе"
		case "publish":
			action = "публикует сообщения в"
		case "consume":
			action = "передаёт сообщения обработчику"
		}
		out.Violations = append(out.Violations, Violation{
			Type: "unexpected_edge", Source: e.Source, Target: e.Target, EdgeType: e.Type,
			DBOperation: e.DBOperation, ExampleTraceID: e.ExampleTraceID, ExampleSpanID: e.ExampleSpanID,
			Message: fmt.Sprintf(
				"%s %s %s — такой связи нет в модели",
				displayName(nodes[e.Source].Node, nodes),
				action,
				displayName(nodes[e.Target].Node, nodes),
			),
		})
	}
	return out
}

// matchEnd returns 0 for incompatible, 1 for a possible fallback refinement,
// and 2 for a full match. Alternatives belong to a single relationship end.
func matchEnd(selectors []string, actual graph.Node, nodes map[string]Node) int {
	match := 0
	for _, id := range selectors {
		declared := nodes[id].Node
		if id == actual.ID || (declared.Type == "service" && actual.ParentID == id) {
			return 2
		}
		if actual.Type == "service" && declared.ParentID == actual.ID {
			match = 1
		}
	}
	return match
}

func displayName(n graph.Node, nodes map[string]Node) string {
	if n.ParentID != "" {
		return nodes[n.ParentID].Node.Label + " (" + n.Label + ")"
	}
	return n.Label
}
