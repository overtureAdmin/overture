# AGENTS.md

Guidance for human and AI contributors working in this repository.

## Canonical Environment Targets

- Dev app stack: `InfraStack`
- Staging app stack: `InfraStack-staging-v2`
- Staging network stack: `NetworkStack-staging`
- Legacy `InfraStack-staging`: do not use (decommissioned).

## Source-of-Truth Files

- Execution order and phase gates: `docs/MASTER-PLAN.md`
- Runtime/session truth: `docs/HANDOFF-STATE.md`
- Operational runbook: `docs/INFRA-OPERATIONS.md`
- Architecture boundaries: `docs/ARCHITECTURE.md`

When these conflict, prioritize:
1. `docs/HANDOFF-STATE.md` for current deployed reality
2. `docs/MASTER-PLAN.md` for sequencing and scope
3. `docs/INFRA-OPERATIONS.md` for procedures

## Non-Negotiable Constraints

- Enforce tenant isolation in all tenant-bound reads/writes.
- Preserve PHI-disabled behavior unless compliance gate is explicitly documented.
- Keep Bedrock-only generation path.
- Keep endpoint policy drift checks passing.
- Avoid committing unrelated local changes.

## Required Verification Before Merge

```bash
cd infra && npm run build && npm run test && npm run check:endpoint-policies
cd web && npm run test
```

Plus relevant deploy/smoke validations for touched behavior.

## Operational Notes

- Migrations should use migrator credentials (not ad hoc master-secret commands).
- App runtime should use app DB credentials only.
- For private-RDS workflows, in-VPC one-off ECS tasks may be required.

## Do Not

- Do not use deleted/superseded stacks.
- Do not bypass endpoint policy drift checks.
- Do not weaken tenant/auth checks to satisfy smoke tests.
- Do not use destructive git/file operations unless explicitly requested.

## Handoff Protocol

At end of meaningful work:

1. Update `docs/HANDOFF-STATE.md` with concrete outcomes, validations, and remaining gaps.
2. Update `docs/MASTER-PLAN.md` checkboxes/status.
3. Update `docs/INFRA-OPERATIONS.md` if procedure changed.
4. Add/update `docs/DECISIONS.md` for major decisions.
