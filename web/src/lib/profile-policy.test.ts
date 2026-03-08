import assert from "node:assert/strict";
import test from "node:test";
import { buildProfilePolicy } from "./profile-policy.ts";

test("allows org owner to request email change", () => {
  const policy = buildProfilePolicy({
    role: "org_owner",
    organizationType: "enterprise",
    organizationStatus: "verified",
    subscriptionStatus: "active",
  });

  assert.equal(policy.actions.canRequestEmailChange, true);
  assert.equal(policy.fields.firstName.editable, true);
});

test("locks email self-service for non-owner users", () => {
  const policy = buildProfilePolicy({
    role: "case_contributor",
    organizationType: "enterprise",
    organizationStatus: "verified",
    subscriptionStatus: "active",
  });

  assert.equal(policy.actions.canRequestEmailChange, false);
  assert.equal(policy.fields.email.editable, false);
  assert.match(policy.actions.emailChangeReason ?? "", /organization owners/i);
});

test("locks profile edits when organization is suspended", () => {
  const policy = buildProfilePolicy({
    role: "org_admin",
    organizationType: "enterprise",
    organizationStatus: "suspended",
    subscriptionStatus: "past_due",
  });

  assert.equal(policy.fields.firstName.editable, false);
  assert.equal(policy.actions.canManageMfa, false);
  assert.equal(policy.actions.canRequestPasswordReset, false);
});
