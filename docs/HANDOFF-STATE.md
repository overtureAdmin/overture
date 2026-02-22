# Unity Appeals MVP - Handoff State

## Canonical Execution Plan
- Use `docs/MASTER-PLAN.md` as the single ordered source of truth for remaining work and phase gates.

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
- Latest pushed commit at handoff: `07f7670`
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

### Legacy Staging Stack
- Stack: `InfraStack-staging`
- Status: decommissioned/deleted
- Notes: replaced by canonical `InfraStack-staging-v2`.

## Validation Performed (Latest Session)
- `cd infra && npm run build` passed.
- `cd infra && npm run test` passed.
- `cd web && npm run build` passed.
- `cd web && npm run test` passed.
- `cd infra && npm run check:endpoint-policies` passed.
- CI migration-smoke parity passed against disposable Postgres:
  - migration run pass 1: applied `0001_init.sql`, `0002_generated_document_export.sql`
  - migration run pass 2: both migrations skipped (idempotent)
  - schema verification: `migration smoke passed`
- `cd infra && npm run smoke:runtime` passed (`dev` + `staging`).
- `cd infra && npm run smoke:alarms` passed (`InfraStack-alb-target-5xx`, `InfraStack-staging-v2-alb-target-5xx`).

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
- `07f7670` ops: add synthetic alarm smoke script for dev and staging
- `109b42f` ops: add runtime smoke script for dev and staging
- `b042cd8` ci: add web migration smoke workflow with disposable postgres
- `18af46b` test: cover bedrock error and guardrail regression paths
- `560be63` test: add chat and document generate API handler coverage
- `a98739b` docs: add onboarding and handoff documentation set
- `ba86b5f` feat: standardize db migrator flow and schedule export processing

## Latest Session Updates (`2026-02-22`)
- Phase 2.1 API integration coverage completed for auth + tenant boundaries:
  - Added API handler tests:
    - `web/src/lib/api-handlers/document-revise.test.ts`
    - `web/src/lib/api-handlers/document-export.test.ts`
    - `web/src/lib/api-handlers/document-export-status.test.ts`
  - Extended generate coverage:
    - `web/src/lib/api-handlers/document-generate.test.ts` now verifies audit metadata consistency keys.
  - Route handlers were normalized to testable injected-handler structure:
    - `web/src/app/api/documents/[id]/revise/route.ts`
    - `web/src/app/api/documents/[id]/export/route.ts`
    - `web/src/app/api/documents/[id]/export/[exportId]/route.ts`
  - Added handler modules:
    - `web/src/lib/api-handlers/document-revise.ts`
    - `web/src/lib/api-handlers/document-export.ts`
    - `web/src/lib/api-handlers/document-export-status.ts`
- Phase 1.3 audit metadata consistency tightened for generate/revise/export:
  - Generate + revise + export audit metadata now consistently include outcome + context fields and explicit `phiProcessingEnabled`.
  - Export audit events now include thread/kind/version context and `modelId: null` for explicit non-model path.
- Phase 3.1 launch readiness docs completed:
  - Added `docs/GO-LIVE-CHECKLIST.md` with deploy/migrate/smoke/rollback checklist.
  - Updated `docs/MASTER-PLAN.md` to mark completed Phase 1.3, 2.1, and 3.1 items and set Phase 3 status to in progress.
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
  - Export pipeline implemented end-to-end:
    - Queue processor route: `POST /api/exports/process` (processes queued jobs with status transitions).
    - Export status/download route: `GET /api/documents/:id/export/:exportId` (returns status + presigned S3 URL when complete).
    - Artifact generation implemented for `.pdf` and `.docx`, with S3 persistence in per-environment documents buckets.
    - Dev smoke and staging-v2 smoke confirmed `queued -> completed` plus valid download URLs.
  - Bedrock guardrails hardened:
    - Added centralized PHI-pattern detection + non-PHI policy prompt in `web/src/lib/bedrock.ts`.
    - Chat/generate/revise now block PHI-like user input (`422`) before persistence/model invocation.
    - Model output guardrail violations now return `422` and write blocked audit events instead of persisting unsafe text.
    - Post-deploy smokes verified PHI-like chat input is blocked in both dev and staging-v2.
- Infra deployment updates:
  - `InfraStack` deployed successfully.
  - `NetworkStack-staging` (no changes) and `InfraStack-staging-v2` deployed successfully.
  - ECS task role now includes Bedrock invoke permissions and container env sets `BEDROCK_MODEL_ID`.
  - Added documents S3 buckets + ECS task read/write grants + `DOCUMENTS_BUCKET_NAME` env var in both dev and staging-v2.
 - Migration credential model standardized (Phase 0.1):
   - Added dedicated migration credential tooling:
     - `web/scripts/provision-db-roles.mjs`
     - `web/scripts/provision-db-roles-from-secrets.mjs`
     - `web/scripts/run-migrations-from-secret.mjs`
   - Added `ADMIN_DATABASE_URL` support in DB role provisioning to allow secure in-VPC one-off role setup tasks.
   - Created/used dedicated secrets for both environments:
     - dev: `unity-appeals-dev-db-admin`, `unity-appeals-dev-app-db-credentials`, `unity-appeals-dev-migrator-db-credentials`
     - staging-v2: `unity-appeals-staging-v2-db-admin`, `unity-appeals-staging-v2-app-db-credentials`, `unity-appeals-staging-v2-migrator-db-credentials`
   - Validated migrator-based migrations using one-off ECS tasks in both dev and staging-v2 (`exitCode = 0`).
 - Export reliability and automation:
   - Added internal processor route for scheduler use:
     - `POST /api/internal/exports/process`
     - token-protected via `x-export-processor-token` and `EXPORT_PROCESSOR_SHARED_SECRET`.
   - Added periodic trigger path:
     - EventBridge `rate(1 minute)` rule invokes stack-managed Lambda to call internal processor route.
   - Internal processor route checks:
     - unauthorized calls return `401` (dev + staging-v2)
     - authorized token calls return `200` (dev + staging-v2)
 - Automated tests added (Phase 2 slice):
   - `web/src/lib/export-processing.test.ts`
   - `web/src/lib/export-status.test.ts`
   - `npm run test` now runs `node --test "src/**/*.test.ts"` in `web`.
 - Runtime smoke automation (Phase 2.2 slice):
   - Added script `infra/scripts/runtime-smoke.sh` and npm wrapper `npm run smoke:runtime`.
   - Script validates in dev/staging:
     - auth (`GET /api/threads`)
     - thread create
     - document generate
     - export queue + status completion
     - internal export processor unauthorized (`401`) and authorized (`200`) checks.
   - Latest run passed in both environments.
 - Alarm smoke automation (Phase 2.2 slice):
   - Added script `infra/scripts/alarm-smoke.sh` and npm wrapper `npm run smoke:alarms`.
   - Script performs synthetic `ALARM -> OK` transitions for:
     - `InfraStack-alb-target-5xx`
     - `InfraStack-staging-v2-alb-target-5xx`
   - Latest run passed in both environments.
 - Alarm-noise hardening:
   - Updated ECS running-task alarm missing-data behavior from `BREACHING` to `NOT_BREACHING` in both stacks.
   - Verified both alarms are currently `OK`:
     - `InfraStack-ecs-running-tasks-low`
     - `InfraStack-staging-v2-ecs-running-tasks-low`

## Known Gaps / Next Priority Work
1. Execute and document staging-v2 end-to-end workflow signoff (`thread -> chat -> generate -> revise -> export -> download/status`).
2. Keep PHI gate status explicitly disabled until compliance approval is documented.
3. Optional cleanup (deferred post-launch): stale SNS pending placeholders for `dev.user@unityappeals.local`.
4. Optional cleanup (deferred post-launch): old log groups from superseded stacks with `retentionInDays = None`.
5. Obtain product-owner MVP acceptance signoff.

## Suggested “First Command” In Next Session
```bash
cd /Users/benjaminfrank/Documents/unity-appeals-mvp
git pull
```

Then continue with: Phase 3.2 staging signoff + final acceptance activities in `docs/MASTER-PLAN.md`.

## Next Chat Prompt
```text
Working repo: /Users/benjaminfrank/Documents/unity-appeals-mvp
Branch: main

Read docs/HANDOFF-STATE.md and docs/MASTER-PLAN.md and continue execution from there.

Current canonical runtime:
- Dev stack: InfraStack
- Staging stack: InfraStack-staging-v2
- Staging network stack: NetworkStack-staging
- Legacy InfraStack-staging is decommissioned/deleted.

Current state highlights:
- AWS hardening and alarm delivery proof completed.
- Bedrock-only generation path implemented.
- Export pipeline is implemented end-to-end (queue process + S3 artifact + status/download route).
- PHI guardrails are enforced on generation inputs and model outputs (422 block path).
- Standardized migrator credential model is implemented and validated in dev + staging-v2.
- Periodic export queue processing trigger is deployed.
- Runtime smoke and alarm smoke scripts are in place.
- CI migration smoke workflow is in place.

Do this next (in order):
1. Execute staging-v2 end-to-end workflow signoff and capture evidence in docs.
2. Confirm/document PHI gate remains disabled pending compliance approval.
3. Decide/record owner + date for deferred optional cleanup items (SNS pending placeholders, superseded log groups).
4. Obtain product owner MVP acceptance signoff.

Constraints:
- Preserve tenant isolation and PHI-disabled behavior.
- Keep endpoint policy drift checks passing.
- Make code changes directly, run build/tests/deploy/smokes as needed, and commit/push when complete.
- Preserve unrelated local changes.
```
