#!/usr/bin/env bash
set -euo pipefail

FRONTEND_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="$(cd "$FRONTEND_DIR/.." && pwd)"
PYTHON_DIR="$APP_DIR/ai-service-python"
BACKEND_DIR="$APP_DIR/backend-java"
RUN_DIR="$(mktemp -d "${TMPDIR:-/tmp}/lyle-v64-real-e2e.XXXXXX")"
RUN_ID="$(basename "$RUN_DIR" | tr -cd '[:alnum:]')"
MYSQL_DATABASE="lyle_v64_real_java_${RUN_ID}"
POSTGRES_DATABASE="lyle_v64_real_python_${RUN_ID}"
MYSQL_HOST="${V64_REAL_MYSQL_HOST:-127.0.0.1}"
MYSQL_PORT="${V64_REAL_MYSQL_PORT:-3306}"
MYSQL_USER="${V64_REAL_MYSQL_USER:-root}"
MYSQL_PASSWORD="${V64_REAL_MYSQL_PASSWORD:-}"
POSTGRES_HOST="${V64_REAL_POSTGRES_HOST:-127.0.0.1}"
POSTGRES_PORT="${V64_REAL_POSTGRES_PORT:-5432}"
POSTGRES_USER="${V64_REAL_POSTGRES_USER:-$(id -un)}"
POSTGRES_PASSWORD="${V64_REAL_POSTGRES_PASSWORD:-}"
INTERNAL_TOKEN="v64-real-internal-token-5f95485f659c4b94aee9a7c7d8a4879b"
USAGE_TOKEN="v64-real-usage-token-32cb27de7ca24fe08ea3e7bff5132904"
PIDS=()
MYSQL_CREATED=false
POSTGRES_CREATED=false

mysql_command() {
  MYSQL_PWD="$MYSQL_PASSWORD" mysql \
    -h "$MYSQL_HOST" \
    -P "$MYSQL_PORT" \
    -u "$MYSQL_USER" \
    "$@"
}

postgres_dsn() {
  if [[ -n "$POSTGRES_PASSWORD" ]]; then
    printf 'postgresql://%s:%s@%s:%s/%s' \
      "$POSTGRES_USER" "$POSTGRES_PASSWORD" "$POSTGRES_HOST" "$POSTGRES_PORT" "$POSTGRES_DATABASE"
  else
    printf 'postgresql://%s@%s:%s/%s' \
      "$POSTGRES_USER" "$POSTGRES_HOST" "$POSTGRES_PORT" "$POSTGRES_DATABASE"
  fi
}

cleanup_attachment_files() {
  local object_key
  local target
  local storage_root="$APP_DIR/storage/chat-attachments"
  [[ "$MYSQL_CREATED" == "true" ]] || return 0
  while IFS= read -r object_key; do
    if [[ "$object_key" =~ ^[0-9]+/[0-9a-f-]{36}\.(txt|md|csv|json|log|pdf|docx|xlsx)$ ]]; then
      target="$storage_root/$object_key"
      rm -f -- "$target"
      rmdir -- "$(dirname "$target")" >/dev/null 2>&1 || true
    fi
  done < <(mysql_command "$MYSQL_DATABASE" -Nse \
    "SELECT object_key FROM chat_attachment WHERE storage_provider = 'LOCAL'" 2>/dev/null || true)
}

cleanup() {
  local pid
  for pid in "${PIDS[@]:-}"; do
    kill "$pid" >/dev/null 2>&1 || true
  done
  wait "${PIDS[@]:-}" >/dev/null 2>&1 || true

  cleanup_attachment_files
  if [[ "$MYSQL_CREATED" == "true" && "$MYSQL_DATABASE" =~ ^lyle_v64_real_java_[[:alnum:]]+$ ]]; then
    mysql_command -e "DROP DATABASE IF EXISTS \`$MYSQL_DATABASE\`" >/dev/null 2>&1 || true
  fi
  if [[ "$POSTGRES_CREATED" == "true" && "$POSTGRES_DATABASE" =~ ^lyle_v64_real_python_[[:alnum:]]+$ ]]; then
    PGPASSWORD="$POSTGRES_PASSWORD" dropdb \
      --if-exists \
      --host "$POSTGRES_HOST" \
      --port "$POSTGRES_PORT" \
      --username "$POSTGRES_USER" \
      "$POSTGRES_DATABASE" >/dev/null 2>&1 || true
  fi
  rm -rf "$RUN_DIR"
}
trap cleanup EXIT INT TERM

for command in mysql createdb dropdb curl; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "V6.4 real E2E requires '$command'." >&2
    exit 2
  fi
done

for port in 8004 8084 4176; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "V6.4 real E2E requires port $port to be free." >&2
    exit 2
  fi
done

if [[ ! -x "$PYTHON_DIR/.venv312/bin/uvicorn" || ! -x "$PYTHON_DIR/.venv312/bin/alembic" ]]; then
  echo "V6.4 real E2E requires ai-service-python/.venv312." >&2
  exit 2
fi

mysql_command -e "CREATE DATABASE \`$MYSQL_DATABASE\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
MYSQL_CREATED=true
PGPASSWORD="$POSTGRES_PASSWORD" createdb \
  --host "$POSTGRES_HOST" \
  --port "$POSTGRES_PORT" \
  --username "$POSTGRES_USER" \
  "$POSTGRES_DATABASE"
POSTGRES_CREATED=true

(
  cd "$PYTHON_DIR"
  export POSTGRES_ENABLED=true
  export POSTGRES_DSN
  POSTGRES_DSN="$(postgres_dsn)"
  exec .venv312/bin/alembic upgrade head
) >"$RUN_DIR/alembic.log" 2>&1

(
  cd "$PYTHON_DIR"
  export INTERNAL_API_TOKEN="$INTERNAL_TOKEN"
  export POSTGRES_ENABLED=true
  export POSTGRES_DSN
  POSTGRES_DSN="$(postgres_dsn)"
  export POSTGRES_POOL_MIN_SIZE=1
  export POSTGRES_POOL_MAX_SIZE=4
  export REDIS_ENABLED=false
  export MINIO_ENABLED=false
  export QDRANT_ENABLED=false
  export MILVUS_ENABLED=false
  export NOTIFICATION_WORKER_ENABLED=false
  export MEMORY_DECAY_WORKER_ENABLED=false
  export AUTOMATION_WORKER_ENABLED=false
  export AI_USAGE_REPORTING_ENABLED=true
  export AI_USAGE_OUTBOX_WORKER_ENABLED=true
  export AI_USAGE_OUTBOX_WORKER_INTERVAL_SECONDS=1
  export AI_USAGE_JAVA_BASE_URL=http://127.0.0.1:8084/api
  export AI_USAGE_INTERNAL_TOKEN="$USAGE_TOKEN"
  exec .venv312/bin/uvicorn app.main:app --host 127.0.0.1 --port 8004
) >"$RUN_DIR/python.log" 2>&1 &
PIDS+=("$!")

(
  cd "$BACKEND_DIR"
  export MYSQL_URL="jdbc:mysql://$MYSQL_HOST:$MYSQL_PORT/$MYSQL_DATABASE?useUnicode=true&characterEncoding=utf8&serverTimezone=Asia/Shanghai&useSSL=false&allowPublicKeyRetrieval=true"
  export MYSQL_USERNAME="$MYSQL_USER"
  export MYSQL_PASSWORD="$MYSQL_PASSWORD"
  export JWT_SECRET="v64-real-jwt-secret-31408ee333ed4bd49756c16bbb9e35f8"
  export JWT_KEY_ID=v64-real-current
  export AUTH_ACCEPT_LEGACY_JWT=false
  export AUTH_ALLOWED_ORIGINS=http://127.0.0.1:4176
  export REFRESH_COOKIE_SECURE=false
  export AUTH_SESSION_V64_ENABLED=true
  export AUTH_RATE_LIMIT_PER_MINUTE=240
  export AUTH_LOGIN_USERNAME_RATE_LIMIT_PER_MINUTE=60
  export AUTH_REGISTER_RATE_LIMIT_PER_MINUTE=60
  export AUTH_REFRESH_RATE_LIMIT_PER_MINUTE=120
  export AUTH_PASSWORD_RATE_LIMIT_PER_MINUTE=60
  export CHAT_RATE_LIMIT_PER_MINUTE=120
  export AI_SERVICE_BASE_URL=http://127.0.0.1:8004
  export AI_SERVICE_INTERNAL_TOKEN="$INTERNAL_TOKEN"
  export AI_USAGE_LEDGER_ENABLED=true
  export AI_USAGE_QUOTA_ENFORCEMENT_ENABLED=true
  export AI_USAGE_USER_VIEW_ENABLED=true
  export AI_USAGE_INTERNAL_TOKEN="$USAGE_TOKEN"
  export REDIS_ENABLED=false
  export MINIO_ENABLED=false
  export QDRANT_ENABLED=false
  export TOS_ENABLED=false
  export MISSION_ENABLED=true
  export MISSION_EXECUTION_ENABLED=false
  export MISSION_R1_ENABLED=false
  export MISSION_SHADOW_ONLY=true
  export MISSION_ENABLED_USERS='*'
  exec mvn -q spring-boot:run \
    -Dspring-boot.run.arguments='--server.port=8084 --app.chat-attachment.cleanup-millis=500'
) >"$RUN_DIR/java.log" 2>&1 &
PIDS+=("$!")

wait_for_url() {
  local name="$1"
  local url="$2"
  local log_file="$3"
  local attempt
  for attempt in $(seq 1 150); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "$name did not become healthy: $url" >&2
  tail -n 180 "$log_file" >&2 || true
  return 1
}

wait_for_url "Python service" "http://127.0.0.1:8004/health" "$RUN_DIR/python.log"
wait_for_url "Java service" "http://127.0.0.1:8084/api/actuator/health" "$RUN_DIR/java.log"

export V64_REAL_BACKEND_URL=http://127.0.0.1:8084
export V64_REAL_USAGE_TOKEN="$USAGE_TOKEN"

cd "$FRONTEND_DIR"
if ! npm run test:e2e:v64-real:spec; then
  echo "Alembic log:" >&2
  tail -n 100 "$RUN_DIR/alembic.log" >&2 || true
  echo "Python service log:" >&2
  tail -n 180 "$RUN_DIR/python.log" >&2 || true
  echo "Java service log:" >&2
  tail -n 220 "$RUN_DIR/java.log" >&2 || true
  exit 1
fi
