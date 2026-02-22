# Decisions

Short decision log (ADR-lite). Add entries for non-trivial architecture/security/process decisions.

## Template

Use this format for new entries:

```text
## YYYY-MM-DD - Title
Status: accepted | superseded
Context:
Decision:
Consequences:
```

## 2026-02-22 - Canonical Staging Runtime Is `InfraStack-staging-v2`
Status: accepted
Context:
- Legacy staging stack diverged from desired isolation and lifecycle.
Decision:
- Use `NetworkStack-staging` + `InfraStack-staging-v2` as canonical staging runtime.
- Decommission legacy `InfraStack-staging`.
Consequences:
- Cleaner staging isolation model.
- All docs and deploy flows reference staging-v2 only.

## 2026-02-22 - Standardized Migrator Credential Model
Status: accepted
Context:
- Migrations previously depended on ad hoc admin/master credential handling.
Decision:
- Standardize three secret roles per environment:
  - admin (role provisioning only)
  - app (runtime least privilege)
  - migrator (DDL migrations)
- Add scripts/runbook paths that always run migrations with migrator credentials.
Consequences:
- Reduced operational drift and clearer least-privilege boundaries.
- One-off in-VPC role provisioning may still be needed in private network contexts.

## 2026-02-22 - Scheduled Export Processing Path
Status: accepted
Context:
- Export queue required manual processing route invocation.
Decision:
- Add internal token-protected export processor route.
- Add periodic EventBridge->Lambda trigger to call that route.
Consequences:
- Queue processing is continuous without manual intervention.
- Internal route security token must remain synchronized with stack config.

## 2026-02-22 - ECS Low-Task Alarm Missing Data Handling
Status: accepted
Context:
- ECS running-task alarms produced false positives during missing datapoints.
Decision:
- Set `treatMissingData` to `NOT_BREACHING` for ECS running-task alarms.
Consequences:
- Fewer false pages during deployment/metric gaps.
- True low-task conditions still alarm when datapoints indicate breach.
