# Unity Appeals MVP - Master Execution Plan

Last updated: 2026-02-22
Owner: Engineering

## Current Position
- AWS foundation before app build is effectively complete.
- Estimated AWS work remaining before app-focused execution: **10%**.
- Estimated AWS completed for pre-app foundation: **90%**.

Estimate basis:
- Completed: canonical stacks, network isolation, endpoint policy hardening, alarming, SNS inbox proof, Bedrock IAM path, deploy safety, baseline smokes.
- Remaining: migration-role cleanup, stale SNS pending placeholder aging/cleanup, optional log-group hygiene, runbook tightening.

## Rules Of Execution
- Follow phases in order. Do not jump phases unless a blocker requires it.
- Each phase has a gate. Only proceed when gate criteria are met.
- Any new scope gets added to this file under the current phase, not as ad hoc tasks elsewhere.

## Phase 0 - Control Plane Hygiene (AWS closeout)
Status: In progress

### 0.1 Migration privilege model (required)
- [x] Create/standardize a dedicated migration credential path (dev + staging) separate from app runtime user.
- [x] Update migration run procedure to always use migrator credentials.
- [x] Verify app runtime user remains least-privilege (no DDL required at runtime).

Gate to Phase 1:
- [x] Migrations run successfully in both envs without using ad hoc manual master-secret workarounds.

### 0.2 Ops cleanup (optional but recommended)
- [ ] Re-check stale `PendingConfirmation` SNS placeholders and remove if AWS exposes valid ARN; otherwise document auto-aging behavior.
- [ ] Remove superseded log groups with undefined retention where safe.
- [x] Defer optional cleanup items to post-launch hardening (documented in handoff state on 2026-02-22).

Gate to Phase 1:
- [x] Optional cleanup either completed or explicitly deferred in this file.

## Phase 1 - Core App Completion (primary build)
Status: In progress

### 1.1 Bedrock response hardening
- [x] Add stricter system prompts and output constraints for chat/doc generation.
- [x] Add explicit non-PHI output checks prior to persistence.
- [x] Add failure behavior for empty/unsafe model outputs.

### 1.2 Document export pipeline (critical functional gap)
- [x] Implement export worker/processor for queued `generated_document_export` rows.
- [x] Generate actual `.docx`/`.pdf` artifact and store in S3.
- [x] Persist `storage_key`, `status`, and failure reasons.
- [x] Add API for export retrieval/status.

### 1.3 Audit/compliance trail completeness
- [x] Ensure `generate/revise/export` write consistent audit metadata for tenant, actor, model, and outcome.
- [x] Verify tenant isolation enforcement in every read/write path touched.

Gate to Phase 2:
- [x] End-to-end document lifecycle works: generate -> revise -> export -> download/status.
- [x] All touched routes have positive + negative smoke tests.

## Phase 2 - Quality & Reliability
Status: In progress

### 2.1 Automated test coverage
- [x] Automated tests for export queue processing and export status/download payload behavior.
- [x] API integration tests for chat and document endpoints (tenant boundaries + auth required paths).
- [x] Regression tests for Bedrock path error handling.
- [x] Migration smoke test in CI against disposable DB.

### 2.2 Runtime checks
- [x] Health/smoke script for dev and staging covering auth + thread + document flow.
- [x] Alarm validation script for periodic ALARM/OK synthetic checks.

Gate to Phase 3:
- [x] CI and smoke suite consistently green.

## Phase 3 - Launch Readiness
Status: In progress

### 3.1 Runbooks & handoff
- [x] Update `docs/INFRA-OPERATIONS.md` with migrator-credential migration flow.
- [x] Keep `docs/HANDOFF-STATE.md` aligned with actual deployed state and known gaps.
- [x] Produce concise go-live checklist (deploy, migrate, smoke, rollback).

### 3.2 Final acceptance
- [x] Staging signoff on complete workflow.
- [x] Explicit PHI gate status remains disabled unless compliance approval is documented.

Gate to Done:
- [x] Product owner signs off on MVP acceptance criteria.

## Phase 4 - App Build (post-MVP)
Status: Not started

### 4.1 Frontend productization
- [ ] Replace scaffold pages (`/login`, `/app`, `/document/[id]`) with production UI tied to live APIs.
- [ ] Implement real thread list/create UX and navigation to document workspace.
- [ ] Implement document workspace UX (chat feed, generate/revise controls, export status/download).
- [ ] Ensure tenant-safe auth UX and route behavior remain aligned with backend auth guards.

### 4.2 Product iteration loop
- [ ] Define first pilot backlog (top user-facing workflow improvements).
- [ ] Add acceptance criteria and instrumentation for each shipped slice.

## Immediate Next 5 Tasks (strict order)
1. Run Planning Mode to produce a concrete Phase 4 implementation plan (scope, milestones, acceptance criteria).
2. Implement first frontend slice: `/app` threads list/create wired to live APIs.
3. Implement second frontend slice: `/document/[id]` live chat + generate/revise actions.
4. Implement third frontend slice: export queue/status/download UX with error states.
5. Execute deferred post-launch infra cleanup items from Phase 0.2 in the approved window.
