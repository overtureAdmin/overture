# Contributing

## Branching and Commits

- Default branch: `main`.
- Keep commits scoped and descriptive.
- Do not include unrelated local changes in your commit.

## Required Checks Before Merge

Infra:

```bash
cd infra
npm run build
npm run test
npm run check:endpoint-policies
```

Web:

```bash
cd web
npm run test
```

For behavior/infra changes, also run relevant deploy/smoke validations from `docs/INFRA-OPERATIONS.md`.

## Documentation Update Requirements

When your PR changes behavior, runbooks, or architecture:

1. Update `docs/INFRA-OPERATIONS.md` for operational changes.
2. Update `docs/MASTER-PLAN.md` status/checklists for scope/progress changes.
3. Update `docs/HANDOFF-STATE.md` for current state and known gaps.
4. Add/update `docs/DECISIONS.md` entry for major architecture/security/process decisions.

## Engineering Guardrails

- Preserve tenant isolation in all data access paths.
- Keep PHI-disabled behavior intact unless explicitly approved and documented.
- Maintain Bedrock-only model path.
- Keep endpoint policy drift checks passing.
- Avoid destructive git actions unless explicitly requested.

## PR Checklist

- [ ] Code compiles/tests pass.
- [ ] Endpoint policy drift check passes (if infra/security touched).
- [ ] Auth + tenant boundaries preserved.
- [ ] Runbook/handoff/plan docs updated where needed.
- [ ] Rollback implications considered and documented.
