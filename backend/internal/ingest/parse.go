package ingest

import (
	"encoding/base64"
	"encoding/json"
	"math"
	"strconv"

	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/ptrace"
	"go.opentelemetry.io/collector/pdata/ptrace/ptraceotlp"

	"github.com/panchill/ArchDrift/backend/internal/model"
)

func Parse(body []byte) ([]model.Span, int, error) {
	req := ptraceotlp.NewExportRequest()
	if err := req.UnmarshalProto(body); err != nil {
		return nil, 0, err
	}
	var out []model.Span
	rejected := 0
	rss := req.Traces().ResourceSpans()
	for i := 0; i < rss.Len(); i++ {
		rs := rss.At(i)
		service, resource := resourceOf(rs.Resource())
		ilss := rs.ScopeSpans()
		for j := 0; j < ilss.Len(); j++ {
			spans := ilss.At(j).Spans()
			for k := 0; k < spans.Len(); k++ {
				span, ok := convertSpan(spans.At(k), service, resource)
				if !ok {
					rejected++
					continue
				}
				out = append(out, span)
			}
		}
	}
	return out, rejected, nil
}

func resourceOf(res pcommon.Resource) (string, map[string]model.Attr) {
	attrs := attrMap(res.Attributes())
	name := ""
	if a, ok := attrs["service.name"]; ok && a.Type == "string" {
		name = a.Value
	}
	return name, attrs
}

func convertSpan(sp ptrace.Span, service string, resource map[string]model.Attr) (model.Span, bool) {
	span := model.Span{
		TraceID: sp.TraceID().String(), SpanID: sp.SpanID().String(),
		ServiceName: service, Start: sp.StartTimestamp().AsTime(), End: sp.EndTimestamp().AsTime(),
	}
	// Apply the domain rule before allocating attributes for rejected wire records.
	if !span.Valid() {
		return model.Span{}, false
	}
	parent := ""
	if !sp.ParentSpanID().IsEmpty() {
		parent = sp.ParentSpanID().String()
	}
	links := make([]model.Link, 0, sp.Links().Len())
	for i := 0; i < sp.Links().Len(); i++ {
		link := sp.Links().At(i)
		if link.TraceID().IsEmpty() || link.SpanID().IsEmpty() {
			continue
		}
		links = append(links, model.Link{
			TraceID: link.TraceID().String(),
			SpanID:  link.SpanID().String(),
		})
	}
	span.ParentSpanID = parent
	span.Name = sp.Name()
	span.Kind = kindOf(sp.Kind())
	span.Status = statusOf(sp.Status().Code())
	span.StatusMessage = sp.Status().Message()
	span.Attributes = attrMap(sp.Attributes())
	span.ResourceAttributes = resource
	span.Links = links
	return span, true
}

func kindOf(k ptrace.SpanKind) model.Kind {
	switch k {
	case ptrace.SpanKindInternal:
		return model.KindInternal
	case ptrace.SpanKindServer:
		return model.KindServer
	case ptrace.SpanKindClient:
		return model.KindClient
	case ptrace.SpanKindProducer:
		return model.KindProducer
	case ptrace.SpanKindConsumer:
		return model.KindConsumer
	default:
		return model.KindUnspecified
	}
}

func statusOf(c ptrace.StatusCode) model.Status {
	switch c {
	case ptrace.StatusCodeOk:
		return model.StatusOK
	case ptrace.StatusCodeError:
		return model.StatusError
	default:
		return model.StatusUnset
	}
}

func attrMap(m pcommon.Map) map[string]model.Attr {
	out := make(map[string]model.Attr, m.Len())
	m.Range(func(k string, v pcommon.Value) bool {
		out[k] = attrValue(v)
		return true
	})
	return out
}

func attrValue(v pcommon.Value) model.Attr {
	switch v.Type() {
	case pcommon.ValueTypeBool:
		if v.Bool() {
			return model.Attr{Type: "bool", Value: "true"}
		}
		return model.Attr{Type: "bool", Value: "false"}
	case pcommon.ValueTypeInt:
		return model.Attr{Type: "int", Value: strconv.FormatInt(v.Int(), 10)}
	case pcommon.ValueTypeDouble:
		return model.Attr{Type: "double", Value: formatFloat(v.Double())}
	case pcommon.ValueTypeBytes:
		return model.Attr{Type: "bytes", Value: base64.StdEncoding.EncodeToString(v.Bytes().AsRaw())}
	case pcommon.ValueTypeSlice:
		items := make([]model.Attr, v.Slice().Len())
		for i := 0; i < v.Slice().Len(); i++ {
			items[i] = attrValue(v.Slice().At(i))
		}
		raw, _ := json.Marshal(items)
		return model.Attr{Type: "array", Value: string(raw)}
	case pcommon.ValueTypeMap:
		obj := make(map[string]model.Attr, v.Map().Len())
		v.Map().Range(func(k string, child pcommon.Value) bool {
			obj[k] = attrValue(child)
			return true
		})
		raw, _ := json.Marshal(obj)
		return model.Attr{Type: "kvlist", Value: string(raw)}
	default:
		return model.Attr{Type: "string", Value: v.Str()}
	}
}

func formatFloat(f float64) string {
	switch {
	case math.IsNaN(f):
		return "NaN"
	case math.IsInf(f, 1):
		return "Infinity"
	case math.IsInf(f, -1):
		return "-Infinity"
	default:
		return strconv.FormatFloat(f, 'f', -1, 64)
	}
}
