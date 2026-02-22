#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-both}"
REGION="${AWS_REGION:-us-east-1}"
ACCOUNT_ID="${ACCOUNT_ID:-726792844549}"
SMOKE_USERNAME="${SMOKE_USERNAME:-dev.user@unityappeals.local}"
SMOKE_PASSWORD="${SMOKE_PASSWORD:-DevPass1!DevPass1!}"

DEV_ALB_URL="${DEV_ALB_URL:-http://InfraS-Unity-C35fhtjknemR-1912925693.us-east-1.elb.amazonaws.com}"
DEV_COGNITO_CLIENT_ID="${DEV_COGNITO_CLIENT_ID:-7a3qa4prrq1h9v71snfhqo36f4}"
DEV_STACK_NAME="${DEV_STACK_NAME:-InfraStack}"

STAGING_ALB_URL="${STAGING_ALB_URL:-http://InfraS-Unity-iGMyoO90DG4I-1920092028.us-east-1.elb.amazonaws.com}"
STAGING_COGNITO_CLIENT_ID="${STAGING_COGNITO_CLIENT_ID:-5395vq9loa484ipjcgtr3o5lh2}"
STAGING_STACK_NAME="${STAGING_STACK_NAME:-InfraStack-staging-v2}"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

RESPONSE_CODE=""
RESPONSE_BODY=""

request_json() {
  local method="$1"
  local url="$2"
  local auth_header="${3:-}"
  local payload="${4:-}"
  local auth_header_name="${5:-Authorization}"
  local body_file="$TMP_DIR/body.$RANDOM.json"
  local code_file="$TMP_DIR/code.$RANDOM.txt"
  local formatted_auth=""

  if [[ -n "$auth_header" ]]; then
    if [[ "$auth_header_name" == "Authorization" ]]; then
      formatted_auth="Bearer $auth_header"
    else
      formatted_auth="$auth_header"
    fi
  fi

  if [[ -n "$formatted_auth" && -n "$payload" ]]; then
    curl -sS -o "$body_file" -w "%{http_code}" -X "$method" \
      -H "${auth_header_name}: ${formatted_auth}" \
      -H "content-type: application/json" \
      "$url" -d "$payload" >"$code_file"
  elif [[ -n "$formatted_auth" ]]; then
    curl -sS -o "$body_file" -w "%{http_code}" -X "$method" \
      -H "${auth_header_name}: ${formatted_auth}" \
      "$url" >"$code_file"
  elif [[ -n "$payload" ]]; then
    curl -sS -o "$body_file" -w "%{http_code}" -X "$method" \
      -H "content-type: application/json" \
      "$url" -d "$payload" >"$code_file"
  else
    curl -sS -o "$body_file" -w "%{http_code}" -X "$method" "$url" >"$code_file"
  fi

  RESPONSE_CODE="$(cat "$code_file")"
  RESPONSE_BODY="$(cat "$body_file")"
}

json_field() {
  local json="$1"
  local path="$2"
  printf "%s" "$json" | node -e '
    let data = "";
    process.stdin.on("data", (d) => (data += d));
    process.stdin.on("end", () => {
      const obj = JSON.parse(data);
      const parts = process.argv[1].split(".");
      let cur = obj;
      for (const p of parts) {
        cur = cur?.[p];
      }
      if (cur === undefined || cur === null) {
        process.exit(1);
      }
      process.stdout.write(String(cur));
    });
  ' "$path"
}

expect_code() {
  local actual="$1"
  local expected="$2"
  local context="$3"
  if [[ "$actual" != "$expected" ]]; then
    echo "[$context] expected HTTP $expected, got $actual" >&2
    exit 1
  fi
}

processor_token() {
  local stack_name="$1"
  node -e "const {createHash}=require('node:crypto');process.stdout.write(createHash('sha256').update('${ACCOUNT_ID}:${REGION}:${stack_name}:export-processor:v1').digest('hex'));"
}

smoke_env() {
  local env_name="$1"
  local alb_url="$2"
  local client_id="$3"
  local stack_name="$4"

  echo "== Smoke: $env_name =="

  local token
  token="$(aws cognito-idp initiate-auth \
    --region "$REGION" \
    --auth-flow USER_PASSWORD_AUTH \
    --client-id "$client_id" \
    --auth-parameters "USERNAME=$SMOKE_USERNAME,PASSWORD=$SMOKE_PASSWORD" \
    --query 'AuthenticationResult.IdToken' \
    --output text)"
  if [[ -z "$token" || "$token" == "None" ]]; then
    echo "[$env_name] failed to obtain auth token" >&2
    exit 1
  fi

  request_json GET "$alb_url/api/threads" "$token"
  expect_code "$RESPONSE_CODE" "200" "$env_name threads:list"

  local title="Smoke ${env_name} $(date -u +%Y%m%dT%H%M%SZ)"
  request_json POST "$alb_url/api/threads" "$token" "{\"patientCaseTitle\":\"$title\"}"
  expect_code "$RESPONSE_CODE" "201" "$env_name threads:create"
  local thread_id
  thread_id="$(json_field "$RESPONSE_BODY" "data.thread.id")"

  request_json POST "$alb_url/api/documents/$thread_id/generate" "$token" '{"kind":"appeal","instructions":"Draft concise non-PHI appeal summary."}'
  expect_code "$RESPONSE_CODE" "201" "$env_name documents:generate"
  local document_id
  document_id="$(json_field "$RESPONSE_BODY" "data.documentId")"

  request_json POST "$alb_url/api/documents/$document_id/export" "$token" '{"format":"pdf"}'
  expect_code "$RESPONSE_CODE" "201" "$env_name export:queue"
  local export_id
  export_id="$(json_field "$RESPONSE_BODY" "data.exportId")"

  request_json POST "$alb_url/api/internal/exports/process" "" '{"limit":1}'
  expect_code "$RESPONSE_CODE" "401" "$env_name internal:unauthorized"

  local proc_token
  proc_token="$(processor_token "$stack_name")"
  request_json POST "$alb_url/api/internal/exports/process" "$proc_token" '{"limit":5}' "x-export-processor-token"
  expect_code "$RESPONSE_CODE" "200" "$env_name internal:authorized"

  local status="" download_url="" error_message=""
  for _ in {1..20}; do
    request_json GET "$alb_url/api/documents/$document_id/export/$export_id" "$token"
    expect_code "$RESPONSE_CODE" "200" "$env_name export:status"
    status="$(json_field "$RESPONSE_BODY" "data.status" || true)"
    if [[ "$status" == "completed" ]]; then
      download_url="$(json_field "$RESPONSE_BODY" "data.downloadUrl" || true)"
      break
    fi
    if [[ "$status" == "failed" ]]; then
      error_message="$(json_field "$RESPONSE_BODY" "data.errorMessage" || true)"
      echo "[$env_name] export failed: ${error_message:-unknown}" >&2
      exit 1
    fi
    sleep 2
  done

  if [[ "$status" != "completed" ]]; then
    echo "[$env_name] export did not complete in expected time (last status=$status)" >&2
    exit 1
  fi
  if [[ -z "$download_url" ]]; then
    echo "[$env_name] export completed without download URL" >&2
    exit 1
  fi

  echo "[$env_name] smoke passed"
}

case "$MODE" in
  dev)
    smoke_env "dev" "$DEV_ALB_URL" "$DEV_COGNITO_CLIENT_ID" "$DEV_STACK_NAME"
    ;;
  staging)
    smoke_env "staging" "$STAGING_ALB_URL" "$STAGING_COGNITO_CLIENT_ID" "$STAGING_STACK_NAME"
    ;;
  both)
    smoke_env "dev" "$DEV_ALB_URL" "$DEV_COGNITO_CLIENT_ID" "$DEV_STACK_NAME"
    smoke_env "staging" "$STAGING_ALB_URL" "$STAGING_COGNITO_CLIENT_ID" "$STAGING_STACK_NAME"
    ;;
  *)
    echo "Usage: $0 [dev|staging|both]" >&2
    exit 1
    ;;
esac
