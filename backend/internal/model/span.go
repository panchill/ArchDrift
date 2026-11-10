package model

import "time"

const (
	KindUnspecified Kind = "UNSPECIFIED"
	KindInternal    Kind = "INTERNAL"
	KindServer      Kind = "SERVER"
	KindClient      Kind = "CLIENT"
	KindProducer    Kind = "PRODUCER"
	KindConsumer    Kind = "CONSUMER"
)

const (
	StatusUnset Status = "UNSET"
	StatusOK    Status = "OK"
	StatusError Status = "ERROR"
)

type Kind string

type Status string

type Attr struct {
	Type  string `json:"type"`
	Value string `json:"value"`
}

type Link struct {
	TraceID string `json:"traceId"`
	SpanID  string `json:"spanId"`
}

type Span struct {
	TraceID            string
	SpanID             string
	ParentSpanID       string
	ServiceName        string
	Name               string
	Kind               Kind
	Start              time.Time
	End                time.Time
	Status             Status
	StatusMessage      string
	Attributes         map[string]Attr
	ResourceAttributes map[string]Attr
	Links              []Link
}

func (s Span) StringAttr(key string) (string, bool) {
	a, ok := s.Attributes[key]
	if !ok || a.Type != "string" || a.Value == "" {
		return "", false
	}
	return a.Value, true
}
