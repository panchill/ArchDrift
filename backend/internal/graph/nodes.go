package graph

import (
	"github.com/panchill/ArchDrift/backend/internal/nodeid"
)

type ref struct {
	kind     string
	service  string
	method   string
	route    string
	worker   string
	instance string
	database string
	cluster  string
	topic    string
}

func addRef(nodes map[string]Node, r ref) string {
	switch r.kind {
	case "endpoint":
		parent := addRef(nodes, ref{kind: "service", service: r.service})
		id := nodeid.Endpoint(r.service, r.method, r.route)
		putNode(nodes, Node{
			ID: id, Type: "endpoint", Label: clip(r.method + " " + r.route),
			ParentID: parent, ServiceName: r.service, Method: r.method, Route: r.route,
		})
		return id
	case "worker":
		parent := addRef(nodes, ref{kind: "service", service: r.service})
		id := nodeid.Worker(r.service, r.worker)
		putNode(nodes, Node{
			ID: id, Type: "worker", Label: clip(r.worker),
			ParentID: parent, ServiceName: r.service, WorkerName: r.worker,
		})
		return id
	case "postgres":
		id := nodeid.Postgres(r.instance, r.database)
		putNode(nodes, Node{
			ID: id, Type: "postgres_database", Label: clip(r.instance + "/" + r.database),
			Instance: r.instance, Database: r.database,
		})
		return id
	case "kafka":
		id := nodeid.Kafka(r.cluster, r.topic)
		putNode(nodes, Node{
			ID: id, Type: "kafka_topic", Label: clip(r.topic),
			Cluster: r.cluster, Topic: r.topic,
		})
		return id
	default:
		id := nodeid.Service(r.service)
		putNode(nodes, Node{ID: id, Type: "service", Label: clip(r.service), ServiceName: r.service})
		return id
	}
}

func putNode(nodes map[string]Node, n Node) {
	if _, ok := nodes[n.ID]; ok {
		return
	}
	nodes[n.ID] = n
}

func clip(s string) string {
	r := []rune(s)
	if len(r) <= 255 {
		return s
	}
	return string(r[:255])
}
