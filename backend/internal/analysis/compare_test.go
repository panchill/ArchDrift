package analysis

import (
	"encoding/json"
	"os"
	"slices"
	"testing"

	"github.com/panchill/ArchDrift/backend/internal/architecture"
	"github.com/panchill/ArchDrift/backend/internal/graph"
)

func TestCompare(t *testing.T) {
	nodes := []architecture.Node{
		{Node: graph.Node{ID: "a", Type: "service", Label: "Checkout"}, CalmNodeID: "calm-a"},
		{Node: graph.Node{ID: "b", Type: "service", Label: "Email"}, CalmNodeID: "calm-b"},
		{Node: graph.Node{ID: "ae", Type: "endpoint", ParentID: "a"}, CalmNodeID: "calm-a", CalmInterfaceID: "api"},
		{Node: graph.Node{ID: "be", Type: "endpoint", ParentID: "b"}, CalmNodeID: "calm-b", CalmInterfaceID: "send"},
		{Node: graph.Node{ID: "aw", Type: "worker", ParentID: "a"}, CalmNodeID: "calm-worker"},
		{Node: graph.Node{ID: "db", Type: "postgres_database"}, CalmNodeID: "calm-db"},
		{Node: graph.Node{ID: "topic", Type: "kafka_topic"}, CalmNodeID: "calm-topic"},
	}
	rel := func(id, source, target, kind string) architecture.Relationship {
		return architecture.Relationship{ID: id, Sources: []string{source}, Targets: []string{target}, Types: []string{kind}}
	}
	broad := rel(
		"broad",
		"a",
		"b",
		"http_call",
	)
	narrow := rel(
		"narrow",
		"ae",
		"be",
		"http_call",
	)
	cases := []struct {
		name, source, target, kind, status string
		rels                               []architecture.Relationship
		ids                                []string
	}{
		{
			name:   "service covers itself",
			source: "a",
			target: "b",
			kind:   "http_call",
			status: "declared",
			rels:   []architecture.Relationship{broad},
			ids:    []string{"broad"},
		},
		{
			name:   "service covers endpoints",
			source: "ae",
			target: "be",
			kind:   "http_call",
			status: "declared",
			rels:   []architecture.Relationship{broad},
			ids:    []string{"broad"},
		},
		{
			name:   "service covers worker",
			source: "aw",
			target: "be",
			kind:   "http_call",
			status: "declared",
			rels:   []architecture.Relationship{broad},
			ids:    []string{"broad"},
		},
		{
			name:   "unknown child covered",
			source: "unknown",
			target: "be",
			kind:   "http_call",
			status: "declared",
			rels:   []architecture.Relationship{broad},
			ids:    []string{"broad"},
		},
		{
			name:   "all exact matches sorted",
			source: "ae",
			target: "be",
			kind:   "http_call",
			status: "declared",
			rels:   []architecture.Relationship{narrow, broad},
			ids:    []string{"broad", "narrow"},
		},
		{
			name:   "source fallback",
			source: "a",
			target: "be",
			kind:   "http_call",
			status: "indeterminate",
			rels:   []architecture.Relationship{narrow},
		},
		{
			name:   "target fallback",
			source: "ae",
			target: "b",
			kind:   "http_call",
			status: "indeterminate",
			rels:   []architecture.Relationship{narrow},
		},
		{
			name:   "both fallback",
			source: "a",
			target: "b",
			kind:   "http_call",
			status: "indeterminate",
			rels:   []architecture.Relationship{narrow},
		},
		{
			name:   "broad wins over possible",
			source: "a",
			target: "b",
			kind:   "http_call",
			status: "declared",
			rels:   []architecture.Relationship{narrow, broad},
			ids:    []string{"broad"},
		},
		{
			name:   "known opposite incompatible",
			source: "a",
			target: "ae",
			kind:   "http_call",
			status: "unexpected",
			rels:   []architecture.Relationship{narrow},
		},
		{
			name:   "different concrete child",
			source: "unknown",
			target: "be",
			kind:   "http_call",
			status: "unexpected",
			rels:   []architecture.Relationship{narrow},
		},
		{
			name:   "reverse not implied",
			source: "b",
			target: "a",
			kind:   "http_call",
			status: "unexpected",
			rels:   []architecture.Relationship{broad},
		},
		{
			name:   "transitive not implied",
			source: "a",
			target: "db",
			kind:   "db_query",
			status: "unexpected",
			rels: []architecture.Relationship{broad, rel(
				"db",
				"b",
				"db",
				"db_query",
			)},
		},
		{
			name:   "wrong operation",
			source: "a",
			target: "b",
			kind:   "publish",
			status: "unexpected",
			rels:   []architecture.Relationship{broad},
		},
		{
			name:   "database exact",
			source: "ae",
			target: "db",
			kind:   "db_query",
			status: "declared",
			rels: []architecture.Relationship{rel(
				"db",
				"a",
				"db",
				"db_query",
			)},
			ids: []string{"db"},
		},
		{
			name:   "resource mismatch",
			source: "a",
			target: "other-db",
			kind:   "db_query",
			status: "unexpected",
			rels: []architecture.Relationship{rel(
				"db",
				"a",
				"db",
				"db_query",
			)},
		},
		{
			name:   "publish",
			source: "aw",
			target: "topic",
			kind:   "publish",
			status: "declared",
			rels: []architecture.Relationship{rel(
				"pub",
				"aw",
				"topic",
				"publish",
			)},
			ids: []string{"pub"},
		},
		{
			name:   "consume fallback",
			source: "topic",
			target: "a",
			kind:   "consume",
			status: "indeterminate",
			rels: []architecture.Relationship{rel(
				"consume",
				"topic",
				"aw",
				"consume",
			)},
		},
		{
			name:   "no declarations",
			source: "a",
			target: "b",
			kind:   "http_call",
			status: "unexpected",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			observed := graph.Graph{Nodes: []graph.Node{}, Edges: []graph.Edge{{
				Source: tc.source, Target: tc.target, Type: tc.kind,
				ExampleTraceID: "trace", ExampleSpanID: "span", ObservedOperations: 2,
			}}}
			for _, n := range nodes {
				if n.ID == tc.source || n.ID == tc.target {
					observed.Nodes = append(observed.Nodes, n.Node)
				}
			}
			observed.Nodes = append(observed.Nodes,
				graph.Node{ID: "unknown", Type: "endpoint", ParentID: "a"},
				graph.Node{ID: "other-db", Type: "postgres_database"})
			got := Compare(&architecture.Model{Version: 3, Nodes: nodes, Relationships: tc.rels}, observed)
			if len(got.Edges) != 1 {
				t.Fatalf("edges: %+v", got.Edges)
			}
			e := got.Edges[0]
			if e.Status != tc.status || !slices.Equal(e.MatchedRelationshipIDs, tc.ids) {
				t.Fatalf("edges: %+v", got.Edges)
			}
			if got.Edges[0].MatchedRelationshipIDs == nil || got.Violations == nil {
				t.Fatal("JSON arrays must not be null")
			}
			wantViolations := 0
			if tc.status == "unexpected" {
				wantViolations = 1
			}
			if len(got.Violations) != wantViolations {
				t.Fatalf("violations: %+v", got.Violations)
			}
			if wantViolations > 0 {
				v := got.Violations[0]
				if v.Type != "unexpected_edge" || v.ExampleTraceID != "trace" || v.ExampleSpanID != "span" || v.Message == "" {
					t.Fatalf("violation: %+v", v)
				}
			}
			for _, n := range got.Nodes {
				if n.Node.ID == "unknown" && (n.Known || n.CalmNodeID != "" || n.CalmInterfaceID != "" || !n.Observed) {
					t.Fatalf("unknown node: %+v", n)
				}
				if n.Node.ID == "ae" && (!n.Known || n.CalmNodeID != "calm-a" || n.CalmInterfaceID != "api") {
					t.Fatalf("exact binding: %+v", n)
				}
			}
		})
	}
}

func TestCompareFrontendFixture(t *testing.T) {
	read := func(path string, dst any) {
		t.Helper()
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if err := json.Unmarshal(raw, dst); err != nil {
			t.Fatal(err)
		}
	}
	var snapshot architecture.Snapshot
	var fixture Result
	read("../../../frontend/public/mocks/architecture.json", &snapshot)
	read("../../../frontend/public/mocks/analysis.json", &fixture)
	validator, err := architecture.NewValidator()
	if err != nil {
		t.Fatal(err)
	}
	declared, err := validator.Parse(snapshot.Model)
	if err != nil {
		t.Fatal(err)
	}
	observed := graph.Graph{Nodes: []graph.Node{}, Edges: []graph.Edge{}, Diagnostics: fixture.Diagnostics}
	for _, n := range fixture.Nodes {
		if n.Observed {
			observed.Nodes = append(observed.Nodes, n.Node)
		}
	}
	for _, e := range fixture.Edges {
		observed.Edges = append(observed.Edges, e.Edge)
	}
	slices.Reverse(observed.Edges) // Compare must sort independently of input order.
	got := Compare(declared, observed)
	if len(got.Edges) != len(fixture.Edges) || len(got.Violations) != len(fixture.Violations) ||
		len(got.Nodes) != len(fixture.Nodes) || got.Diagnostics != fixture.Diagnostics {
		t.Fatalf("fixture shape/diagnostics differ: %+v", got)
	}
	for i, e := range got.Edges {
		want := fixture.Edges[i]
		sameMatches := slices.Equal(e.MatchedRelationshipIDs, want.MatchedRelationshipIDs)
		if e.Edge != want.Edge || e.Status != want.Status || !sameMatches {
			t.Fatalf(
				"edge %d: got %+v want %+v",
				i,
				e,
				want,
			)
		}
	}
	for i, n := range got.Nodes {
		if n != fixture.Nodes[i] {
			t.Fatalf(
				"node %d: got %+v want %+v",
				i,
				n,
				fixture.Nodes[i],
			)
		}
	}
}

func TestCompareNoObservations(t *testing.T) {
	m := &architecture.Model{Version: 7, Nodes: []architecture.Node{
		{Node: graph.Node{ID: "z", Label: "Declared label", Type: "service"}, CalmNodeID: "calm-z"},
		{Node: graph.Node{ID: "a", Type: "service"}, CalmNodeID: "calm-a"},
	}}
	got := Compare(m, graph.Graph{})
	if got.ArchitectureVersion != 7 || len(got.Edges) != 0 || len(got.Violations) != 0 || len(got.Nodes) != 2 {
		t.Fatalf("empty analysis: %+v", got)
	}
	if got.Nodes[0].Node.ID != "a" || got.Nodes[1].Observed || !got.Nodes[1].Known {
		t.Fatalf("model nodes: %+v", got.Nodes)
	}
	got = Compare(m, graph.Graph{Nodes: []graph.Node{{ID: "z", Label: "Observed label", Type: "service"}}})
	if got.Nodes[1].Node.Label != "Declared label" || !got.Nodes[1].Observed {
		t.Fatalf("declared label/observed flag: %+v", got.Nodes[1])
	}
}
