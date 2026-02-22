# Infra Operations Runbook

## Deploy

```bash
cd infra
npx cdk deploy InfraStack --require-approval never
npx cdk deploy NetworkStack-staging InfraStack-staging-v2 -c environment=staging --require-approval never
```

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
npm run apply:endpoint-policies
```

Check drift (non-zero exit on mismatch):

```bash
cd infra
npm run check:endpoint-policies
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

## Alarm Test Procedure

Trigger ALARM state manually:

```bash
aws cloudwatch set-alarm-state \
  --region us-east-1 \
  --alarm-name InfraStack-alb-target-5xx \
  --state-value ALARM \
  --state-reason "Synthetic alarm test"
```

Reset to OK:

```bash
aws cloudwatch set-alarm-state \
  --region us-east-1 \
  --alarm-name InfraStack-alb-target-5xx \
  --state-value OK \
  --state-reason "Synthetic alarm test reset"
```
