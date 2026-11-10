package architecture

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

func node(m map[string]any, id string) map[string]any {
	for _, v := range m["nodes"].([]any) {
		if object(v)["unique-id"] == id {
			return object(v)
		}
	}
	panic("missing test node")
}
func rel(m map[string]any, id string) map[string]any {
	for _, v := range m["relationships"].([]any) {
		if object(v)["unique-id"] == id {
			return object(v)
		}
	}
	panic("missing test relationship")
}
func bind(m map[string]any) map[string]any { return object(object(m["metadata"])["archdrift"]) }
func end(m map[string]any, side string) map[string]any {
	return object(object(object(m["relationship-type"])["connects"])[side])
}

func TestProfileReferencesAndBindings(t *testing.T) {
	cases := []struct {
		name   string
		change func(map[string]any)
	}{
		{"missing service binding", func(m map[string]any) { delete(node(m, "svc-gateway"), "metadata") }},
		{"unknown binding field", func(m map[string]any) { bind(node(m, "svc-gateway"))["extra"] = true }},
		{"array metadata", func(m map[string]any) { node(m, "svc-gateway")["metadata"] = []any{} }},
		{"duplicate service binding", func(m map[string]any) { bind(node(m, "svc-orders"))["serviceName"] = "gateway" }},
		{"service whitespace", func(m map[string]any) { bind(node(m, "svc-gateway"))["serviceName"] = " gateway" }},
		{"long service name", func(m map[string]any) { bind(node(m, "svc-gateway"))["serviceName"] = strings.Repeat("a", 256) }},
		{"no service", func(m map[string]any) { m["nodes"] = []any{node(m, "db-orders_db")}; m["relationships"] = []any{} }},
		{"worker without owner", func(m map[string]any) { m["relationships"] = m["relationships"].([]any)[1:] }},
		{"two worker owners", func(m map[string]any) {
			object(object(rel(m, "owns-release-reservation")["relationship-type"])["composed-of"])["nodes"] = []any{"worker-send-email"}
		}},
		{"worker container", func(m map[string]any) {
			object(object(rel(m, "owns-send-email")["relationship-type"])["composed-of"])["container"] = "worker-release-reservation"
		}},
		{"non-worker child", func(m map[string]any) {
			object(object(rel(m, "owns-send-email")["relationship-type"])["composed-of"])["nodes"] = []any{"svc-gateway"}
		}},
		{"unknown container", func(m map[string]any) {
			object(object(rel(m, "owns-send-email")["relationship-type"])["composed-of"])["container"] = "missing"
		}},
		{"interfaces on worker", func(m map[string]any) { node(m, "worker-send-email")["interfaces"] = []any{} }},
		{"duplicate interface ID", func(m map[string]any) {
			n := node(m, "svc-gateway")
			n["interfaces"] = append(n["interfaces"].([]any), n["interfaces"].([]any)[0])
		}},
		{"duplicate interface binding", func(m map[string]any) {
			n := node(m, "svc-gateway")
			object(n["interfaces"].([]any)[1])["metadata"] = object(n["interfaces"].([]any)[0])["metadata"]
		}},
		{"external definition", func(m map[string]any) {
			object(node(m, "svc-gateway")["interfaces"].([]any)[0])["definition-url"] = "https://example.com"
		}},
		{"lowercase method", func(m map[string]any) {
			bind(object(node(m, "svc-gateway")["interfaces"].([]any)[0]))["method"] = "post"
		}},
		{"missing route", func(m map[string]any) { delete(bind(object(node(m, "svc-gateway")["interfaces"].([]any)[0])), "route") }},
		{"route without slash", func(m map[string]any) {
			bind(object(node(m, "svc-gateway")["interfaces"].([]any)[0]))["route"] = "orders"
		}},
		{"unknown node reference", func(m map[string]any) { end(rel(m, "rel-1"), "source")["node"] = "missing" }},
		{"foreign interface", func(m map[string]any) { end(rel(m, "rel-1"), "source")["interfaces"] = []any{"create"} }},
		{"empty interfaces selector", func(m map[string]any) { end(rel(m, "rel-1"), "source")["interfaces"] = []any{} }},
		{"duplicate interface selector", func(m map[string]any) { end(rel(m, "rel-1"), "source")["interfaces"] = []any{"checkout", "checkout"} }},
		{"duplicate relationship", func(m map[string]any) { m["relationships"] = append(m["relationships"].([]any), rel(m, "rel-1")) }},
		{"unsupported relationship", func(m map[string]any) {
			rel(m, "rel-1")["relationship-type"] = map[string]any{"interacts": map[string]any{"actor": "svc-gateway", "nodes": []any{"svc-orders"}}}
		}},
		{"unknown relationship kind", func(m map[string]any) { object(rel(m, "rel-1")["relationship-type"])["custom"] = map[string]any{} }},
		{"type incompatible with ends", func(m map[string]any) { bind(rel(m, "rel-1"))["type"] = "db_query" }},
		{"protocol incompatible with type", func(m map[string]any) { rel(m, "rel-1")["protocol"] = "JDBC" }},
		{"unsupported protocol", func(m map[string]any) { rel(m, "rel-1")["protocol"] = "FTP" }},
		{"null type", func(m map[string]any) { bind(rel(m, "rel-1"))["type"] = nil }},
		{"SQL operation filter", func(m map[string]any) { bind(rel(m, "rel-5"))["dbOperations"] = []any{"SELECT"} }},
		{"node controls", func(m map[string]any) { node(m, "svc-gateway")["controls"] = map[string]any{} }},
		{"canonical ID too long", func(m map[string]any) {
			bind(object(node(m, "svc-gateway")["interfaces"].([]any)[0]))["route"] = "/" + strings.Repeat("я", 1023)
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			m := fixture(t)
			tc.change(m)
			raw, err := json.Marshal(m)
			if err != nil {
				t.Fatal(err)
			}
			if _, details := Parse(raw); len(details) == 0 {
				t.Fatal("invalid profile accepted")
			}
		})
	}
}

func TestNormalizedDeclarations(t *testing.T) {
	m := fixture(t)
	// Broad self-calls and multiple interface alternatives are both valid.
	r := rel(m, "rel-1")
	delete(r, "metadata")
	r["protocol"] = "HTTPS"
	end(r, "source")["interfaces"] = []any{"checkout", "lookup"}
	end(r, "destination")["node"] = "svc-gateway"
	delete(end(r, "destination"), "interfaces")
	raw, _ := json.Marshal(m)
	got, details := Parse(raw)
	if len(details) != 0 {
		t.Fatal(details)
	}
	for _, n := range got.Nodes {
		if n.CalmNodeID == "worker-send-email" && (n.ID != "worker:notifications:send-email" || n.ParentID != "service:notifications") {
			t.Fatalf("worker identity: %+v", n)
		}
	}
	for _, r := range got.Relationships {
		if r.ID == "rel-1" {
			want := Relationship{ID: "rel-1", Sources: []string{"endpoint:gateway:POST:%2Fcheckout", "endpoint:gateway:GET:%2Forders%2F%7Bid%7D"}, Targets: []string{"service:gateway"}, Types: []string{"http_call"}}
			if !reflect.DeepEqual(r, want) {
				t.Fatalf("got %+v, want %+v", r, want)
			}
		}
		if strings.HasPrefix(r.ID, "owns-") {
			t.Fatal("ownership became an interaction")
		}
	}
}

func TestCompatiblePairs(t *testing.T) {
	cases := []struct {
		source, target, typ string
		valid               bool
	}{
		{"worker", "service", "http_call", true},
		{"worker", "worker", "http_call", false},
		{"endpoint", "postgres_database", "db_query", true},
		{"postgres_database", "service", "db_query", false},
		{"worker", "kafka_topic", "publish", true},
		{"kafka_topic", "service", "publish", false},
		{"kafka_topic", "worker", "consume", true},
		{"service", "kafka_topic", "consume", false},
		{"postgres_database", "kafka_topic", "publish", false},
	}
	for _, tc := range cases {
		m := fixture(t)
		ids := map[string]string{"service": "svc-gateway", "endpoint": "svc-gateway", "worker": "worker-send-email", "postgres_database": "db-orders_db", "kafka_topic": "topic-orders.created"}
		r := rel(m, "rel-1")
		bind(r)["type"] = tc.typ
		for side, kind := range map[string]string{"source": tc.source, "destination": tc.target} {
			s := end(r, side)
			s["node"] = ids[kind]
			delete(s, "interfaces")
			if kind == "endpoint" {
				s["interfaces"] = []any{"checkout"}
			}
		}
		raw, _ := json.Marshal(m)
		_, details := Parse(raw)
		if (len(details) == 0) != tc.valid {
			t.Fatalf("%s -> %s (%s): %v", tc.source, tc.target, tc.typ, details)
		}
	}
}
