DEMO_REF ?= 3.1.0
DEMO_DIR := opentelemetry-demo
ROOT := $(abspath .)

COMPOSE = cd $(DEMO_DIR) && \
	ARCHDRIFT_ROOT=$(ROOT) \
	OTEL_COLLECTOR_CONFIG_EXTRAS=$(ROOT)/deploy/otelcol-config-extras.yml \
	docker compose \
	-f compose.yaml \
	-f compose.full.yaml \
	-f compose.observability.yaml \
	-f compose.extras.yaml \
	-f $(ROOT)/compose.yaml \
	--env-file .env \
	--env-file .env.override

.PHONY: up down reset logs

up: $(DEMO_DIR)/.git
	touch $(DEMO_DIR)/.env.override
	$(COMPOSE) up -d --build
	@echo ""
	@echo "Магазин:       http://localhost:8080"
	@echo "Jaeger:        http://localhost:8080/jaeger/ui"
	@echo "ArchDrift API: http://localhost:8081"
	@echo "ArchDrift UI:  http://localhost:5173"
	@echo "Docker: не меньше 6 ГБ памяти."

down:
	@test -d $(DEMO_DIR) || { echo "стенд не развёрнут"; exit 0; }
	touch $(DEMO_DIR)/.env.override
	$(COMPOSE) down

reset:
	@test -d $(DEMO_DIR) || { echo "стенд не развёрнут"; exit 0; }
	touch $(DEMO_DIR)/.env.override
	$(COMPOSE) down -v

logs:
	@test -d $(DEMO_DIR) || { echo "стенд не развёрнут"; exit 1; }
	touch $(DEMO_DIR)/.env.override
	$(COMPOSE) logs -f --tail=200

$(DEMO_DIR)/.git:
	DEMO_REF=$(DEMO_REF) ./scripts/clone-demo.sh
