#!/bin/sh
set -eu

url="${ARCHDRIFT_URL:-http://localhost:8081}"
url="${url%/}"

body=$(mktemp)
resp=$(mktemp)
trap 'rm -f "$body" "$resp"' EXIT
cat > "$body"

code=$(curl -sS -o "$resp" -w '%{http_code}' "$url/api/v1/architecture")
if [ "$code" = "404" ]; then
  version=0
elif [ "$code" = "200" ]; then
  version=$(jq -er '.version' "$resp")
else
  echo "GET $url/api/v1/architecture: HTTP $code" >&2
  cat "$resp" >&2
  exit 1
fi

jq --argjson version "$version" '.metadata.archdrift.version = $version' "$body" > "$resp"

put_code=$(curl -sS -o "$body" -w '%{http_code}' -X PUT "$url/api/v1/architecture" \
  -H 'Content-Type: application/json' \
  --data-binary @"$resp")
if [ "$put_code" != "200" ]; then
  echo "PUT $url/api/v1/architecture: HTTP $put_code" >&2
  cat "$body" >&2
  exit 1
fi

jq -er '"version=\(.version) relationships=\(.model.relationships | length)"' "$body"
