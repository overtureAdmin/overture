# Overture - Go-Live Checklist

Last updated: 2026-02-22

## Scope Guardrails (must remain true)

- [ ] Tenant isolation is enforced in all tenant-bound reads/writes.
- [ ] PHI processing remains disabled (no compliance gate approval documented).
- [ ] Bedrock is the only generation path.
- [ ] VPC endpoint policy drift check passes before deploy.

## Pre-Deploy

- [ ] Confirm canonical stacks only:
  - dev app: `InfraStack`
  - staging app: `InfraStack-staging-v2`
  - staging network: `NetworkStack-staging`
- [ ] Review `docs/HANDOFF-STATE.md` for current runtime truth and unresolved gaps.
- [ ] Confirm AWS credentials/region (`us-east-1`) are correct for deploy actor.

## Deploy

- [ ] Build + test infra:
  - `cd infra && npm run build && npm run test`
- [ ] Deploy dev:
  - `cd infra && npx cdk deploy InfraStack --require-approval never`
- [ ] Deploy staging network/app:
  - `cd infra && npx cdk deploy NetworkStack-staging InfraStack-staging-v2 -c environment=staging --require-approval never`

## Migrate

- [ ] Run migrations with migrator credential only (never app credential):
  - `cd web && npm run migrate:secret -- --region us-east-1 --secret-id <migrator-secret-id-or-arn>`
- [ ] Verify migrations are idempotent (run migration command twice without failure).

## Post-Deploy Validation

- [ ] Endpoint policy drift check:
  - `cd infra && npm run check:endpoint-policies`
- [ ] Web tests:
  - `cd web && npm run test`
- [ ] Runtime smoke (dev + staging):
  - `cd infra && npm run smoke:runtime`
- [ ] Alarm smoke (dev + staging):
  - `cd infra && npm run smoke:alarms`
- [ ] CI migration-smoke parity (local/disposable DB):
  - run migration twice against disposable Postgres
  - verify `schema_migrations` exactly matches files in `web/db/migrations`

## Rollback

- [ ] Cancel failed stack update if needed:
  - `aws cloudformation cancel-update-stack --stack-name <STACK_NAME> --region us-east-1`
- [ ] Wait for rollback completion:
  - `aws cloudformation wait stack-rollback-complete --stack-name <STACK_NAME> --region us-east-1`
- [ ] Confirm ECS circuit-breaker rollback stabilized service.
- [ ] Re-run runtime smoke after rollback.

## Signoff

- [x] Staging-v2 workflow signoff completed (thread -> chat -> generate -> revise -> export -> download/status).
- [x] Product owner MVP acceptance recorded (`2026-02-22T21:26:40Z`, approver: Benjamin Frank, CEO).
