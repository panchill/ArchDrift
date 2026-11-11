DEMO_REF ?= 3.1.0
DEMO_DIR := opentelemetry-demo
ROOT := $(abspath .)
ARCHDRIFT_URL ?= http://localhost:8081
MODEL := examples/opentelemetry-demo.architecture.json
STALE_EDGE := checkout--post-oteldemo-CheckoutService-PlaceOrder--to--email--post-send_order_confirmation

COMPOSE = cd $(DEMO_DIR) && \
	ARCHDRIFT_ROOT=$(ROOT) \
	ARCHDRIFT_REMOTE_URL=$(ARCHDRIFT_REMOTE_URL) \
	OTEL_COLLECTOR_CONFIG_EXTRAS=$(ROOT)/deploy/otelcol-config-extras.yml \
	docker compose \
	-f compose.yaml \
	-f compose.full.yaml \
	-f compose.observability.yaml \
	-f compose.extras.yaml \
	-f $(ROOT)/compose.yaml \
	$(EXTRA_COMPOSE) \
	--env-file .env \
	--env-file .env.override

.PHONY: up up-remote down reset logs model model-stale

up: $(DEMO_DIR)/.git
	touch $(DEMO_DIR)/.env.override
	$(COMPOSE) up -d --build
	@echo ""
	@echo "Магазин:       http://localhost:8080"
	@echo "Jaeger:        http://localhost:8080/jaeger/ui"
	@echo "ArchDrift API: http://localhost:8081"
	@echo "ArchDrift UI:  http://localhost:5173"
	@echo "Docker: не меньше 6 ГБ памяти."

# Как up, но Collector дополнительно шлёт трейсы в удалённый ArchDrift:
# make up-remote ARCHDRIFT_REMOTE_URL=https://<адрес бэкенда>
up-remote:
	@test -n "$(ARCHDRIFT_REMOTE_URL)" || { echo "задайте ARCHDRIFT_REMOTE_URL=https://<адрес бэкенда>"; exit 1; }
	$(MAKE) up EXTRA_COMPOSE="-f $(ROOT)/deploy/compose.remote.yaml" ARCHDRIFT_REMOTE_URL=$(ARCHDRIFT_REMOTE_URL)
	@echo "Трейсы также уходят в: $(ARCHDRIFT_REMOTE_URL)/v1/traces"
	@echo "Модель туда: make model ARCHDRIFT_URL=$(ARCHDRIFT_REMOTE_URL)"

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

model:
	jq . $(MODEL) | ARCHDRIFT_URL=$(ARCHDRIFT_URL) ./scripts/put-architecture.sh

model-stale:
	jq --arg id '$(STALE_EDGE)' \
		'if any(.relationships[]; .["unique-id"] == $$id) | not then error("нет связи \($$id)") else del(.relationships[] | select(.["unique-id"] == $$id)) end' \
		$(MODEL) | ARCHDRIFT_URL=$(ARCHDRIFT_URL) ./scripts/put-architecture.sh
