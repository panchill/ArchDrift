package architecture

import "fmt"

func (p *parser) collectOwners(rels []any) {
	seen := map[string]bool{}
	for i, v := range rels {
		m := object(v)
		path := fmt.Sprintf("/relationships/%d", i)
		id := text(m["unique-id"])
		if id == "" || seen[id] {
			p.fail(path+"/unique-id", "expected a non-empty unique relationship ID")
		}
		seen[id] = true
		kinds := object(m["relationship-type"])
		if len(kinds) != 1 {
			p.fail(path+"/relationship-type", "expected exactly one of connects or composed-of")
			continue
		}
		if _, ok := kinds["connects"]; ok {
			continue
		}
		v, ok := kinds["composed-of"]
		if !ok {
			p.fail(path+"/relationship-type", "only connects and composed-of are supported")
			continue
		}
		c := object(v)
		p.binding(c, path+"/relationship-type/composed-of", false)
		owner := text(c["container"])
		if p.nodes[owner].Type != "service" {
			p.fail(path+"/relationship-type/composed-of/container", "container must reference a service")
		}
		children, _ := c["nodes"].([]any)
		for _, child := range children {
			id := text(child)
			if p.nodes[id].Type != "worker" {
				p.fail(path+"/relationship-type/composed-of/nodes", "children must reference workers")
			}
			if _, exists := p.owners[id]; exists {
				p.fail(path+"/relationship-type/composed-of/nodes", "worker must have exactly one owner")
			}
			p.owners[id] = owner
		}
	}
}

func (p *parser) selector(v any, path string) []Node {
	m := object(v)
	p.binding(m, path, false)
	id := text(m["node"])
	n, exists := p.nodes[id]
	if !exists {
		p.fail(path+"/node", "unknown node reference")
		return nil
	}
	iv, exists := m["interfaces"]
	if !exists {
		return []Node{n}
	}
	interfaces, _ := iv.([]any)
	if n.Type != "service" || len(interfaces) == 0 {
		p.fail(path+"/interfaces", "expected a non-empty list of service interface IDs")
		return nil
	}
	seen := map[string]bool{}
	result := make([]Node, 0, len(interfaces))
	for _, v := range interfaces {
		iid := text(v)
		n, exists := p.interfaces[id][iid]
		if !exists || seen[iid] {
			p.fail(path+"/interfaces", "unknown or duplicate interface reference")
			continue
		}
		seen[iid] = true
		result = append(result, n)
	}
	return result
}

func (p *parser) addRelationship(m map[string]any, path string) {
	kinds := object(m["relationship-type"])
	v, connects := kinds["connects"]
	fields := []string{}
	if connects {
		fields = append(fields, "type")
	}
	b := p.binding(m, path, false, fields...)
	typ := text(b["type"])
	if _, exists := b["type"]; exists {
		switch typ {
		case "http_call", "db_query", "publish", "consume":
		default:
			p.fail(path+"/metadata/archdrift/type", "unsupported operation type")
		}
	}
	protocolType := ""
	if v, exists := m["protocol"]; exists {
		switch text(v) {
		case "HTTP", "HTTPS":
			protocolType = "http_call"
		case "JDBC":
			protocolType = "db_query"
		case "TCP":
		default:
			p.fail(path+"/protocol", "unsupported protocol")
		}
	}
	if !connects {
		return
	}
	c := object(v)
	p.binding(c, path+"/relationship-type/connects", false)
	sources := p.selector(c["source"], path+"/relationship-type/connects/source")
	targets := p.selector(c["destination"], path+"/relationship-type/connects/destination")
	r := Relationship{
		ID:      text(m["unique-id"]),
		Sources: make([]string, 0, len(sources)),
		Targets: make([]string, 0, len(targets)),
		Types:   []string{},
	}
	for _, n := range sources {
		r.Sources = append(r.Sources, n.ID)
	}
	for _, n := range targets {
		r.Targets = append(r.Targets, n.ID)
	}
	// All alternatives in an interface selector are endpoints of one service,
	// so checking their types once avoids materializing a Cartesian product.
	if len(sources) != 0 && len(targets) != 0 {
		for _, candidate := range []string{"http_call", "db_query", "publish", "consume"} {
			matchesType := typ == "" || typ == candidate
			matchesProtocol := protocolType == "" || protocolType == candidate
			if !matchesType || !matchesProtocol {
				continue
			}
			if compatible(candidate, sources[0].Type, targets[0].Type) {
				r.Types = append(r.Types, candidate)
			}
		}
		if len(r.Types) == 0 {
			p.fail(path, "relationship endpoints, protocol and type are incompatible")
		}
	}
	p.model.Relationships = append(p.model.Relationships, r)
}

func compatible(kind, source, target string) bool {
	operation := func(kind string) bool { return kind == "service" || kind == "endpoint" || kind == "worker" }
	switch kind {
	case "http_call":
		return operation(source) && (target == "service" || target == "endpoint")
	case "db_query":
		return operation(source) && target == "postgres_database"
	case "publish":
		return operation(source) && target == "kafka_topic"
	case "consume":
		return source == "kafka_topic" && operation(target)
	}
	return false
}
