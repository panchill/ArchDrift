#!/bin/sh
# Envoy пишет http.method только на входящий спан. Исходящий (router … egress)
# без метода не становится HTTP-вызовом, и связь frontend-proxy → frontend не строится.
# Тег берётся из :method того же запроса и дальше копируется коллектором в http.request.method.
awk '
  /spawn_upstream_span: true/ && !done {
    print
    print "                  custom_tags:"
    print "                    - tag: http.method"
    print "                      request_header:"
    print "                        name: \":method\""
    done = 1
    next
  }
  { print }
' envoy.tmpl.yaml | envsubst > envoy.yaml && exec envoy -c envoy.yaml
