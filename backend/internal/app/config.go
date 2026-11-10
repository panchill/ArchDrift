package app

import (
	"errors"
	"net"
	"os"
	"strconv"
)

type config struct {
	Addr        string
	DatabaseURL string
}

func loadConfig() (config, error) {
	cfg := config{Addr: os.Getenv("ADDR"), DatabaseURL: os.Getenv("DATABASE_URL")}
	if cfg.DatabaseURL == "" {
		return config{}, errors.New("DATABASE_URL is required")
	}
	if cfg.Addr == "" {
		port := os.Getenv("PORT")
		if port == "" {
			port = "8080"
		}
		n, err := strconv.Atoi(port)
		if err != nil || n < 1 || n > 65535 {
			return config{}, errors.New("PORT must be between 1 and 65535")
		}
		cfg.Addr = net.JoinHostPort("", port)
	}
	return cfg, nil
}
