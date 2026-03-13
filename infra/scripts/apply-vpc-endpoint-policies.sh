#!/usr/bin/env bash
set -euo pipefail

ENV_NAME="${1:-dev}"
MODE="${2:-apply}"
ADDITIONAL_SECRET_ARNS="${ADDITIONAL_SECRET_ARNS:-}"
ADDITIONAL_KMS_KEY_ARNS="${ADDITIONAL_KMS_KEY_ARNS:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CDK_CONFIG_FILE="$INFRA_DIR/cdk.json"

read_context_value() {
  local path="$1"
  node -e '
    const fs = require("fs");
    const file = process.argv[1];
    const path = process.argv[2];
    const json = JSON.parse(fs.readFileSync(file, "utf8"));
    const value = path.split(".").reduce((acc, part) => acc?.[part], json.context);
    if (value === undefined || value === null) {
      process.exit(1);
    }
    if (typeof value === "object") {
      process.stdout.write(JSON.stringify(value));
      process.exit(0);
    }
    process.stdout.write(String(value));
  ' "$CDK_CONFIG_FILE" "$path"
}

stack_name_for_env() {
  case "$1" in
    dev) echo "InfraStack" ;;
    staging) echo "NetworkStack-staging" ;;
    prod) echo "NetworkStack-prod" ;;
    *) echo "Unsupported environment: $1" >&2; exit 1 ;;
  esac
}

read_endpoint_output() {
  local stack_name="$1"
  local key_fragment="$2"
  aws cloudformation describe-stacks \
    --region "$REGION" \
    --stack-name "$stack_name" \
    --query "Stacks[0].Outputs[?contains(OutputKey, \`${key_fragment}\`)].OutputValue | [0]" \
    --output text
}

secret_name_from_id() {
  local secret_id="$1"
  if [[ "$secret_id" == arn:*:secret:* ]]; then
    printf '%s\n' "${secret_id##*:secret:}"
    return 0
  fi
  printf '%s\n' "$secret_id"
}

describe_secret_json() {
  local secret_id="$1"
  aws secretsmanager describe-secret \
    --region "$REGION" \
    --secret-id "$secret_id" \
    --output json
}

list_stack_secret_arns() {
  local name_prefix="$1"
  aws secretsmanager list-secrets \
    --region "$REGION" \
    --query "SecretList[?starts_with(Name, '${name_prefix}')].ARN" \
    --output text 2>/dev/null || true
}

secret_pattern_from_json() {
  local secret_json="$1"
  node -e '
    const secret = JSON.parse(process.argv[1]);
    const arnParts = secret.ARN.split(":");
    const partition = arnParts[1];
    const service = arnParts[2];
    const region = arnParts[3];
    const accountId = arnParts[4];
    process.stdout.write(`arn:${partition}:${service}:${region}:${accountId}:secret:${secret.Name}*`);
  ' "$secret_json"
}

REGION="$(read_context_value "environments.${ENV_NAME}.region")"
ACCOUNT_ID="$(read_context_value "environments.${ENV_NAME}.account")"
DB_SECRET_ARN="$(read_context_value "environments.${ENV_NAME}.dbSecretArn")"
DB_INSTANCE_IDENTIFIER="$(read_context_value "environments.${ENV_NAME}.dbInstanceIdentifier")"
LOGS_ENDPOINT_ID="$(read_context_value "environments.${ENV_NAME}.existingLogsVpcEndpointId" || true)"
SECRETS_ENDPOINT_ID="$(read_context_value "environments.${ENV_NAME}.existingSecretsManagerVpcEndpointId" || true)"
KMS_ENDPOINT_ID="$(read_context_value "environments.${ENV_NAME}.existingKmsVpcEndpointId" || true)"
DB_KMS_KEY_ARN="$(read_context_value "environments.${ENV_NAME}.dbSecretKmsKeyArn" || true)"

if [[ -z "$LOGS_ENDPOINT_ID" || "$LOGS_ENDPOINT_ID" == "resolved-at-deploy-time" ]]; then
  NETWORK_STACK_NAME="$(stack_name_for_env "$ENV_NAME")"
  LOGS_ENDPOINT_ID="$(read_endpoint_output "$NETWORK_STACK_NAME" "LogsEndpoint")"
  SECRETS_ENDPOINT_ID="$(read_endpoint_output "$NETWORK_STACK_NAME" "SecretsManagerEndpoint")"
  KMS_ENDPOINT_ID="$(read_endpoint_output "$NETWORK_STACK_NAME" "KmsEndpoint")"
fi

if [[ -z "$DB_KMS_KEY_ARN" || "$DB_KMS_KEY_ARN" == "null" ]]; then
  DB_KMS_KEY_ARN="$(
    aws secretsmanager describe-secret \
      --region "$REGION" \
      --secret-id "$DB_SECRET_ARN" \
      --query 'KmsKeyId' \
      --output text
  )"
fi

if [[ -z "$LOGS_ENDPOINT_ID" || -z "$SECRETS_ENDPOINT_ID" || -z "$KMS_ENDPOINT_ID" ]]; then
  echo "Failed to resolve endpoint IDs for environment: $ENV_NAME" >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

APP_SECRET_NAME="$(secret_name_from_id "$DB_SECRET_ARN")"
MIGRATOR_SECRET_NAME="${APP_SECRET_NAME/app-db-credentials/migrator-db-credentials}"
ADMIN_SECRET_NAME="${APP_SECRET_NAME/app-db-credentials/db-admin}"
RDS_MASTER_SECRET_ARN="$(
  aws rds describe-db-instances \
    --region "$REGION" \
    --db-instance-identifier "$DB_INSTANCE_IDENTIFIER" \
    --query 'DBInstances[0].MasterUserSecret.SecretArn' \
    --output text 2>/dev/null || true
)"
STACK_DB_SECRET_PREFIX="NetworkStack${ENV_NAME}StagingDbSe"

resolved_secret_patterns=()
resolved_kms_resources=()

add_secret_policy_resources() {
  local secret_id="$1"
  [[ -z "$secret_id" || "$secret_id" == "None" || "$secret_id" == "null" ]] && return 0

  local secret_json
  if ! secret_json="$(describe_secret_json "$secret_id" 2>/dev/null)"; then
    return 0
  fi

  resolved_secret_patterns+=("$(secret_pattern_from_json "$secret_json")")

  local kms_key_id
  kms_key_id="$(node -e 'const secret = JSON.parse(process.argv[1]); process.stdout.write(String(secret.KmsKeyId ?? ""));' "$secret_json")"
  if [[ -z "$kms_key_id" || "$kms_key_id" == "None" || "$kms_key_id" == "null" ]]; then
    resolved_kms_resources=("*")
    return 0
  fi

  if [[ " ${resolved_kms_resources[*]} " != *" ${kms_key_id} "* ]]; then
    resolved_kms_resources+=("$kms_key_id")
  fi
}

add_secret_policy_resources "$DB_SECRET_ARN"
add_secret_policy_resources "$MIGRATOR_SECRET_NAME"
add_secret_policy_resources "$ADMIN_SECRET_NAME"
add_secret_policy_resources "$RDS_MASTER_SECRET_ARN"

if [[ -z "$RDS_MASTER_SECRET_ARN" || "$RDS_MASTER_SECRET_ARN" == "None" || "$RDS_MASTER_SECRET_ARN" == "null" ]]; then
  while IFS= read -r stack_secret_arn; do
    add_secret_policy_resources "$stack_secret_arn"
  done < <(printf '%s\n' "$(list_stack_secret_arns "$STACK_DB_SECRET_PREFIX")" | tr '\t' '\n')
fi

if [[ -n "$ADDITIONAL_SECRET_ARNS" ]]; then
  IFS=',' read -r -a extra_secret_ids <<<"$ADDITIONAL_SECRET_ARNS"
  for extra_secret_id in "${extra_secret_ids[@]}"; do
    add_secret_policy_resources "$(printf '%s' "$extra_secret_id" | xargs)"
  done
fi

if [[ ${#resolved_secret_patterns[@]} -eq 0 ]]; then
  echo "Failed to resolve any Secrets Manager resources for environment: $ENV_NAME" >&2
  exit 1
fi

if [[ ${#resolved_secret_patterns[@]} -gt 1 ]]; then
  resolved_kms_resources=("*")
fi

if [[ ${#resolved_kms_resources[@]} -eq 0 ]]; then
  if [[ -n "$DB_KMS_KEY_ARN" && "$DB_KMS_KEY_ARN" != "None" && "$DB_KMS_KEY_ARN" != "null" ]]; then
    resolved_kms_resources=("$DB_KMS_KEY_ARN")
  else
    resolved_kms_resources=("*")
  fi
fi

if [[ -n "$ADDITIONAL_KMS_KEY_ARNS" && "${resolved_kms_resources[0]}" != "*" ]]; then
  IFS=',' read -r -a extra_kms_resources <<<"$ADDITIONAL_KMS_KEY_ARNS"
  for extra_kms_resource in "${extra_kms_resources[@]}"; do
    extra_kms_resource="$(printf '%s' "$extra_kms_resource" | xargs)"
    [[ -z "$extra_kms_resource" ]] && continue
    if [[ " ${resolved_kms_resources[*]} " != *" ${extra_kms_resource} "* ]]; then
      resolved_kms_resources+=("$extra_kms_resource")
    fi
  done
fi

secret_arns_json="$(printf '%s\n' "${resolved_secret_patterns[@]}" | node -e 'const fs=require("fs");const values=fs.readFileSync(0,"utf8").split(/\n/).map((s)=>s.trim()).filter(Boolean);console.log(JSON.stringify(values));')"
kms_key_arns_json="$(printf '%s\n' "${resolved_kms_resources[@]}" | node -e 'const fs=require("fs");const values=fs.readFileSync(0,"utf8").split(/\n/).map((s)=>s.trim()).filter(Boolean);console.log(values.length === 1 && values[0] === "*" ? "\"*\"" : JSON.stringify(values));')"

cat >"$TMP_DIR/logs-policy.json" <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": "*",
      "Action": [
        "logs:CreateLogStream",
        "logs:PutLogEvents",
        "logs:DescribeLogStreams"
      ],
      "Resource": "*",
      "Condition": {
        "StringEquals": {
          "aws:PrincipalAccount": "$ACCOUNT_ID"
        }
      }
    }
  ]
}
EOF

cat >"$TMP_DIR/secrets-policy.json" <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": "*",
      "Action": [
        "secretsmanager:DescribeSecret",
        "secretsmanager:GetSecretValue"
      ],
      "Resource": ${secret_arns_json},
      "Condition": {
        "StringEquals": {
          "aws:PrincipalAccount": "$ACCOUNT_ID"
        }
      }
    }
  ]
}
EOF

cat >"$TMP_DIR/kms-policy.json" <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": "*",
      "Action": [
        "kms:Decrypt",
        "kms:DescribeKey"
      ],
      "Resource": ${kms_key_arns_json},
      "Condition": {
        "StringEquals": {
          "aws:PrincipalAccount": "$ACCOUNT_ID"
        }
      }
    }
  ]
}
EOF

if [ "$MODE" = "apply" ]; then
  aws ec2 modify-vpc-endpoint \
    --region "$REGION" \
    --vpc-endpoint-id "$LOGS_ENDPOINT_ID" \
    --policy-document "file://$TMP_DIR/logs-policy.json" \
    --query 'Return' \
    --output text >/dev/null

  aws ec2 modify-vpc-endpoint \
    --region "$REGION" \
    --vpc-endpoint-id "$SECRETS_ENDPOINT_ID" \
    --policy-document "file://$TMP_DIR/secrets-policy.json" \
    --query 'Return' \
    --output text >/dev/null

  aws ec2 modify-vpc-endpoint \
    --region "$REGION" \
    --vpc-endpoint-id "$KMS_ENDPOINT_ID" \
    --policy-document "file://$TMP_DIR/kms-policy.json" \
    --query 'Return' \
    --output text >/dev/null

  echo "Applied endpoint policies in $REGION for $ENV_NAME logs/secretsmanager/kms endpoints."
  exit 0
fi

if [ "$MODE" = "check" ]; then
  compare_policy() {
    local endpoint_id="$1"
    local expected_file="$2"
    local current_file="$TMP_DIR/current-$endpoint_id.json"

    aws ec2 describe-vpc-endpoints \
      --region "$REGION" \
      --vpc-endpoint-ids "$endpoint_id" \
      --query 'VpcEndpoints[0].PolicyDocument' \
      --output text >"$current_file"

    local expected_norm current_norm
    expected_norm="$(node -e "
      const fs=require('fs');
      const normalize=(value)=>{
        if (Array.isArray(value)) {
          return value.map(normalize).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
        }
        if (value && typeof value === 'object') {
          return Object.fromEntries(
            Object.keys(value)
              .sort()
              .filter((key)=>key !== 'Sid')
              .map((key)=>[key, normalize(value[key])])
          );
        }
        return value;
      };
      const obj=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));
      console.log(JSON.stringify(normalize(obj)));
    " "$expected_file")"
    current_norm="$(node -e "
      const fs=require('fs');
      const normalize=(value)=>{
        if (Array.isArray(value)) {
          return value.map(normalize).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
        }
        if (value && typeof value === 'object') {
          return Object.fromEntries(
            Object.keys(value)
              .sort()
              .filter((key)=>key !== 'Sid')
              .map((key)=>[key, normalize(value[key])])
          );
        }
        return value;
      };
      const obj=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));
      console.log(JSON.stringify(normalize(obj)));
    " "$current_file")"

    if [ "$expected_norm" != "$current_norm" ]; then
      echo "Policy drift detected for $endpoint_id"
      return 1
    fi
    return 0
  }

  compare_policy "$LOGS_ENDPOINT_ID" "$TMP_DIR/logs-policy.json"
  compare_policy "$SECRETS_ENDPOINT_ID" "$TMP_DIR/secrets-policy.json"
  compare_policy "$KMS_ENDPOINT_ID" "$TMP_DIR/kms-policy.json"
  echo "Endpoint policies match expected documents for $ENV_NAME."
  exit 0
fi

echo "Invalid mode: $MODE (expected apply or check)" >&2
exit 1
