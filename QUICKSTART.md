# Установка проекта

## Установка CALM

[Документация](https://calm.finos.org/tutorials/beginner/01-setup)

## Установка CALM-ai

В проекте, структура которого, будет описана:

```bash
calm init-ai
```

Использование: `/calm`

## Компиляция схемы в html-страницу

В opentelemetry-demo.architecture.json содержится архитектура [open-telemetry/opentelemetry-demo](https://github.com/open-telemetry/opentelemetry-demo/tree/main)

```bash
calm docify -a opentelemetry-demo.architecture.json -o ./output

cd output
npm install
npm start
```