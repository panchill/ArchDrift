package nodeid

import "testing"

func TestEncode(t *testing.T) {
	cases := []struct{ in, want string }{
		{"checkout", "checkout"},
		{"a b", "a%20b"},
		{"/orders", "%2Forders"},
		{"a/b", "a%2Fb"},
		{"~ok", "~ok"},
		{"й", "%D0%B9"},
		{"a:b", "a%3Ab"},
	}
	for _, tc := range cases {
		if got := Encode(tc.in); got != tc.want {
			t.Errorf("Encode(%q) = %q, хотели %q", tc.in, got, tc.want)
		}
	}
}

func TestIDs(t *testing.T) {
	if got := Endpoint("checkout", "POST", "/oteldemo.CheckoutService/PlaceOrder"); got != "endpoint:checkout:POST:%2Foteldemo.CheckoutService%2FPlaceOrder" {
		t.Fatal(got)
	}
	if got := Postgres("shop", "otel"); got != "postgres:shop:otel" {
		t.Fatal(got)
	}
	if got := Kafka("demo", "orders"); got != "kafka:demo:orders" {
		t.Fatal(got)
	}
	if got := Worker("accounting", "invoice"); got != "worker:accounting:invoice" {
		t.Fatal(got)
	}
}
