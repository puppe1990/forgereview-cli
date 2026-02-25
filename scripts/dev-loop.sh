#!/usr/bin/env bash
set -euo pipefail

PROFILE="${1:-quick}"
MAX_ITERS="${MAX_ITERS:-0}"   # 0 = infinite
SLEEP_SECS="${SLEEP_SECS:-2}"
FAIL_FAST="${FAIL_FAST:-1}"
REVIEW_TIMEOUT_MS="${REVIEW_TIMEOUT_MS:-120000}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

timestamp() { date +"%Y-%m-%d %H:%M:%S"; }
log() { printf "[%s] %s\n" "$(timestamp)" "$*"; }

run_step() {
  local name="$1"
  shift
  log "STEP $name"
  if "$@"; then
    log "OK   $name"
    return 0
  fi
  log "FAIL $name"
  return 1
}

run_typecheck() {
  if npm run | grep -qE '^[[:space:]]+typecheck'; then
    npm run typecheck
  else
    npx tsc --noEmit
  fi
}

run_review() {
  case "$PROFILE" in
    quick)
      node dist/index.js review --fast --format json --chunk-timeout-ms "$REVIEW_TIMEOUT_MS"
      ;;
    full)
      node dist/index.js review --full --fast --format json --chunk-workers 2 --chunk-timeout-ms "$REVIEW_TIMEOUT_MS"
      ;;
    fix)
      node dist/index.js review --fast --fix --format json --chunk-timeout-ms "$REVIEW_TIMEOUT_MS"
      ;;
    *)
      echo "Unknown profile: $PROFILE" >&2
      echo "Valid profiles: quick, full, fix" >&2
      return 2
      ;;
  esac
}

print_header() {
  cat <<EOF
ForgeReview Dev Loop
  profile: $PROFILE
  max iters: ${MAX_ITERS} (0 = infinite)
  sleep: ${SLEEP_SECS}s
  fail-fast: ${FAIL_FAST}
  review-timeout: ${REVIEW_TIMEOUT_MS}ms
  cwd: $ROOT_DIR
EOF
}

run_iteration() {
  local iter="$1"
  log "===== ITERATION $iter START ====="

  run_step "lint" npm run lint || return 1
  run_step "typecheck" run_typecheck || return 1
  if [[ "$PROFILE" != "quick" ]]; then
    run_step "test" npm test || return 1
  fi
  run_step "build" npm run build || return 1
  run_step "review($PROFILE)" run_review || return 1

  log "===== ITERATION $iter SUCCESS ====="
}

main() {
  print_header

  local iter=1
  while :; do
    if ! run_iteration "$iter"; then
      if [[ "$FAIL_FAST" == "1" ]]; then
        log "Stopping loop on first failure."
        exit 1
      fi
    fi

    if [[ "$MAX_ITERS" != "0" && "$iter" -ge "$MAX_ITERS" ]]; then
      log "Reached max iterations ($MAX_ITERS). Exiting."
      break
    fi

    iter=$((iter + 1))
    log "Sleeping ${SLEEP_SECS}s before next iteration..."
    sleep "$SLEEP_SECS"
  done
}

main "$@"
