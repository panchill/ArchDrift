package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/panchill/ArchDrift/backend/internal/ingest"
	"github.com/panchill/ArchDrift/backend/internal/store"
)

func main() {
	addr := os.Getenv("ADDR")
	if addr == "" {
		addr = ":8080"
	}
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		log.Fatal("DATABASE_URL обязателен")
	}

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		log.Fatalf("подключение к postgres: %v", err)
	}
	defer pool.Close()

	pingCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	if err := store.Migrate(pingCtx, pool); err != nil {
		log.Fatalf("миграции: %v", err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	})
	db := store.New(pool)
	mux.HandleFunc("POST /v1/traces", func(w http.ResponseWriter, r *http.Request) {
		ingest.Handle(w, r, db)
	})

	log.Printf("archdrift слушает %s", addr)
	log.Fatal(http.ListenAndServe(addr, mux))
}
