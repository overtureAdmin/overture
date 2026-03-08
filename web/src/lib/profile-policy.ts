import type { AppRole } from "./rbac";

export type OrganizationType = "solo" | "enterprise";
export type OrganizationStatus = "verified" | "pending_verification" | "suspended";
export type SubscriptionStatus = "trialing" | "active" | "past_due" | "canceled" | "none";

export type ProfilePolicyActor = {
  role: AppRole;
  organizationType: OrganizationType;
  organizationStatus: OrganizationStatus;
  subscriptionStatus: SubscriptionStatus;
};

export type ProfileFieldKey =
  | "salutation"
  | "firstName"
  | "lastName"
  | "displayName"
  | "jobTitle"
  | "phone"
  | "legalName"
  | "email";

export type FieldPolicy = {
  editable: boolean;
  reason: string | null;
};

export type ProfilePolicy = {
  fields: Record<ProfileFieldKey, FieldPolicy>;
  actions: {
    canRequestEmailChange: boolean;
    emailChangeReason: string | null;
    canRequestPasswordReset: boolean;
    canManageMfa: boolean;
  };
};

function deny(reason: string): FieldPolicy {
  return { editable: false, reason };
}

function allow(): FieldPolicy {
  return { editable: true, reason: null };
}

export function buildProfilePolicy(actor: ProfilePolicyActor): ProfilePolicy {
  const orgSuspended = actor.organizationStatus === "suspended";
  const baseEditable = !orgSuspended;
  const fieldBase = baseEditable ? allow() : deny("Organization is suspended. Contact support.");

  const fields: Record<ProfileFieldKey, FieldPolicy> = {
    salutation: fieldBase,
    firstName: fieldBase,
    lastName: fieldBase,
    displayName: fieldBase,
    jobTitle: fieldBase,
    phone: fieldBase,
    legalName: fieldBase,
    email: deny("Email is organization-managed. Contact your organization admin."),
  };

  const canRequestEmailChange = !orgSuspended && actor.role === "org_owner";
  const emailChangeReason = canRequestEmailChange
    ? null
    : actor.organizationStatus === "suspended"
      ? "Organization is suspended. Contact support."
      : "Only organization owners can request account email changes.";

  return {
    fields,
    actions: {
      canRequestEmailChange,
      emailChangeReason,
      canRequestPasswordReset: !orgSuspended,
      canManageMfa: !orgSuspended,
    },
  };
}
