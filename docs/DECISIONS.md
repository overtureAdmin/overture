# Decisions

## 2026-03-12 - Authentication Moves App-Native While Preserving Cognito + Onboarding Gates
- Decision:
  - Replace the old branded bridge-to-Hosted-UI login experience with an app-native authentication workspace for sign-in, signup, MFA, and password recovery.
- Why:
  - The previous experience felt generic and visually disconnected from the product.
  - Business-critical onboarding steps already lived in the app, so splitting auth and onboarding across mismatched surfaces created unnecessary friction.
- What stays unchanged:
  - Cognito remains the identity backend.
  - Existing onboarding gates remain authoritative: organization selection, Terms, BAA, subscription, enterprise verification, and profile completion.
  - MFA remains required by product policy and is now surfaced inside the auth flow instead of feeling bolted on afterward.
- Implementation shape:
  - App-native auth routes live under `web/src/app/api/auth/*`.
  - Shared auth layout/components live under `web/src/components/auth/*`.
  - `/onboarding` was redesigned to share the same visual/auth shell rather than remaining a separate legacy page.
- Infra consequence:
  - CDK Cognito config must allow self sign-up (`selfSignUpEnabled: true`) for the new create-account flow to work in deployed environments.

## 2026-03-12 - Auth States Share One Premium Shell Instead Of Mode-Specific Layouts
- Decision:
  - Keep every auth step inside one reusable card-and-brand shell rather than designing separate page treatments for sign-in, signup, MFA, forgot password, and legal onboarding.
- Why:
  - The previous auth presentation gave too much visual weight to secondary content and made each step feel like a different screen.
  - A shared shell keeps trust, spacing, and interaction patterns stable while the underlying Cognito state changes.
- Implementation shape:
  - `web/src/components/auth/auth-primitives.tsx` owns the shell, surfaces, inputs, actions, and progress styling.
  - `web/src/components/auth/auth-workspace.tsx` swaps step-specific content inside that shell without changing the auth APIs or business flow order.

## 2026-03-12 - Production Web Container Must Build Before Switching To Runtime-Only Dependencies
- Decision:
  - Build the Next.js app with dev dependencies present, then prune to runtime dependencies, and keep the Next config in JavaScript (`next.config.mjs`) rather than TypeScript for production containers.
- Why:
  - After the AWS account transfer cleanup, the production image path had regressed into setting `NODE_ENV=production` too early.
  - That omitted required build-time dependencies and caused `next start` to attempt package installation at runtime, delaying readiness enough to fail ALB health checks.
- Implementation shape:
  - `web/Dockerfile` now runs `npm ci`, `npm run build`, and only then `npm prune --omit=dev`.
  - `web/next.config.ts` was replaced with `web/next.config.mjs` so the production task no longer needs TypeScript at startup.

## 2026-03-12 - Stack-Managed Lambda Runtime Stays On Node 22
- Decision:
  - Keep the export scheduler Lambda on `nodejs22.x` in CDK.
- Why:
  - The repository already carried a Node 22 runtime hygiene requirement, and the account-transfer merge state had reintroduced `nodejs20.x`.
  - Allowing that regression would re-open a deprecation risk in a stack-managed runtime.
- Implementation shape:
  - `infra/lib/infra-stack.ts` explicitly uses `lambda.Runtime.NODEJS_22_X` for the export scheduler function.

## 2026-03-12 - Endpoint Policy Tooling Must Resolve Environment State Instead Of Hardcoding One Legacy Account
- Decision:
  - Make endpoint-policy apply/check environment-aware through `DEPLOY_ENV` and live AWS metadata rather than pinning the scripts to legacy account `726792844549`.
- Why:
  - The AWS account transfer left the required endpoint-policy verification command pointing at the wrong account and a stale, dev-only secret/endpoint set.
  - That made a required pre-merge verification command fail for reasons unrelated to the actual deployed prod policy.
- Implementation shape:
  - `infra/package.json` now invokes `infra/scripts/apply-vpc-endpoint-policies.sh ${DEPLOY_ENV:-dev} ...`.
  - The script resolves endpoint IDs from `cdk.json` or the deployed network stack, discovers the active app/admin/migrator/stack DB secrets, and derives the appropriate KMS policy scope for the selected environment before applying or checking.
