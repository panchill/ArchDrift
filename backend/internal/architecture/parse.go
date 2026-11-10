// Package architecture validates the ArchDrift CALM profile and resolves its
// declarations to the same canonical identities as the observed graph.
package architecture

import (
	"bytes"
	"cmp"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"math/big"
	"regexp"
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/santhosh-tekuri/jsonschema/v6"

	"github.com/panchill/ArchDrift/backend/internal/graph"
	"github.com/panchill/ArchDrift/backend/internal/nodeid"
)

type Node struct {
	graph.Node
	CalmNodeID      string
	CalmInterfaceID string
}

// Each selector list contains alternatives, not observed edges. A service ID
// covers its immediate children; endpoint/worker/resource IDs match exactly.
type Relationship struct {
	ID      string
	Sources []string
	Targets []string
	Types   []string
}

type Model struct {
	Version       int64
	Nodes         []Node
	Relationships []Relationship
}

type parser struct {
	model      Model
	details    []Detail
	nodes      map[string]Node
	interfaces map[string]map[string]Node
	owners     map[string]string
	identities map[string]bool
}

func (v *Validator) Parse(raw []byte) (*Model, error) {
	if !utf8.Valid(raw) {
		return nil, &ValidationError{Details: []Detail{{Field: "/", Message: "expected UTF-8 JSON"}}}
	}
	document, err := jsonschema.UnmarshalJSON(bytes.NewReader(raw))
	if err != nil {
		return nil, &ValidationError{Details: []Detail{{Field: "/", Message: "expected one valid JSON document"}}}
	}
	doc := object(document)
	p := &parser{
		model:      Model{Nodes: []Node{}, Relationships: []Relationship{}},
		details:    []Detail{},
		nodes:      map[string]Node{},
		interfaces: map[string]map[string]Node{},
		owners:     map[string]string{},
		identities: map[string]bool{},
	}
	if text(doc["$schema"]) != schemaURL {
		p.fail("/$schema", "expected CALM 1.2 schema URL")
	}
	b := p.binding(doc, "", true, "version")
	version, valid := revision(b["version"])
	if !valid {
		p.fail("/metadata/archdrift/version", "expected a non-negative int64 revision")
	} else {
		p.model.Version = version
	}
	nodes, ok := doc["nodes"].([]any)
	validNodeCount := len(nodes) > 0 && len(nodes) <= 1000
	if !ok || !validNodeCount {
		p.fail("/nodes", "expected 1 to 1000 nodes")
	}
	rels, ok := doc["relationships"].([]any)
	if !ok || len(rels) > 10000 {
		p.fail("/relationships", "expected an array of at most 10000 relationships")
	}
	// Do not normalize unbounded collections after a size error.
	if len(p.details) != 0 {
		return nil, &ValidationError{Details: p.details}
	}
	if err := v.schema.Validate(document); err != nil {
		if validation, ok := errors.AsType[*jsonschema.ValidationError](err); ok {
			return nil, &ValidationError{Details: schemaDetails(validation)}
		}
		return nil, fmt.Errorf("validate CALM schema: %w", err)
	}
	for i, v := range nodes {
		p.addNode(object(v), fmt.Sprintf("/nodes/%d", i))
	}
	p.collectOwners(rels)
	services := 0
	for id, n := range p.nodes {
		if n.Type == "service" {
			services++
		}
		if n.Type != "worker" {
			continue
		}
		owner, ok := p.nodes[p.owners[id]]
		if !ok || owner.Type != "service" {
			p.fail("/nodes", "each worker must belong to exactly one service")
			continue
		}
		n.ParentID = owner.ID
		n.ID = nodeid.Worker(owner.ServiceName, n.WorkerName)
		p.nodes[id] = n
		p.addIdentity(n, "/nodes")
	}
	if services == 0 {
		p.fail("/nodes", "at least one service is required")
	}
	for i, v := range rels {
		p.addRelationship(object(v), fmt.Sprintf("/relationships/%d", i))
	}
	if len(p.details) != 0 {
		return nil, &ValidationError{Details: p.details}
	}
	slices.SortFunc(p.model.Nodes, func(a, b Node) int { return cmp.Compare(a.ID, b.ID) })
	slices.SortFunc(p.model.Relationships, func(a, b Relationship) int { return cmp.Compare(a.ID, b.ID) })
	return &p.model, nil
}

func revision(v any) (int64, bool) {
	n, ok := v.(json.Number)
	f, err := n.Float64()
	// Reject huge exponents before exact arithmetic can allocate huge integers.
	if !ok || err != nil {
		return 0, false
	}
	inRange := f >= 0 && f <= float64(math.MaxInt64)
	if !inRange || math.Trunc(f) != f {
		return 0, false
	}
	if f == 0 {
		coefficient, _, _ := strings.Cut(strings.ToLower(string(n)), "e")
		return 0, strings.Trim(coefficient, "-0.") == ""
	}
	r, valid := new(big.Rat).SetString(string(n))
	if !valid {
		return 0, false
	}
	if !r.IsInt() || !r.Num().IsInt64() {
		return 0, false
	}
	return r.Num().Int64(), true
}

func object(v any) map[string]any { m, _ := v.(map[string]any); return m }
func text(v any) string           { s, _ := v.(string); return s }
func (p *parser) fail(field, message string) {
	if len(p.details) < 100 {
		p.details = append(p.details, Detail{Field: field, Message: message})
	}
}

func (p *parser) checkObject(m map[string]any, path string) {
	for _, key := range []string{"flows", "controls", "standards", "decorators", "timelines", "details"} {
		if _, ok := m[key]; ok {
			p.fail(path+"/"+key, "not supported by the ArchDrift profile")
		}
	}
	if path == "" {
		for _, key := range []string{"rules", "defaultAction"} {
			if _, ok := m[key]; ok {
				p.fail("/"+key, "not supported")
			}
		}
	}
	if v, ok := m["metadata"]; ok && object(v) == nil {
		p.fail(path+"/metadata", "expected an object")
	}
}

func (p *parser) binding(m map[string]any, path string, required bool, fields ...string) map[string]any {
	p.checkObject(m, path)
	v, exists := object(m["metadata"])["archdrift"]
	if !required && !exists {
		return nil
	}
	b := object(v)
	if b == nil {
		p.fail(path+"/metadata/archdrift", "expected a binding object")
		return nil
	}
	for key := range b {
		if !slices.Contains(fields, key) {
			p.fail(path+"/metadata/archdrift/"+key, "unknown binding field")
		}
	}
	return b
}

func (p *parser) value(b map[string]any, key, path string, max int) string {
	s, ok := b[key].(string)
	length := utf8.RuneCountInString(s)
	validLength := length >= 1 && length <= max
	if !ok || !validLength {
		p.fail(path+"/metadata/archdrift/"+key, fmt.Sprintf("expected a string of 1 to %d characters", max))
	}
	return s
}

var methodPattern = regexp.MustCompile(`^[A-Z]+$`)

func (p *parser) addNode(m map[string]any, path string) {
	id, kind := text(m["unique-id"]), text(m["node-type"])
	if _, exists := p.nodes[id]; id == "" || exists {
		p.fail(path+"/unique-id", "expected a non-empty unique node ID")
		return
	}
	n := Node{CalmNodeID: id, Node: graph.Node{Type: kind, Label: text(m["name"])}}
	if n.Label == "" {
		n.Label = id
	}
	label := []rune(n.Label)
	if len(label) > 255 {
		n.Label = string(label[:255])
	}
	fields := []string{}
	switch kind {
	case "service":
		fields = []string{"serviceName"}
	case "worker":
		fields = []string{"workerName"}
	case "database":
		fields = []string{"instance", "database"}
	case "kafka-topic":
		fields = []string{"cluster", "topic"}
	default:
		p.fail(path+"/node-type", "unsupported node type")
		return
	}
	b := p.binding(m, path, true, fields...)
	values := map[string]string{}
	for _, key := range fields {
		max := 255
		if key == "topic" {
			max = 249
		}
		values[key] = p.value(b, key, path, max)
	}
	switch kind {
	case "service":
		n.ServiceName = values["serviceName"]
		if strings.TrimSpace(n.ServiceName) != n.ServiceName || strings.ContainsAny(n.ServiceName, "\r\n") {
			p.fail(path+"/metadata/archdrift/serviceName", "service name must not have surrounding whitespace or line breaks")
		}
		n.ID = nodeid.Service(n.ServiceName)
	case "worker":
		n.WorkerName = values["workerName"]
	case "database":
		n.Type, n.Instance, n.Database = "postgres_database", values["instance"], values["database"]
		n.ID = nodeid.Postgres(n.Instance, n.Database)
	case "kafka-topic":
		n.Type, n.Cluster, n.Topic = "kafka_topic", values["cluster"], values["topic"]
		n.ID = nodeid.Kafka(n.Cluster, n.Topic)
	}
	p.nodes[id] = n
	if kind != "worker" {
		p.addIdentity(n, path)
	}
	if _, exists := m["interfaces"]; exists && kind != "service" {
		p.fail(path+"/interfaces", "interfaces are only supported on services")
		return
	}
	p.interfaces[id] = map[string]Node{}
	interfaces, _ := m["interfaces"].([]any)
	for i, v := range interfaces {
		ip := fmt.Sprintf("%s/interfaces/%d", path, i)
		im := object(v)
		iid := text(im["unique-id"])
		if _, exists := p.interfaces[id][iid]; iid == "" || exists {
			p.fail(ip+"/unique-id", "expected a non-empty unique interface ID")
			continue
		}
		for _, key := range []string{"definition-url", "config"} {
			if _, ok := im[key]; ok {
				p.fail(ip+"/"+key, "external interface definitions are not supported")
			}
		}
		ib := p.binding(im, ip, true, "method", "route")
		method, route := p.value(ib, "method", ip, 32), p.value(ib, "route", ip, 1024)
		if !methodPattern.MatchString(method) {
			p.fail(ip+"/metadata/archdrift/method", "expected an uppercase HTTP method")
		}
		if !strings.HasPrefix(route, "/") {
			p.fail(ip+"/metadata/archdrift/route", "route must start with /")
		}
		label := []rune(method + " " + route)
		if len(label) > 255 {
			label = label[:255]
		}
		endpoint := Node{
			Node: graph.Node{
				ID:       nodeid.Endpoint(n.ServiceName, method, route),
				Type:     "endpoint",
				ParentID: n.ID,
				Method:   method,
				Route:    route,
				Label:    string(label),
			},
			CalmNodeID:      id,
			CalmInterfaceID: iid,
		}
		p.interfaces[id][iid] = endpoint
		p.addIdentity(endpoint, ip)
	}
}

func (p *parser) addIdentity(n Node, path string) {
	if len(n.ID) > 2048 {
		p.fail(path, "canonical ID exceeds 2048 characters")
	}
	if p.identities[n.ID] {
		p.fail(path+"/metadata/archdrift", "duplicate canonical binding")
	}
	p.identities[n.ID] = true
	p.model.Nodes = append(p.model.Nodes, n)
}
