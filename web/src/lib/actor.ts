export type ActorContext = {
  tenantId: string;
  userId: string;
  role?: "org_owner" | "org_admin" | "case_contributor" | "reviewer" | "read_only";
  baaAccepted?: boolean;
  onboardingCompleted?: boolean;
  organizationStatus?: "verified" | "pending_verification" | "suspended";
  organizationType?: "solo" | "enterprise";
  subscriptionStatus?: "trialing" | "active" | "past_due" | "canceled" | "none";
};
