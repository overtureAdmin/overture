import { jsonError } from "@/lib/http";
import { canRole, Permission } from "@/lib/rbac";

type AccessActor = {
  role?: "org_owner" | "org_admin" | "case_contributor" | "reviewer" | "read_only";
  organizationConfirmed?: boolean;
  pendingJoinApproval?: boolean;
  termsAccepted?: boolean;
  baaAccepted?: boolean;
  onboardingCompleted?: boolean;
  organizationStatus?: "verified" | "pending_verification" | "suspended";
  organizationType?: "solo" | "enterprise";
  subscriptionStatus?: "trialing" | "active" | "past_due" | "canceled" | "none";
};

export type AccessGate =
  | "none"
  | "require_org_selection"
  | "pending_org_join_approval"
  | "require_terms"
  | "require_baa"
  | "require_subscription"
  | "require_onboarding"
  | "pending_enterprise_verification";

export function getPrimaryAccessGate(actor: AccessActor): AccessGate {
  if (actor.pendingJoinApproval === true) {
    return "pending_org_join_approval";
  }
  if (actor.termsAccepted === false) {
    return "require_terms";
  }
  if (actor.baaAccepted === false) {
    return "require_baa";
  }
  if (actor.organizationConfirmed === false) {
    return "require_org_selection";
  }
  if (actor.subscriptionStatus && !["active", "trialing"].includes(actor.subscriptionStatus)) {
    return "require_subscription";
  }
  if (
    actor.organizationType === "enterprise" &&
    actor.organizationStatus &&
    actor.organizationStatus !== "verified"
  ) {
    return "pending_enterprise_verification";
  }
  if (actor.onboardingCompleted === false) {
    return "require_onboarding";
  }
  return "none";
}

export function gateToPath(gate: AccessGate): string | null {
  if (gate === "none") {
    return null;
  }
  if (gate === "require_org_selection") {
    return "/onboarding?step=organization";
  }
  if (gate === "pending_org_join_approval") {
    return "/onboarding?step=join-pending";
  }
  if (gate === "require_terms") {
    return "/onboarding?step=terms";
  }
  if (gate === "pending_enterprise_verification") {
    return "/onboarding?step=enterprise-pending";
  }
  if (gate === "require_baa") {
    return "/onboarding?step=baa";
  }
  if (gate === "require_subscription") {
    return "/onboarding?step=subscription";
  }
  return "/onboarding?step=profile";
}

export function denyIfNoPermission(actor: AccessActor, permission: Permission): Response | null {
  if (canRole(actor.role ?? "case_contributor", permission)) {
    return null;
  }
  return jsonError("Forbidden", 403);
}
