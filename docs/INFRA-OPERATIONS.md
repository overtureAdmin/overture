# Infra Operations Runbook

## Canonical Stacks

- Dev app stack: `InfraStack`
- Staging app stack: `InfraStack-staging-v2`
- Staging network stack: `NetworkStack-staging`
- Legacy `InfraStack-staging`: deleted/decommissioned

## Deploy

```bash
cd infra
npx cdk deploy InfraStack --require-approval never
npx cdk deploy NetworkStack-staging InfraStack-staging-v2 -c environment=staging --require-approval never
```

## Database Migration Credentials (Standardized)

Use three Secrets Manager entries per environment:

- `<env>-db-admin` (admin/master user; only for role provisioning)
- `<env>-app-db-credentials` (runtime ECS app user)
- `<env>-migrator-db-credentials` (DDL migration user)

Required secret JSON fields:

```json
{
  "host": "db-hostname",
  "port": 5432,
  "dbname": "unity_appeals",
  "username": "role_name",
  "password": "role_password"
}
```

### One-time / Rotation: Provision app + migrator roles

This is the only step that uses admin credentials, and it is standardized via script (no ad hoc SQL).

```bash
cd web
node scripts/provision-db-roles-from-secrets.mjs \
  --region us-east-1 \
  --admin-secret-id <admin-secret-id-or-arn> \
  --app-secret-id <app-secret-id-or-arn> \
  --migrator-secret-id <migrator-secret-id-or-arn>
```

### Run migrations (always with migrator secret)

```bash
cd web
node scripts/run-migrations-from-secret.mjs \
  --region us-east-1 \
  --secret-id <migrator-secret-id-or-arn>
```

Equivalent npm wrapper:

```bash
cd web
npm run migrate:secret -- --region us-east-1 --secret-id <migrator-secret-id-or-arn>
```

### Validate least privilege

- ECS runtime uses the app secret only.
- Migrations run with migrator secret only.
- App role remains DML-only (no DDL at runtime).

## Rollback

1. Cancel stack update:

```bash
aws cloudformation cancel-update-stack --stack-name <STACK_NAME> --region us-east-1
```

2. Wait for rollback completion:

```bash
aws cloudformation wait stack-rollback-complete --stack-name <STACK_NAME> --region us-east-1
```

3. ECS rollback safety:
- ECS deployment circuit breaker with rollback is enabled.
- If deployment fails, ECS automatically rolls back to the last stable task set.

## Endpoint Policy Drift

Apply expected policies:

```bash
cd infra
DEPLOY_ENV=dev npm run apply:endpoint-policies
```

Check drift (non-zero exit on mismatch):

```bash
cd infra
DEPLOY_ENV=dev npm run check:endpoint-policies
```

Prod example:

```bash
cd infra
AWS_PROFILE=overture-prod DEPLOY_ENV=prod npm run check:endpoint-policies
```

## Auth Smoke Tests

### Dev

```bash
TOKEN=$(aws cognito-idp initiate-auth \
  --region us-east-1 \
  --auth-flow USER_PASSWORD_AUTH \
  --client-id 7a3qa4prrq1h9v71snfhqo36f4 \
  --auth-parameters USERNAME=dev.user@unityappeals.local,PASSWORD='DevPass1!DevPass1!' \
  --query 'AuthenticationResult.IdToken' --output text)

curl -i -X GET \
  'http://InfraS-Unity-C35fhtjknemR-1912925693.us-east-1.elb.amazonaws.com/api/threads' \
  -H "Authorization: Bearer $TOKEN"
```

### Staging

```bash
TOKEN=$(aws cognito-idp initiate-auth \
  --region us-east-1 \
  --auth-flow USER_PASSWORD_AUTH \
  --client-id 5395vq9loa484ipjcgtr3o5lh2 \
  --auth-parameters USERNAME=dev.user@unityappeals.local,PASSWORD='DevPass1!DevPass1!' \
  --query 'AuthenticationResult.IdToken' --output text)

curl -i -X GET \
  'http://InfraS-Unity-iGMyoO90DG4I-1920092028.us-east-1.elb.amazonaws.com/api/threads' \
  -H "Authorization: Bearer $TOKEN"
```

## Runtime Smoke Script

Run full API smoke coverage for auth, thread creation, document generate, export queue/process/status in dev + staging:

```bash
cd infra
./scripts/runtime-smoke.sh both
```

Single environment:

```bash
cd infra
./scripts/runtime-smoke.sh dev
./scripts/runtime-smoke.sh staging
```

Equivalent npm script:

```bash
cd infra
npm run smoke:runtime
```

## Alarm Test Procedure

Run synthetic alarm `ALARM -> OK` checks for both environments:

```bash
cd infra
./scripts/alarm-smoke.sh both
```

Single environment:

```bash
cd infra
./scripts/alarm-smoke.sh dev
./scripts/alarm-smoke.sh staging
```

Equivalent npm script:

```bash
cd infra
npm run smoke:alarms
```

## Export Queue Scheduler

- Internal processor route: `POST /api/internal/exports/process`
- Auth: `x-export-processor-token` header with `EXPORT_PROCESSOR_SHARED_SECRET`.
- Trigger: EventBridge rule (`rate(1 minute)`) invokes stack-managed Lambda that calls the internal route with limit `10`.

Manual invocation check:

```bash
aws events list-rule-names-by-target \
  --region us-east-1 \
  --target-arn <EXPORT_QUEUE_SCHEDULER_LAMBDA_ARN>
```

## Prod HTTPS Management (CDK-managed)

- `InfraStack` now supports `tlsCertificateArn` in environment config.
- When set, CDK creates and manages ALB HTTPS listener (port `443`) and forwards to the app target group.
- Keep ACM cert in `us-east-1` for ALB in this deployment.

Current prod reference:

- Cert ARN:
  - `arn:aws:acm:us-east-1:329599631467:certificate/7d4169bc-f43c-4bc3-a90d-632ab44702e8`
- Domain:
  - `https://app.oncologyexecutive.com/login`
- Cognito Hosted UI:
  - domain: `overture-prod-auth`
  - current branding mode: classic Hosted UI (`ManagedLoginVersion=1`)
  - checked-in CSS asset: `infra/assets/cognito-hosted-ui-overture.css`
  - checked-in logo asset: `web/public/overture-logo.png`

Verification commands:

```bash
aws elbv2 describe-listeners \
  --profile overture-prod \
  --region us-east-1 \
  --load-balancer-arn <PROD_ALB_ARN> \
  --query 'Listeners[].[Port,Protocol]' --output table

curl -sSI https://app.oncologyexecutive.com/login
aws cognito-idp describe-user-pool-domain \
  --profile overture-prod \
  --region us-east-1 \
  --domain overture-prod-auth
aws cognito-idp get-ui-customization \
  --profile overture-prod \
  --region us-east-1 \
  --user-pool-id us-east-1_e1n33IfQN \
  --client-id 7ungj1j1mafdg0isktfqv2v2ol
```
