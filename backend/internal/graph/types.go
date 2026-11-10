package graph

import (
	"time"
)

type Node struct {
	ID          string
	Label       string
	Type        string
	ParentID    string
	ServiceName string
	Method      string
	Route       string
	WorkerName  string
	Instance    string
	Database    string
	Cluster     string
	Topic       string
}

type Edge struct {
	Source             string
	Target             string
	Type               string
	DBOperation        string
	ObservedOperations int
	ErrorOperations    int
	AvgDurationMs      float64
	FirstSeenAt        time.Time
	LastSeenAt         time.Time
	ExampleTraceID     string
	ExampleSpanID      string
}

type Diagnostics struct {
	UnmatchedHTTPClientSpans int
	ServiceLevelOperations   int
	UnresolvedResourceSpans  int
	IgnoredMessagingSpans    int
}

type Graph struct {
	Nodes       []Node
	Edges       []Edge
	Diagnostics Diagnostics
}
