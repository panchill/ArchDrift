package architecture_test

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/panchill/ArchDrift/backend/internal/ingest"
	"github.com/panchill/ArchDrift/backend/internal/store"
	"github.com/panchill/ArchDrift/backend/internal/testdb"
	"github.com/panchill/ArchDrift/backend/migrations"
)

func TestArchitectureHTTP(t *testing.T) {
	_, pool := testdb.New(t)
	if err := migrations.Up(t.Context(), pool); err != nil {
		t.Fatal(err)
	}
	router := ingest.NewRouter(store.New(pool))
	request := func(method, media string, body []byte, status int) []byte {
		t.Helper()
		r := httptest.NewRequest(method, "/api/v1/architecture", bytes.NewReader(body))
		r.Header.Set("Content-Type", media)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		if w.Code != status {
			t.Fatalf("%s: got %d want %d: %s", method, w.Code, status, w.Body.String())
		}
		return w.Body.Bytes()
	}
	checkCode := func(raw []byte, code string) {
		t.Helper()
		var e struct {
			Code    string
			Details []any
		}
		if err := json.Unmarshal(raw, &e); err != nil {
			t.Fatal(err)
		}
		if e.Code != code || (code == "validation_error" && len(e.Details) == 0) {
			t.Fatalf("unexpected error: %s", raw)
		}
	}
	checkCode(request("GET", "", nil, 404), "architecture_not_configured")
	raw, err := os.ReadFile("../../../examples/opentelemetry-demo.architecture.json")
	if err != nil {
		t.Fatal(err)
	}
	checkCode(request("PUT", "text/plain", raw, 415), "unsupported_media_type")
	checkCode(request("PUT", "application/json", []byte("{} {}"), 400), "validation_error")
	invalidUTF8 := bytes.Replace(raw, []byte("Full topology"), []byte{'F', 0xff}, 1)
	checkCode(request("PUT", "application/json", invalidUTF8, 400), "validation_error")
	saved := request("PUT", "application/json; charset=utf-8", raw, 200)
	var first store.Architecture
	if err := json.Unmarshal(saved, &first); err != nil {
		t.Fatal(err)
	}
	if first.Version != 1 || first.UpdatedAt.IsZero() {
		t.Fatalf("invalid saved revision: %s", saved)
	}
	if got := request("GET", "", nil, 200); !bytes.Equal(got, saved) {
		t.Fatal("GET differs from saved model")
	}
	var conflict struct{ CurrentVersion int64 }
	response := request("PUT", "application/json", raw, 409)
	checkCode(response, "architecture_version_conflict")
	if err := json.Unmarshal(response, &conflict); err != nil || conflict.CurrentVersion != 1 {
		t.Fatalf("invalid conflict: %s", response)
	}
	for _, change := range []func(map[string]any){
		func(m map[string]any) { m["flows"] = []any{} },
		func(m map[string]any) {
			m["relationships"].([]any)[0].(map[string]any)["relationship-type"] = map[string]any{"connects": map[string]any{"source": map[string]any{"node": "missing"}, "destination": map[string]any{"node": "missing"}}}
		},
		func(m map[string]any) { delete(m, "metadata") },
	} {
		var m map[string]any
		if err := json.Unmarshal(first.Model, &m); err != nil {
			t.Fatal(err)
		}
		change(m)
		bad, err := json.Marshal(m)
		if err != nil {
			t.Fatal(err)
		}
		checkCode(request("PUT", "application/json", bad, 400), "validation_error")
		if got := request("GET", "", nil, 200); !bytes.Equal(got, saved) {
			t.Fatal("invalid update changed persisted state")
		}
	}
	updated := request("PUT", "application/json", first.Model, 200)
	var second store.Architecture
	if err := json.Unmarshal(updated, &second); err != nil || second.Version != 2 {
		t.Fatalf("invalid replacement: %s", updated)
	}
	pool.Close()
	checkCode(request("GET", "", nil, 503), "service_unavailable")
	checkCode(request("PUT", "application/json", second.Model, 503), "service_unavailable")
}
