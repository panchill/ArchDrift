package app

import "testing"

func TestLoadConfig(t *testing.T) {
	for _, tt := range []struct {
		name, addr, port, want string
		invalid                bool
	}{
		{"default", "", "", ":8080", false},
		{"railway", "", "9345", ":9345", false},
		{"explicit address", "127.0.0.1:8081", "9345", "127.0.0.1:8081", false},
		{"invalid port", "", "not-a-port", "", true},
		{"zero port", "", "0", "", true},
		{"out of range", "", "65536", "", true},
	} {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv("DATABASE_URL", "postgres://localhost/test")
			t.Setenv("ADDR", tt.addr)
			t.Setenv("PORT", tt.port)
			cfg, err := loadConfig()
			if (err != nil) != tt.invalid {
				t.Fatalf("error = %v", err)
			}
			if !tt.invalid && cfg.Addr != tt.want {
				t.Fatalf("address = %q, want %q", cfg.Addr, tt.want)
			}
		})
	}
	t.Setenv("DATABASE_URL", "")
	if _, err := loadConfig(); err == nil {
		t.Fatal("missing DATABASE_URL accepted")
	}
}
