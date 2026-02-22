# Unity Appeals MVP - Handoff State

## Product Goal
Build an MVP prior-authorization appeal application that:
- Supports LMN, Appeal Letter, and P2P Cheat Sheet generation.
- Uses a chat + document editor workflow.
- Enforces tenant isolation (`tenant_id` everywhere tenant-bound).
- Runs AWS-native (ECS Fargate + ALB + RDS + S3 + Cognito + Bedrock).
- Uses Bedrock-only LLM path.
- Keeps PHI processing disabled until compliance gates are explicitly passed.

## Current Repo + Branch
- Repo: `unity-appeals-mvp`
- Branch: `main`
- Latest pushed commit at handoff: `867cea6`
- Handoff date: `2026-02-22` (UTC)

## What Is Implemented

### Infra (CDK)
- Environment-specific config model is in place (no hardcoded fallback IDs/ARNs in stack logic).
- Dev stack (`InfraStack`) is deployed and healthy.
- New dedicated staging network/app path is deployed:
  - `NetworkStack-staging` (dedicated VPC + subnets + NAT + endpoints + staging RDS)
  - `InfraStack-staging-v2` (staging app stack consuming network stack outputs)
- Cognito user pools/clients managed in CDK for both dev and staging-v2.
- ECS execution role hardening:
  - `kms:Decrypt` constrained by `kms:ViaService` and `kms:EncryptionContext:SecretARN`.
- Alarming and notification wiring:
  - ALB target 5xx
  - ECS running task count low
  - RDS CPU high
  - RDS free storage low
  - RDS connections high
  - SNS topic + email subscription + Alarm/OK actions
- ECS deployment safety:
  - circuit breaker rollback enabled
  - explicit `minHealthyPercent=100`, `maxHealthyPercent=200`
- Log retention config applied:
  - dev: 30 days
  - staging-v2: 90 days
- Endpoint policy hardening tooling:
  - `infra/scripts/apply-vpc-endpoint-policies.sh` supports `apply` and `check`
  - npm scripts: `apply:endpoint-policies`, `check:endpoint-policies`

### Data / DB Security
- Dev master secret rotated successfully.
- Dev app now uses least-privilege DB credentials secret at runtime.
- RDS baseline controls set:
  - dev: retention 7 days, backup window `03:00-04:00`, maintenance `sun:04:00-sun:05:00`, PI enabled
  - staging-v2: retention 14 days, backup window `04:00-05:00`, maintenance `sun:05:00-sun:06:00`, PI enabled

### Web App / APIs
- Required frontend routes scaffolded:
  - `/login`, `/app`, `/document/[id]`
- Required API endpoints scaffolded.
- Real DB-backed implementations (tenant-scoped):
  - `GET /api/threads`
  - `POST /api/threads`
  - `POST /api/chat/:threadId/message`
- Auth parser upgraded to Cognito JWT verification (JWKS, issuer, client checks).
- Route protection in `web/src/proxy.ts` for `/app` and `/document/*`.
- DB migration runner is in place and used for env bring-up.

## Deployed Runtime State

### Dev (active)
- Stack: `InfraStack`
- ALB URL: `http://InfraS-Unity-C35fhtjknemR-1912925693.us-east-1.elb.amazonaws.com`
- Cognito:
  - `ConfiguredCognitoUserPoolId = us-east-1_zl8zG5Dpl`
  - `ConfiguredCognitoAppClientId = 7a3qa4prrq1h9v71snfhqo36f4`

### Staging-v2 (active, isolated)
- Network stack: `NetworkStack-staging`
- App stack: `InfraStack-staging-v2`
- ALB URL: `http://InfraS-Unity-iGMyoO90DG4I-1920092028.us-east-1.elb.amazonaws.com`
- Cognito:
  - `ConfiguredCognitoUserPoolId = us-east-1_lJ4XChD2H`
  - `ConfiguredCognitoAppClientId = 5395vq9loa484ipjcgtr3o5lh2`

### Legacy Staging Stack (not canonical)
- Stack: `InfraStack-staging`
- Status: `UPDATE_ROLLBACK_COMPLETE`
- Reason: failed in-place LB/VPC migration attempt during cutover; replaced by blue/green `InfraStack-staging-v2`.

## Validation Performed (Latest Session)
- `infra` build + tests passed.
- Deployed `InfraStack` successfully.
- Deployed `NetworkStack-staging` + `InfraStack-staging-v2` successfully.
- Ran staging-v2 DB migrations via one-off ECS task (exit code `0`).
- Seeded staging-v2 Cognito test user successfully.
- Authenticated ALB API smoke tests passed:
  - dev `GET /api/threads` => `200 OK`
  - staging-v2 `GET /api/threads` => `200 OK`
- ECS services verified steady state with rollout `COMPLETED` in both envs.
- Endpoint policy `apply` and `check` both pass.
- Synthetic alarm state transitions (`ALARM` then `OK`) executed successfully for dev and staging-v2 alarm names.

## Important Files
- Infra:
  - `infra/lib/infra-stack.ts`
  - `infra/lib/network-stack.ts`
  - `infra/bin/infra.ts`
  - `infra/cdk.json`
  - `infra/scripts/apply-vpc-endpoint-policies.sh`
  - `infra/scripts/seed-dev-cognito-user.sh`
- Runbook:
  - `docs/INFRA-OPERATIONS.md`
- Web:
  - `web/src/lib/auth.ts`
  - `web/src/lib/db.ts`
  - `web/src/proxy.ts`
  - `web/src/app/api/threads/route.ts`
  - `web/src/app/api/chat/[threadId]/message/route.ts`
  - `web/scripts/run-migrations.mjs`

## Key Commits (Recent)
- `867cea6` feat: implement aws hardening with staging-v2 isolated network stack
- `ac52cc4` feat: add infra alarms and tighten VPC endpoint policies
- `8a13e61` chore: restrict ECS KMS decrypt to Secrets Manager context
- `8b388ac` feat: add staging stack deployment configuration
- `f979a57` feat: move ECS runtime to least-privilege app DB credentials
- `16aaa50` chore: add staging infra context and concrete dev endpoint config
- `3c92773` refactor: load infra defaults from per-environment context

## Latest Session Updates (`2026-02-22`)
- Legacy non-canonical stack decommissioned:
  - `InfraStack-staging` deleted.
  - Post-delete status check now returns `ValidationError: Stack with id InfraStack-staging does not exist`.
- SNS alarm verification:
  - Synthetic alarm transitions executed for dev + staging-v2 (`ALARM` then `OK`) at ~`2026-02-22T16:49Z`.
  - CloudWatch alarm history shows successful action execution to SNS topics in both environments.
  - Alarm recipient config updated to `ben@unityhealthtech.com` and deployed to dev + staging-v2.
  - Inbox delivery proof now confirmed by operator for both dev and staging-v2 alarms.
  - `dev.user@unityappeals.local` stale entries remain in `PendingConfirmation`; AWS does not allow manual unsubscribe without a real subscription ARN, so these must age out automatically.
- Endpoint policy drift checks:
  - `cd infra && npm run check:endpoint-policies` passed after infra updates.
- App delivery progress:
  - `POST /api/chat/:threadId/message` now uses Bedrock (`Converse`) instead of stub text and persists assistant response + audit metadata.
  - Document pipeline endpoints now enforce auth + tenant scoping and persist DB records + audit events:
    - `POST /api/documents/:id/generate`
    - `POST /api/documents/:id/revise`
    - `POST /api/documents/:id/export`
  - Added migration `web/db/migrations/0002_generated_document_export.sql` for export-job persistence.
- Infra deployment updates:
  - `InfraStack` deployed successfully.
  - `NetworkStack-staging` (no changes) and `InfraStack-staging-v2` deployed successfully.
  - ECS task role now includes Bedrock invoke permissions and container env sets `BEDROCK_MODEL_ID`.

## Known Gaps / Next Priority Work
1. Optional cleanup: old pending SNS placeholder subscriptions for `dev.user@unityappeals.local` after AWS auto-removal window.
2. Optional cleanup: old log groups from superseded stacks with `retentionInDays = None`.

## Suggested “First Command” In Next Session
```bash
cd /Users/benjaminfrank/Documents/unity-appeals-mvp
git pull
```

Then continue with: decommission legacy `InfraStack-staging`, confirm SNS delivery evidence, and start Bedrock app path implementation.
