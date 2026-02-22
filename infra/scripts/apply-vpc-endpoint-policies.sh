#!/usr/bin/env bash
set -euo pipefail

REGION="${1:-us-east-1}"
ACCOUNT_ID="${2:-726792844549}"
MODE="${3:-apply}"

LOGS_ENDPOINT_ID="vpce-0ce79d655ff2c3126"
SECRETS_ENDPOINT_ID="vpce-0a7aa949562b1cfc5"
KMS_ENDPOINT_ID="vpce-0f59a30ceae685706"

DEV_APP_DB_SECRET_ARN="arn:aws:secretsmanager:us-east-1:726792844549:secret:unity-appeals-dev-app-db-credentials-SU2IxA"
ADDITIONAL_SECRET_ARNS="${ADDITIONAL_SECRET_ARNS:-}"

DEV_DB_KMS_KEY_ARN="arn:aws:kms:us-east-1:726792844549:key/9dd888a6-a6d4-4f60-9215-90b98123f48c"
ADDITIONAL_KMS_KEY_ARNS="${ADDITIONAL_KMS_KEY_ARNS:-}"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

secret_arns_json="$(node -e 'const base=process.argv[1];const extra=(process.argv[2]||"").split(",").map(s=>s.trim()).filter(Boolean);console.log(JSON.stringify([base,...extra]));' "$DEV_APP_DB_SECRET_ARN" "$ADDITIONAL_SECRET_ARNS")"
kms_key_arns_json="$(node -e 'const base=process.argv[1];const extra=(process.argv[2]||"").split(",").map(s=>s.trim()).filter(Boolean);console.log(JSON.stringify([base,...extra]));' "$DEV_DB_KMS_KEY_ARN" "$ADDITIONAL_KMS_KEY_ARNS")"

cat >"$TMP_DIR/logs-policy.json" <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowAccountCloudWatchLogsInRegion",
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
      "Sid": "AllowAccountAccessOnlyToAppDbSecrets",
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
      "Sid": "AllowAccountDecryptForDbSecretKeys",
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

  echo "Applied endpoint policies in $REGION for logs/secretsmanager/kms endpoints."
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
    expected_norm="$(node -e "const fs=require('fs');const obj=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));console.log(JSON.stringify(obj));" "$expected_file")"
    current_norm="$(node -e "const fs=require('fs');const obj=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));console.log(JSON.stringify(obj));" "$current_file")"

    if [ "$expected_norm" != "$current_norm" ]; then
      echo "Policy drift detected for $endpoint_id"
      return 1
    fi
    return 0
  }

  compare_policy "$LOGS_ENDPOINT_ID" "$TMP_DIR/logs-policy.json"
  compare_policy "$SECRETS_ENDPOINT_ID" "$TMP_DIR/secrets-policy.json"
  compare_policy "$KMS_ENDPOINT_ID" "$TMP_DIR/kms-policy.json"
  echo "Endpoint policies match expected documents."
  exit 0
fi

echo "Invalid mode: $MODE (expected apply or check)" >&2
exit 1
