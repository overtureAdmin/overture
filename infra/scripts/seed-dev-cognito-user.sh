#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <user-pool-id> [username] [password] [tenant-id] [region]"
  exit 1
fi

USER_POOL_ID="$1"
USERNAME="${2:-dev.user@unityappeals.local}"
PASSWORD="${3:-DevPass1!DevPass1!}"
TENANT_ID="${4:-00000000-0000-0000-0000-000000000001}"
REGION="${5:-us-east-1}"

echo "Seeding Cognito user in pool: $USER_POOL_ID (region: $REGION)"

set +e
aws cognito-idp admin-create-user \
  --region "$REGION" \
  --user-pool-id "$USER_POOL_ID" \
  --username "$USERNAME" \
  --temporary-password "$PASSWORD" \
  --message-action SUPPRESS \
  --user-attributes \
    Name=email,Value="$USERNAME" \
    Name=email_verified,Value=true \
    Name=custom:tenant_id,Value="$TENANT_ID" >/tmp/cognito-seed-create.out 2>/tmp/cognito-seed-create.err
CREATE_EXIT=$?
set -e

if [[ $CREATE_EXIT -ne 0 ]]; then
  if grep -q "UsernameExistsException" /tmp/cognito-seed-create.err; then
    echo "User already exists; updating attributes."
  else
    cat /tmp/cognito-seed-create.err
    exit $CREATE_EXIT
  fi
fi

aws cognito-idp admin-update-user-attributes \
  --region "$REGION" \
  --user-pool-id "$USER_POOL_ID" \
  --username "$USERNAME" \
  --user-attributes \
    Name=email,Value="$USERNAME" \
    Name=email_verified,Value=true \
    Name=custom:tenant_id,Value="$TENANT_ID" >/dev/null

aws cognito-idp admin-set-user-password \
  --region "$REGION" \
  --user-pool-id "$USER_POOL_ID" \
  --username "$USERNAME" \
  --password "$PASSWORD" \
  --permanent >/dev/null

echo "Seed complete."
echo "Username: $USERNAME"
echo "Password: $PASSWORD"
