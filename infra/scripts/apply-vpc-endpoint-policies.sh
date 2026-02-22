#!/usr/bin/env bash
set -euo pipefail

REGION="${1:-us-east-1}"
ACCOUNT_ID="${2:-726792844549}"

LOGS_ENDPOINT_ID="vpce-0ce79d655ff2c3126"
SECRETS_ENDPOINT_ID="vpce-0a7aa949562b1cfc5"
KMS_ENDPOINT_ID="vpce-0f59a30ceae685706"

DEV_APP_DB_SECRET_ARN="arn:aws:secretsmanager:us-east-1:726792844549:secret:unity-appeals-dev-app-db-credentials-SU2IxA"
STAGING_DB_SECRET_ARN="arn:aws:secretsmanager:us-east-1:726792844549:secret:rds!db-b3aaae03-d99a-4c41-869f-99bb41e5bf04-QUUH0i"

DEV_DB_KMS_KEY_ARN="arn:aws:kms:us-east-1:726792844549:key/9dd888a6-a6d4-4f60-9215-90b98123f48c"
STAGING_DB_KMS_KEY_ARN="arn:aws:kms:us-east-1:726792844549:key/b890b9d5-474d-4391-8675-a03226dc1d45"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

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
      "Resource": [
        "$DEV_APP_DB_SECRET_ARN",
        "$STAGING_DB_SECRET_ARN"
      ],
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
      "Resource": [
        "$DEV_DB_KMS_KEY_ARN",
        "$STAGING_DB_KMS_KEY_ARN"
      ],
      "Condition": {
        "StringEquals": {
          "aws:PrincipalAccount": "$ACCOUNT_ID"
        }
      }
    }
  ]
}
EOF

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
