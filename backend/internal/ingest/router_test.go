package ingest

import (
	"bytes"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestRecoveryLogsStackWithoutSensitiveValues(t *testing.T) {
	var output bytes.Buffer
	previous := log.Writer()
	log.SetOutput(&output)
	defer log.SetOutput(previous)
	router := NewRouter(nil)
	router.GET("/panic-test", func(*gin.Context) { panic("sensitive-panic-value") })
	req := httptest.NewRequest(http.MethodGet, "/panic-test", strings.NewReader("sensitive-body"))
	req.Header.Set("Authorization", "sensitive-authorization")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d", rec.Code)
	}
	if !strings.Contains(output.String(), "HTTP handler panic") || !strings.Contains(output.String(), "router_test.go") {
		t.Fatal("panic diagnostics missing")
	}
	for _, secret := range []string{"sensitive-panic-value", "sensitive-body", "sensitive-authorization"} {
		if strings.Contains(output.String(), secret) {
			t.Fatal("sensitive value logged")
		}
	}
}
