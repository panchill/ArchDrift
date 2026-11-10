package graph

import (
	"time"
)

type Node struct {
	ID          string `json:"id"`
	Label       string `json:"label"`
	Type        string `json:"type"`
	ParentID    string `json:"parentId,omitempty"`
	ServiceName string `json:"serviceName,omitempty"`
	Method      string `json:"method,omitempty"`
	Route       string `json:"route,omitempty"`
	WorkerName  string `json:"workerName,omitempty"`
	Instance    string `json:"instance,omitempty"`
	Database    string `json:"database,omitempty"`
	Cluster     string `json:"cluster,omitempty"`
	Topic       string `json:"topic,omitempty"`
}

type Edge struct {
	Source             string    `json:"source"`
	Target             string    `json:"target"`
	Type               string    `json:"type"`
	DBOperation        string    `json:"dbOperation,omitempty"`
	ObservedOperations int       `json:"observedOperations"`
	ErrorOperations    int       `json:"errorOperations"`
	AvgDurationMs      float64   `json:"avgDurationMs"`
	FirstSeenAt        time.Time `json:"firstSeenAt"`
	LastSeenAt         time.Time `json:"lastSeenAt"`
	ExampleTraceID     string    `json:"exampleTraceId"`
	ExampleSpanID      string    `json:"exampleSpanId"`
}

type Diagnostics struct {
	UnmatchedHTTPClientSpans int `json:"unmatchedHttpClientSpans"`
	ServiceLevelOperations   int `json:"serviceLevelOperations"`
	UnresolvedResourceSpans  int `json:"unresolvedResourceSpans"`
	IgnoredMessagingSpans    int `json:"ignoredMessagingSpans"`
}

type Graph struct {
	Nodes       []Node
	Edges       []Edge
	Diagnostics Diagnostics
}
