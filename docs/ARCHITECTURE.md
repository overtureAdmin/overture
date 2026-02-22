# Architecture

## System Overview

Unity Appeals MVP provides tenant-scoped chat and generated-document workflows:

1. Authenticated user (Cognito JWT) calls API routes.
2. API resolves tenant/user identity and enforces tenant-bound DB access.
3. Chat/generation/revision use Bedrock with guardrails.
4. Export requests queue DB jobs; processor creates artifacts and stores in S3.
5. Export status route returns state + presigned download URL when complete.

## Runtime Topology

- Compute: ECS Fargate service behind ALB.
- Data: RDS PostgreSQL.
- Object storage: S3 documents bucket.
- Identity: Cognito User Pool + App Client.
- LLM: AWS Bedrock only.
- Scheduling: EventBridge rule -> Lambda -> internal export processor route.

Canonical stacks:

- Dev: `InfraStack`
- Staging app: `InfraStack-staging-v2`
- Staging network: `NetworkStack-staging`

## Trust and Security Boundaries

- Internet -> ALB -> ECS service.
- ECS private networking via VPC endpoints (logs, secretsmanager, kms, etc.).
- Secrets in AWS Secrets Manager.
- RDS private access only from app security group.
- App auth via verified Cognito JWT (issuer/client checks).

## Multi-Tenancy Model

- `tenant_id` is required in tenant-bound tables and access paths.
- API routes must scope reads/writes by tenant.
- Audit events must include tenant and actor context.
- Cross-tenant reads/writes are prohibited.

## PHI and Compliance Posture

- PHI handling is currently disabled by policy.
- Guardrails block PHI-like input before model invocation.
- Guardrails block unsafe model output before persistence.
- Violations return `422` and are auditable.

## Export Pipeline

- Queue table: `generated_document_export`.
- Queue route: `POST /api/documents/:id/export`.
- Processor routes:
  - User-scoped: `POST /api/exports/process`
  - Internal scheduler path: `POST /api/internal/exports/process`
- Status/download route: `GET /api/documents/:id/export/:exportId`

## Operational Invariants

- App runtime uses app DB credentials secret only.
- Migrations run with migrator credentials.
- Endpoint policy drift checks must remain passing.
- Alarming enabled for ALB 5xx, ECS task count, and key RDS signals.

## Source of Truth

- Current state: `docs/HANDOFF-STATE.md`
- Ordered execution plan: `docs/MASTER-PLAN.md`
- Runbook: `docs/INFRA-OPERATIONS.md`
