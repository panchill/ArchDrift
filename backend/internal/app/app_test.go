package app

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	"go.uber.org/fx"

	"github.com/panchill/ArchDrift/backend/internal/testdb"
)

func TestLifecycleMigratesAndDrainsBeforeClosingPool(t *testing.T) {
	dsn, _ := testdb.New(t)
	t.Setenv("DATABASE_URL", dsn)
	t.Setenv("ADDR", "127.0.0.1:0")
	entered, release := make(chan struct{}), make(chan struct{})
	var server *http.Server
	var pool *pgxpool.Pool
	application := New(fx.NopLogger, fx.Populate(&server, &pool), fx.Decorate(func(router *gin.Engine) *gin.Engine {
		router.GET("/drain-test", func(c *gin.Context) {
			close(entered)
			<-release
			if err := pool.Ping(c.Request.Context()); err != nil {
				c.Status(http.StatusServiceUnavailable)
				return
			}
			c.Status(http.StatusNoContent)
		})
		return router
	}))
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	defer cancel()
	if err := application.Start(ctx); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = application.Stop(context.Background()) })
	var version int
	if err := pool.QueryRow(ctx, "SELECT max(version_id) FROM goose_db_version WHERE is_applied").Scan(&version); err != nil || version != 2 {
		t.Fatalf("schema not ready: version=%d error=%v", version, err)
	}
	client := &http.Client{Timeout: 5 * time.Second}
	response, err := client.Get("http://" + server.Addr + "/healthz")
	if err != nil {
		t.Fatal(err)
	}
	var health struct {
		Status string `json:"status"`
	}
	err = json.NewDecoder(response.Body).Decode(&health)
	response.Body.Close()
	if err != nil || response.StatusCode != 200 || health.Status != "ok" {
		t.Fatalf("health=%+v status=%d error=%v", health, response.StatusCode, err)
	}
	requestDone := make(chan error, 1)
	go func() {
		response, err := client.Get("http://" + server.Addr + "/drain-test")
		if err == nil {
			response.Body.Close()
			if response.StatusCode != http.StatusNoContent {
				err = context.Canceled
			}
		}
		requestDone <- err
	}()
	select {
	case <-entered:
	case <-ctx.Done():
		t.Fatal("request did not enter")
	}
	stopped := make(chan error, 1)
	go func() { stopped <- application.Stop(ctx) }()
	// Shutdown closes the listener before waiting for the active request to finish.
	for {
		conn, err := net.DialTimeout("tcp", server.Addr, 20*time.Millisecond)
		if err != nil {
			break
		}
		conn.Close()
		select {
		case <-ctx.Done():
			close(release)
			t.Fatal("listener still open")
		case <-time.After(time.Millisecond):
		}
	}
	close(release)
	if err := <-requestDone; err != nil {
		t.Fatalf("request was not drained: %v", err)
	}
	if err := <-stopped; err != nil {
		t.Fatal(err)
	}
	if pool.Stat().TotalConns() != 0 {
		t.Fatal("database pool remains open")
	}
}

func TestListenFailureClosesPool(t *testing.T) {
	dsn, _ := testdb.New(t)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	t.Setenv("DATABASE_URL", dsn)
	t.Setenv("ADDR", listener.Addr().String())
	var pool *pgxpool.Pool
	application := New(fx.NopLogger, fx.Populate(&pool))
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	defer cancel()
	if err := application.Start(ctx); err == nil {
		_ = application.Stop(ctx)
		t.Fatal("occupied port accepted")
	}
	if pool.Stat().TotalConns() != 0 {
		t.Fatal("failed startup leaked the pool")
	}
}
