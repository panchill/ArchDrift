#!/bin/sh
# Клонирует зафиксированный релиз OpenTelemetry Demo в ./opentelemetry-demo.
# Уже существующий каталог не перезаписывается.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
DIR="$ROOT/opentelemetry-demo"
REF="${DEMO_REF:-3.1.0}"

if [ -d "$DIR/.git" ]; then
  echo "opentelemetry-demo уже есть, не трогаю (зафиксированный релиз — $REF)"
  exit 0
fi
if [ -e "$DIR" ]; then
  echo "opentelemetry-demo существует, но это не git-клон" >&2
  exit 1
fi

git clone --depth 1 --branch "$REF" https://github.com/open-telemetry/opentelemetry-demo.git "$DIR"
