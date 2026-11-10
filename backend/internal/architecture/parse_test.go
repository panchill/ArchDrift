package architecture

import (
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"
)

func parseDocument(t *testing.T, raw []byte) (*Model, []Detail) {
	t.Helper()
	validator, err := NewValidator()
	if err != nil {
		t.Fatal(err)
	}
	model, err := validator.Parse(raw)
	if err == nil {
		return model, []Detail{}
	}
	validation, ok := errors.AsType[*ValidationError](err)
	if !ok {
		t.Fatalf("unexpected parsing error: %v", err)
	}
	return nil, validation.Details
}

func fixture(t *testing.T) map[string]any {
	t.Helper()
	raw, err := os.ReadFile("testdata/profile.json")
	if err != nil {
		t.Fatal(err)
	}
	var model map[string]any
	if err := json.Unmarshal(raw, &model); err != nil {
		t.Fatal(err)
	}
	return model
}

func TestParseDemo(t *testing.T) {
	raw, err := os.ReadFile("../../../examples/opentelemetry-demo.architecture.json")
	if err != nil {
		t.Fatal(err)
	}
	m, details := parseDocument(t, raw)
	if len(details) != 0 {
		t.Fatal(details)
	}
	if m.Version != 0 || len(m.Nodes) == 0 || len(m.Relationships) == 0 {
		t.Fatalf("incomplete model: %+v", m)
	}
	for _, n := range m.Nodes {
		if n.CalmNodeID == "" || n.ID == "" {
			t.Fatalf("missing identity: %+v", n)
		}
		if n.Type == "endpoint" && (n.CalmInterfaceID == "" || n.ParentID == "") {
			t.Fatalf("missing endpoint identity: %+v", n)
		}
	}
}

func TestProfile(t *testing.T) {
	cases := []struct {
		name   string
		change func(map[string]any)
		field  string
	}{
		{"valid", func(map[string]any) {}, ""},
		{"schema", func(m map[string]any) { m["$schema"] = "https://example.com/schema" }, "$schema"},
		{"missing revision", func(m map[string]any) { delete(m, "metadata") }, "metadata"},
		{"fractional revision", func(m map[string]any) { m["metadata"] = map[string]any{"archdrift": map[string]any{"version": 1.5}} }, "version"},
		{"negative revision", func(m map[string]any) { m["metadata"] = map[string]any{"archdrift": map[string]any{"version": -1}} }, "version"},
		{"root binding", func(m map[string]any) { m["metadata"].(map[string]any)["archdrift"].(map[string]any)["extra"] = true }, "metadata"},
		{"official schema", func(m map[string]any) { m["nodes"].([]any)[0].(map[string]any)["name"] = 42 }, "nodes"},
		{"duplicate node", func(m map[string]any) { m["nodes"] = append(m["nodes"].([]any), m["nodes"].([]any)[0]) }, "unique-id"},
		{"empty nodes", func(m map[string]any) { m["nodes"] = []any{} }, "nodes"},
		{"missing relationships", func(m map[string]any) { delete(m, "relationships") }, "relationships"},
		{"unknown node", func(m map[string]any) { m["nodes"].([]any)[0].(map[string]any)["node-type"] = "actor" }, "node-type"},
	}
	for _, field := range []string{"flows", "controls", "standards", "decorators", "timelines", "details", "rules", "defaultAction"} {
		cases = append(cases, struct {
			name   string
			change func(map[string]any)
			field  string
		}{field, func(m map[string]any) { m[field] = nil }, field})
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			m := fixture(t)
			tc.change(m)
			raw, err := json.Marshal(m)
			if err != nil {
				t.Fatal(err)
			}
			_, details := parseDocument(t, raw)
			if tc.field == "" {
				if len(details) != 0 {
					t.Fatal(details)
				}
				return
			}
			for _, d := range details {
				if strings.Contains(d.Field, tc.field) {
					return
				}
			}
			t.Fatalf("expected error at %s, got %+v", tc.field, details)
		})
	}
}

func TestInvalidJSON(t *testing.T) {
	for _, raw := range []string{"", "null", "[]", "{} {}", "{", `{"nodes":null}`} {
		if _, details := parseDocument(t, []byte(raw)); len(details) == 0 {
			t.Fatalf("accepted %q", raw)
		}
	}
}

func TestCollectionLimitsBeforeSchemaValidation(t *testing.T) {
	for field, count := range map[string]int{"nodes": 1001, "relationships": 10001} {
		m := fixture(t)
		items := make([]any, count)
		for i := range items {
			items[i] = map[string]any{}
		}
		m[field] = items
		raw, err := json.Marshal(m)
		if err != nil {
			t.Fatal(err)
		}
		_, details := parseDocument(t, raw)
		if len(details) != 1 || details[0].Field != "/"+field {
			t.Fatalf("limit not applied before schema traversal: %+v", details)
		}
	}
}

func TestRevisionNumbers(t *testing.T) {
	for _, tc := range []struct {
		raw   string
		valid bool
		want  int64
	}{
		{"0", true, 0}, {"1.0", true, 1}, {"1e0", true, 1}, {"0e1000000000", true, 0},
		{"9007199254740993", true, 9007199254740993}, {"9223372036854775807", true, 9223372036854775807},
		{`"1"`, false, 0}, {"null", false, 0}, {"true", false, 0}, {"-1", false, 0}, {"1.0000000000000001", false, 0},
		{"9223372036854775808", false, 0}, {"1e1000000000", false, 0}, {"1e-1000000000", false, 0},
	} {
		m := fixture(t)
		m["metadata"].(map[string]any)["archdrift"].(map[string]any)["version"] = json.RawMessage(tc.raw)
		raw, err := json.Marshal(m)
		if err != nil {
			t.Fatal(err)
		}
		got, details := parseDocument(t, raw)
		if (len(details) == 0) != tc.valid || (tc.valid && got.Version != tc.want) {
			t.Fatalf("revision %s: model=%+v details=%v", tc.raw, got, details)
		}
	}
}
