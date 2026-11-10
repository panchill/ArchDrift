package graph

import (
	"strings"

	"github.com/panchill/ArchDrift/backend/internal/model"
)

func addDB(sp model.Span, index map[string]model.Span, nodes map[string]Node, edges map[edgeKey]*acc, diag *Diagnostics) {
	dbName, okDB := sp.StringAttr("db.namespace")
	instance, okInst := sp.StringAttr("archdrift.postgres.instance")
	if !okDB || !okInst {
		diag.UnresolvedResourceSpans++
		return
	}
	owner := resolveOwner(sp, index, false)
	target := ref{kind: "postgres", instance: instance, database: dbName}
	addEdge(nodes, edges, owner, target, edgeDB, dbOperation(sp), sp)
	if serviceLevel(owner, target, edgeDB) {
		diag.ServiceLevelOperations++
	}
}

func addKafka(sp model.Span, index map[string]model.Span, nodes map[string]Node, edges map[edgeKey]*acc, diag *Diagnostics) {
	op, _ := sp.StringAttr("messaging.operation.type")
	publish := sp.Kind == model.KindProducer && op == "send"
	consume := sp.Kind == model.KindConsumer && op == "process"
	if !publish && !consume {
		diag.IgnoredMessagingSpans++
		return
	}
	topic, okTopic := sp.StringAttr("messaging.destination.name")
	cluster, okCluster := sp.StringAttr("archdrift.kafka.cluster")
	if !okTopic || !okCluster {
		diag.UnresolvedResourceSpans++
		return
	}
	topicRef := ref{kind: "kafka", cluster: cluster, topic: topic}
	owner := resolveOwner(sp, index, consume)
	if publish {
		addEdge(nodes, edges, owner, topicRef, edgePublish, "", sp)
		if serviceLevel(owner, topicRef, edgePublish) {
			diag.ServiceLevelOperations++
		}
		return
	}
	addEdge(nodes, edges, topicRef, owner, edgeConsume, "", sp)
	if serviceLevel(owner, topicRef, edgeConsume) {
		diag.ServiceLevelOperations++
	}
}

func isPostgres(sp model.Span) bool {
	system, ok := sp.StringAttr("db.system.name")
	return ok && system == "postgresql"
}

func isKafka(sp model.Span) bool {
	system, ok := sp.StringAttr("messaging.system")
	return ok && system == "kafka"
}

func dbOperation(sp model.Span) string {
	raw, ok := sp.StringAttr("db.operation.name")
	if !ok {
		return "OTHER"
	}
	switch strings.ToUpper(raw) {
	case "SELECT", "INSERT", "UPDATE", "DELETE":
		return strings.ToUpper(raw)
	default:
		return "OTHER"
	}
}
