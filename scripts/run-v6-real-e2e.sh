#!/usr/bin/env bash
set -euo pipefail

FRONTEND_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="$(cd "$FRONTEND_DIR/.." && pwd)"
PYTHON_DIR="$APP_DIR/ai-service-python"
BACKEND_DIR="$APP_DIR/backend-java"
LOG_DIR="$(mktemp -d "${TMPDIR:-/tmp}/lyle-v6-real-e2e.XXXXXX")"
PIDS=()

cleanup() {
  local pid
  for pid in "${PIDS[@]:-}"; do
    kill "$pid" >/dev/null 2>&1 || true
  done
  wait "${PIDS[@]:-}" >/dev/null 2>&1 || true
  rm -rf "$LOG_DIR"
}
trap cleanup EXIT INT TERM

for port in 8000 8082 18080; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "V6 real E2E requires port $port to be free." >&2
    exit 2
  fi
done

node "$FRONTEND_DIR/scripts/v5-search-fixture.mjs" >"$LOG_DIR/search-fixture.log" 2>&1 &
PIDS+=("$!")

(
  cd "$PYTHON_DIR"
  export TOOL_WEB_SEARCH_ENABLED=true
  export TOOL_WEB_SEARCH_PROVIDER=tavily
  export TOOL_WEB_SEARCH_API_KEY=v6-e2e-fixture-key
  export TOOL_WEB_SEARCH_BASE_URL=http://127.0.0.1:18080/search
  exec .venv312/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
) >"$LOG_DIR/python.log" 2>&1 &
PIDS+=("$!")

(
  cd "$BACKEND_DIR"
  export APP_AGENT_TASK_DYNAMIC_ENABLED=true
  export APP_AGENT_TASK_ENABLED_USERS='*'
  export APP_AGENT_TASK_ENABLED_MODELS='*'
  export MISSION_ENABLED=true
  export MISSION_EXECUTION_ENABLED=true
  export MISSION_R1_ENABLED=true
  export MISSION_SHADOW_ONLY=false
  export MISSION_ENABLED_USERS='*'
  export AGENT_TASK_MAX_PARALLEL_READ_BRANCHES=3
  export MISSION_SCHEDULER_SCAN_MILLIS=500
  exec mvn -q spring-boot:run -Dspring-boot.run.arguments='--server.port=8082'
) >"$LOG_DIR/java.log" 2>&1 &
JAVA_PID="$!"
PIDS+=("$JAVA_PID")
export V6_REAL_JAVA_PID="$JAVA_PID"
export V6_REAL_BACKEND_DIR="$BACKEND_DIR"

wait_for_url() {
  local name="$1"
  local url="$2"
  local log_file="$3"
  local attempt
  for attempt in $(seq 1 120); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "$name did not become healthy: $url" >&2
  tail -n 160 "$log_file" >&2 || true
  return 1
}

wait_for_url "Search fixture" "http://127.0.0.1:18080/health" "$LOG_DIR/search-fixture.log"
wait_for_url "Python service" "http://127.0.0.1:8000/health" "$LOG_DIR/python.log"
wait_for_url "Java service" "http://127.0.0.1:8082/api/actuator/health" "$LOG_DIR/java.log"

export APP_AGENT_TASK_DYNAMIC_ENABLED=true
export APP_AGENT_TASK_ENABLED_USERS='*'
export APP_AGENT_TASK_ENABLED_MODELS='*'
export MISSION_ENABLED=true
export MISSION_EXECUTION_ENABLED=true
export MISSION_R1_ENABLED=true
export MISSION_SHADOW_ONLY=false
export MISSION_ENABLED_USERS='*'
export AGENT_TASK_MAX_PARALLEL_READ_BRANCHES=3
export MISSION_SCHEDULER_SCAN_MILLIS=500

cd "$FRONTEND_DIR"
if ! npm run test:e2e:v6-real:spec; then
  echo "Python service log:" >&2
  tail -n 160 "$LOG_DIR/python.log" >&2 || true
  echo "Java service log:" >&2
  tail -n 200 "$LOG_DIR/java.log" >&2 || true
  exit 1
fi
