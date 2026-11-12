# CI

[GitHub Actions](../.github/workflows/ci.yml) запускает проверки для PR в `main`, после push в `main` и вручную. Новый коммит в PR отменяет предыдущий запуск.

| Проверка | Что запускается |
| --- | --- |
| Frontend | Тесты интерфейса, проверка TypeScript и сборка |
| Contracts | Проверка моков по OpenAPI, примеров по CALM 1.2 и согласованности модели с анализом |
| Backend | `gofmt`, `go vet ./...`, `go test -race ./...` с PostgreSQL |

Версии Node.js и Go берутся из [`frontend/.nvmrc`](../frontend/.nvmrc) и [`backend/go.mod`](../backend/go.mod).

Локально `npm test` в `frontend/` запускает тесты интерфейса и контрактов. Для интеграционных тестов Go задайте `TEST_DATABASE_URL` с адресом тестового PostgreSQL. Тесты создают отдельные схемы. Проверка полного стенда OpenTelemetry Demo выполняется отдельно по [сценарию демо](../README.md#сценарий-демо).
