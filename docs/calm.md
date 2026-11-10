# CALM: просмотр модели архитектуры

Модель архитектуры ArchDrift описывается в формате [CALM 1.2](https://calm.finos.org/). Инструменты CALM позволяют посмотреть модель как сайт-документацию: схема, карточки узлов, интерфейсы и связи. Для работы самого ArchDrift они не нужны.

## Установка CALM CLI

Нужен Node.js. Установка — по [официальной инструкции](https://calm.finos.org/tutorials/beginner/01-setup).

## ИИ-помощник для описания архитектуры (необязательно)

В проекте, структуру которого нужно описать:

```bash
calm init-ai
```

Использование: команда `/calm` в помощнике.

## Сборка сайта из модели

`examples/opentelemetry-demo.architecture.json` — модель [OpenTelemetry Demo (Astronomy Shop)](https://github.com/open-telemetry/opentelemetry-demo/tree/main).

Из корня репозитория:

```bash
calm docify -a examples/opentelemetry-demo.architecture.json -o examples/output

cd examples/output
npm install
npm run build
npm run serve
```

Откройте адрес, который напечатает `serve` (обычно http://localhost:3000).

- `examples/output` — сгенерированные файлы, папка в `.gitignore`.
- В режиме разработки (`npm start`) при наведении на узлы схемы появляется ошибка `tooltipElem.transition is not a function`. Это ошибка шаблона CALM, а не модели: сборка через `npm run build` и `npm run serve` её не показывает.
