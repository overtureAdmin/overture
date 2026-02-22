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
- Latest pushed commit at handoff: `a43e539`

## What Is Implemented

### Infra (CDK)
- ECS Fargate service behind ALB deployed and healthy.
- Interface endpoint SG remediation is in place (app SG -> endpoint SG on 443).
- ALB health check set for redirect-compatible app behavior (`/`, `200-399`).
- Cognito user pool + app client now managed in CDK.
- ECS task definition now gets:
  - Cognito env vars
  - DB host/port/name env vars
  - DB username/password from Secrets Manager
  - `DEV_BYPASS_AUTH=false`
- ECS execution role has Secrets Manager read + KMS decrypt for DB secret path.

### Web App / APIs
- Required frontend routes scaffolded:
  - `/login`, `/app`, `/document/[id]`
- Required API endpoints scaffolded.
- Real DB-backed implementations (tenant-scoped) for:
  - `GET /api/threads`
  - `POST /api/threads`
  - `POST /api/chat/:threadId/message`
- Auth parser upgraded to Cognito JWT verification (JWKS, issuer, client checks).
- Route protection in `web/src/proxy.ts` for `/app` and `/document/*`.
- DB schema + migration runner implemented:
  - `web/db/migrations/0001_init.sql`
  - `web/scripts/run-migrations.mjs`

## Deployed Runtime State (dev)
- Region: `us-east-1`
- Stack: `InfraStack`
- ALB URL:
  - `http://InfraS-Unity-C35fhtjknemR-1912925693.us-east-1.elb.amazonaws.com`
- ECS task definition in service (at handoff): `InfraStackWebTaskDef75DBC5BE:6`
- CDK-managed Cognito outputs:
  - `ConfiguredCognitoRegion = us-east-1`
  - `ConfiguredCognitoUserPoolId = us-east-1_zl8zG5Dpl`
  - `ConfiguredCognitoAppClientId = 7a3qa4prrq1h9v71snfhqo36f4`

## Validation Already Performed
- ECS service reached steady state after latest rollouts.
- Authenticated ALB API smoke test succeeded against CDK-managed Cognito client:
  - `POST /api/threads` success
  - `GET /api/threads` success
- RDS migrations executed successfully from ECS one-off task:
  - `apply 0001_init.sql`
  - `migrations complete`

## Important Files
- Infra:
  - `infra/lib/infra-stack.ts`
  - `infra/bin/infra.ts`
  - `infra/scripts/seed-dev-cognito-user.sh`
  - `infra/README.md`
- Web:
  - `web/src/lib/auth.ts`
  - `web/src/lib/db.ts`
  - `web/src/lib/tenant-context.ts`
  - `web/src/proxy.ts`
  - `web/src/app/api/threads/route.ts`
  - `web/src/app/api/chat/[threadId]/message/route.ts`
  - `web/db/migrations/0001_init.sql`
  - `web/scripts/run-migrations.mjs`
  - `web/Dockerfile`

## Key Commits (recent)
- `a43e539` feat: manage Cognito pool/client in CDK and add dev user seed script
- `eb5c215` chore: codify Cognito and DB task config in CDK
- `afa3b9f` fix: return unauthorized when Cognito env is missing
- `dbc79b9` feat: add Cognito JWT verification and run migrations via ECS
- `2c9d594` feat: add tenant-scoped postgres APIs and auth proxy
- `45fd86e` feat: add ECS endpoint remediation and MVP route/API scaffolding

## Known Gaps / Next Priority Work
1. Replace hardcoded fallback IDs/arns/defaults in `infra/lib/infra-stack.ts` with environment-specific config (SSM params or per-env context) and remove sensitive defaults.
2. Rotate RDS secret/password used during setup and verify ECS still starts with updated secret.
3. Create least-privilege app DB user and update ECS secret source accordingly.
4. Add staging environment stack config and deploy isolated staging resources.
5. Implement Bedrock-backed response path in `POST /api/chat/:threadId/message`.
6. Complete remaining document pipeline endpoints (`generate/revise/export`) with DB persistence + audit events.

## Suggested “First Command” In Next Session
```bash
cd /Users/benjaminfrank/Documents/unity-appeals-mvp
git pull
```

Then continue with priority item #1 above.
