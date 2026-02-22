#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-both}"
REGION="${AWS_REGION:-us-east-1}"

DEV_ALARM_NAME="${DEV_ALARM_NAME:-InfraStack-alb-target-5xx}"
STAGING_ALARM_NAME="${STAGING_ALARM_NAME:-InfraStack-staging-v2-alb-target-5xx}"

wait_for_alarm_state() {
  local alarm_name="$1"
  local expected_state="$2"
  local attempts="${3:-30}"
  local sleep_seconds="${4:-5}"

  for ((i = 1; i <= attempts; i += 1)); do
    local state
    state="$(aws cloudwatch describe-alarms \
      --region "$REGION" \
      --alarm-names "$alarm_name" \
      --query 'MetricAlarms[0].StateValue' \
      --output text)"
    if [[ "$state" == "$expected_state" ]]; then
      return 0
    fi
    sleep "$sleep_seconds"
  done

  local final_state
  final_state="$(aws cloudwatch describe-alarms \
    --region "$REGION" \
    --alarm-names "$alarm_name" \
    --query 'MetricAlarms[0].StateValue' \
    --output text)"
  echo "[$alarm_name] expected state $expected_state, final state $final_state" >&2
  return 1
}

exercise_alarm() {
  local alarm_name="$1"
  local ts
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  echo "== Alarm smoke: $alarm_name =="

  aws cloudwatch set-alarm-state \
    --region "$REGION" \
    --alarm-name "$alarm_name" \
    --state-value ALARM \
    --state-reason "Synthetic alarm smoke test ($ts) -> ALARM" >/dev/null

  wait_for_alarm_state "$alarm_name" "ALARM"

  aws cloudwatch set-alarm-state \
    --region "$REGION" \
    --alarm-name "$alarm_name" \
    --state-value OK \
    --state-reason "Synthetic alarm smoke test ($ts) -> OK" >/dev/null

  wait_for_alarm_state "$alarm_name" "OK"
  echo "[$alarm_name] alarm smoke passed"
}

case "$MODE" in
  dev)
    exercise_alarm "$DEV_ALARM_NAME"
    ;;
  staging)
    exercise_alarm "$STAGING_ALARM_NAME"
    ;;
  both)
    exercise_alarm "$DEV_ALARM_NAME"
    exercise_alarm "$STAGING_ALARM_NAME"
    ;;
  *)
    echo "Usage: $0 [dev|staging|both]" >&2
    exit 1
    ;;
esac
