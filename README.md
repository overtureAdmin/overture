# Overture

Prior-authorization appeal MVP with tenant-scoped chat and document workflows (LMN, Appeal Letter, P2P), deployed on AWS (ECS Fargate + ALB + RDS + S3 + Cognito + Bedrock).

## Start Here

- Current runtime/handoff state: `docs/HANDOFF-STATE.md`
- Ordered roadmap + gates: `docs/MASTER-PLAN.md`
- Infra/app runbook: `docs/INFRA-OPERATIONS.md`
- Architecture + boundaries: `docs/ARCHITECTURE.md`
- Contribution workflow/checks: `docs/CONTRIBUTING.md`
- Agent/operator constraints: `AGENTS.md`
- Decision history (ADR-lite): `docs/DECISIONS.md`

## Canonical Runtime

- Dev app stack: `InfraStack`
- Staging app stack: `InfraStack-staging-v2`
- Staging network stack: `NetworkStack-staging`
- Legacy `InfraStack-staging`: decommissioned

## Core Constraints

- Tenant isolation is required (`tenant_id` on all tenant-bound reads/writes).
- PHI processing remains disabled unless explicit compliance gate approval is documented.
- Endpoint policy drift checks must pass.
- Bedrock is the only model path.

## Local Development

Web app:

```bash
cd web
npm install
npm run dev
```

Infra:

```bash
cd infra
npm install
npm run build
npm run test
```

## Deploy + Validate (High Level)

Deploy:

```bash
cd infra
npx cdk deploy InfraStack --require-approval never
npx cdk deploy InfraStack-staging-v2 -c environment=staging --exclusively --require-approval never
```

Validate:

```bash
cd infra
npm run check:endpoint-policies
```

Then run auth/API smokes from `docs/INFRA-OPERATIONS.md`.

## Documentation Maintenance Rule

If a PR changes behavior, deploy flow, secrets, alarms, migrations, or constraints:

1. Update `docs/INFRA-OPERATIONS.md` (if runbook impact).
2. Update `docs/MASTER-PLAN.md` phase status/checklists (if roadmap impact).
3. Update `docs/HANDOFF-STATE.md` latest session + known gaps.
4. Add/update an entry in `docs/DECISIONS.md` for meaningful architecture/security/process changes.
