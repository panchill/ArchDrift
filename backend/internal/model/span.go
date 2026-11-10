// Package model — спан в том виде, в котором его хранит приём трейсов
// и читает построение графа.
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

// Kind — значение Span.kind из контракта.
type Kind string

// Status — значение Span.status из контракта.
type Status string

// Attr — components/schemas/AttributeValue.
type Attr struct {
	Type  string `json:"type"`
	Value string `json:"value"`
}

// Link — ссылка OTel. Kafka process может жить в другом трейсе.
type Link struct {
	TraceID string `json:"traceId"`
	SpanID  string `json:"spanId"`
}

// Span — сохранённый спан. Идентификаторы — нижний hex без нулевых ID.
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

// StringAttr возвращает непустой строковый атрибут спана.
func (s Span) StringAttr(key string) (string, bool) {
	a, ok := s.Attributes[key]
	if !ok || a.Type != "string" || a.Value == "" {
		return "", false
	}
	return a.Value, true
}
