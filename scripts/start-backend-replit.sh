#!/usr/bin/env bash
set -euo pipefail

cleanup() {
  trap - EXIT INT TERM
  for pid in "${BACKEND_PID:-}" "${REDIS_PID:-}"; do
    if [[ -n "$pid" ]]; then
      kill -- "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
    fi
  done
  wait 2>/dev/null || true
}

trap cleanup EXIT
trap 'cleanup; exit 130' INT
trap 'cleanup; exit 143' TERM

export PORT="${PORT:-3000}"
export NODE_ENV="${NODE_ENV:-production}"
export ALLOW_PUBLIC_SIGNUP="${ALLOW_PUBLIC_SIGNUP:-false}"
export REDIS_HOST="127.0.0.1"
export REDIS_PORT="6379"
export COOKIE_SECURE="true"
export COOKIE_SAME_SITE="lax"

setsid redis-server \
  --bind "$REDIS_HOST" \
  --port "$REDIS_PORT" \
  --save "" \
  --appendonly no &
REDIS_PID=$!

for _ in {1..30}; do
  if redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" ping >/dev/null 2>&1; then
    break
  fi
  sleep 0.2
done

setsid bash -c 'cd backend && exec npm start' &
BACKEND_PID=$!

wait "$BACKEND_PID"