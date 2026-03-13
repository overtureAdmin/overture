# Overture - Master Execution Plan

Last updated: 2026-03-12
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

### 0.3 Runtime lifecycle hygiene
- [x] Upgrade stack-managed Lambda runtime from deprecated `nodejs20.x` to supported `nodejs22.x` before AWS deprecation milestones.
- [x] Deploy runtime upgrade to canonical dev + staging stacks and validate runtime smoke coverage.

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
Status: In progress
Product spec source for current UI direction: `docs/PRODUCT-DISCOVERY.md`.

### 4.1 Frontend productization
- [x] Replace scaffold pages (`/login`, `/app`, `/document/[id]`) with production UI tied to live APIs.
- [x] Implement real thread list/create UX and navigation to document workspace.
- [x] Implement document workspace UX (chat feed + generate/revise controls) with tenant-scoped hydration APIs.
- [x] Implement document workspace export status/download UX.
- [x] Ensure tenant-safe auth UX and route behavior remain aligned with backend auth guards.
- [x] Finalize staging login/app first-impression polish (Hosted UI branding, app favicon, and left-rail interaction tuning).

### 4.2 Product iteration loop
- [x] Define first pilot backlog direction and UX requirements with SME discovery interview.
- [x] Capture decision-complete product requirements in `docs/PRODUCT-DISCOVERY.md`.
- [x] Implement Slice 2: dynamic intake + required/recommended checklist engine + staged progress UX.
- [x] Implement Slice 3: live-update undo + version dropdown/revert + smart single-button orchestration improvements.
- [x] Implement Slice 4: trusted evidence/citation enforcement + policy/legal prompting logic + comparative plan recommendation.
- [x] Implement Slice 5: organization logo defaults + per-case override UX + pilot metrics instrumentation.
- [x] Refine checklist-gate UX to emit structured chat feedback with missing-required guidance + owner/admin force action.

### 4.3 Access, Identity, and Commercialization Guardrails
- [x] Define and implement updated role taxonomy (`org_owner`, `org_admin`, `case_contributor`, `reviewer`, `read_only`).
- [x] Add backend organization/membership/BAA/subscription/onboarding schema foundations.
- [x] Add post-auth gating endpoints and onboarding wizard routes for BAA -> subscription -> profile completion.
- [x] Add profile workspace route exposing organization + role + subscription state.
- [x] Enable Cognito self sign-up and enforce required MFA (TOTP).
- [x] Implement policy-driven profile editing controls and profile change-request workflow (`/api/profile/me`, `/api/profile/email-change-request`).
- [x] Add security profile APIs for MFA session status and password-management handoff (`/api/profile/security/*`).
- [x] Ship QR-first MFA reset UX in profile (scan-based setup with manual secret fallback; remove end-user disable control).
- [x] Add support impersonation session scaffolding (`/api/admin/impersonation/start|stop` + audited session table).
- [x] Add super-admin operational UI surfaces (global view-as banner, quick org/user switcher, settings entry, and `/app/super-admin` history/controls page).
- [x] Add super-admin QA user-state controls including full `fresh_signup` reset mode for repeatable onboarding-flow testing.
- [x] Add organization invite-code + join-request approval workflow (org owners/admins can generate invite codes and approve/reject join requests).
- [x] Replace onboarding solo path with org-first setup path (create org as owner or join org by invite code).
- [x] Add super-admin destructive management controls (delete organization, delete organization user) with auditable admin action log history.
- [x] Stabilize profile MFA device lifecycle endpoints by granting required Cognito MFA/admin permissions to the ECS web task role in staging.
- [ ] Integrate production payment processor (replace manual subscription activation endpoint).

### 4.4 LLM Prompt Governance and Authoring UX
- [x] Add master + user-level system prompt model with deterministic composition into Bedrock generation paths.
- [x] Add user-managed references (links/documents + usage notes) and include them in effective LLM context.
- [x] Add super-admin master prompt editor and user profile LLM settings editor.
- [x] Update case-view chat to post assistant change summary + linked updated document card after generate/revise.
- [x] Deploy migration + web runtime update to canonical staging (`InfraStack-staging-v2`) and verify rollout completion.
- [x] Enforce prompt de-identification pre-Bedrock and derive DOB into age/year-band context for model reasoning.
- [x] Persist agent workflow stage objects (`intake_review`, `evidence_plan`, `draft_plan`) with tenant-scoped API + workspace rendering.
- [x] Add super-admin workflow policy GUI + API and wire document generation to consume policy at runtime.
- [x] Add super-admin workflow policy preview panel (org/thread selector + missing-required/blocking status) backed by admin API for real-case validation.
- [x] Make case-view chat the primary draft/update interaction path and remove duplicate smart-update trigger from Details tab.
- [x] Improve checklist field extraction for narrative/free-text intake and unify inference+gating parser behavior.
- [x] Implement PHI-safe placeholder workflow in generate/revise path (de-identified prompt -> placeholder output contract -> app-side hydration for final draft render).
- [x] Fix generation checklist false-missing behavior by evaluating required fields across recent user-thread context (not latest message only) and deploy to staging-v2.
- [x] Add n8n OSS orchestration foundation (AWS-hosted service, super-admin orchestration policy, batch dispatch/audit APIs, and batch monitor UI scaffolding).
- [x] Execute staged n8n rollout sequence in `InfraStack-staging-v2` with successful ECS stabilization for both web and n8n services.

### 4.5 Brand Alignment (Overture)
- [x] Replace runtime logo + favicon assets with official Overture brand files.
- [x] Apply purple-first UI palette updates across login/workspace/settings surfaces.
- [x] Update docs and product-facing naming from Unity branding to Overture (while preserving legacy AWS resource IDs in runbooks/evidence).
- [x] Recovered interrupted workspace state and redeployed branded web image to `InfraStack-staging-v2` (ECR digest `sha256:6f071deb90dc3365564103219998dffa5a686caac2c43db2581644eea20de043`).
- [x] Restore full global design system stylesheet (`web/src/app/globals.css`) after fallback regression and redeploy light, readable Overture login/app theme (ECR digest `sha256:faef59a65a9a11ad1730f505f460981caae6b931afafc1973c6f9e96efaeaccd`).
- [x] Codify prod HTTPS listener in CDK using ACM certificate (`tlsCertificateArn`) so ALB TLS is infrastructure-managed (no manual listener drift).
- [x] Repair prod auth branding by redesigning app `/login` and pinning Cognito Hosted UI to classic branded CSS/logo configuration (`ManagedLoginVersion=1`, ECR digest `sha256:6bd9c6a650420b11e6312f3b573ebc549a13499f8e242b6ea825defa43ade5ed`).
- [x] Implement premium app-native auth experience locally (sign in, create account, MFA verify/setup, forgot/reset, and redesigned onboarding shell) with Cognito-backed API routes and reusable auth primitives.
- [x] Align CDK Cognito config with app-native create-account flow by enabling self sign-up in `infra/lib/infra-stack.ts` (deployment still required).
- [x] Simplify and tighten the app-native auth layout/copy in prod so the login/create-account experience fits without desktop scroll and uses Overture-specific product messaging (`sha256:5a5a78a3476f1be97d4b7b78b8696b0b9d97693f1aa5a529141504f299bc38c0`).
- [x] Reframe auth-screen copy and spacing around Overture’s actual appeal-drafting workflow, with larger toggle/button hit areas and better bottom-page spacing (`sha256:325af5d95eb754424f269cdcb188a50f80be4325d895115f174fa44d3705048c`).
- [x] Redesign the full app-native auth entry system into a calmer asymmetric layout with a premium shared card shell across sign-in, account creation, forgot/reset password, MFA, and onboarding/legal steps (local validation: `cd web && npm run test`, `cd web && npm run build`).
- [x] Repair account-transfer regressions affecting prod deployability by restoring the Node 22 Lambda runtime, fixing the production web Docker build, and removing runtime TypeScript installation from Next startup; verified with prod `InfraStack-prod` deploy and live `200` response from `https://app.oncologyexecutive.com/login`.

## Immediate Next 5 Tasks (strict order)
1. Run browser signoff in prod for login, create account, MFA enrollment, forgot password, and onboarding transitions against the deployed app-native auth flow.
2. Run browser signoff specifically for first-login MFA setup under Cognito-required MFA in prod.
3. Add automated API tests for the new app-auth routes (`/api/auth/*`) including challenge, confirmation, password-reset, and MFA-setup edge cases.
4. Add automated coverage or scripted verification for `DEPLOY_ENV=prod npm run check:endpoint-policies` so prod account-transfer regressions are caught earlier.
5. Integrate production payment processor and org billing admin controls.
