#!/usr/bin/env bash
# Arranca um PostgreSQL 16 local na porta 54322 para os testes de base de dados.
# Alternativa: qualquer Postgres 15+ — defina TEST_DATABASE_URL.
set -euo pipefail
PG_BIN="${PG_BIN:-$(dirname "$(command -v initdb 2>/dev/null || echo /usr/lib/postgresql/16/bin/initdb)")}"
DATA="${PGTEST_DATA:-.pgtest}"
if [ ! -d "$DATA" ]; then
  "$PG_BIN/initdb" -D "$DATA" -A trust -U postgres >/dev/null
fi
"$PG_BIN/pg_ctl" -D "$DATA" -o "-p 54322 -k /tmp" -l "$DATA/log" start
echo "Postgres de testes em postgresql://postgres@127.0.0.1:54322"
