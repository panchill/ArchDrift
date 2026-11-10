package nodeid

import (
	"fmt"
	"strings"
)

func Encode(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	for i := 0; i < len(s); i++ {
		c := s[i]
		if isUnreserved(c) {
			b.WriteByte(c)
			continue
		}
		fmt.Fprintf(&b, "%%%02X", c)
	}
	return b.String()
}

func isUnreserved(c byte) bool {
	switch {
	case c >= 'A' && c <= 'Z', c >= 'a' && c <= 'z', c >= '0' && c <= '9':
		return true
	case c == '-' || c == '.' || c == '_' || c == '~':
		return true
	default:
		return false
	}
}

func Service(name string) string { return "service:" + Encode(name) }

func Endpoint(service, method, route string) string {
	return "endpoint:" + Encode(service) + ":" + Encode(method) + ":" + Encode(route)
}

func Worker(service, name string) string {
	return "worker:" + Encode(service) + ":" + Encode(name)
}

func Postgres(instance, database string) string {
	return "postgres:" + Encode(instance) + ":" + Encode(database)
}

func Kafka(cluster, topic string) string {
	return "kafka:" + Encode(cluster) + ":" + Encode(topic)
}
