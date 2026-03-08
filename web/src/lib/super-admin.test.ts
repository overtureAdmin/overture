import assert from "node:assert/strict";
import test from "node:test";
import { isUnitySuperAdmin } from "./super-admin.ts";

test("authorizes unity super admin by explicit subject allowlist", () => {
  process.env.UNITY_SUPER_ADMIN_SUBJECTS = "sub-1,sub-2";
  const allowed = isUnitySuperAdmin({
    tokenTenantId: null,
    userSub: "sub-2",
    email: "owner@example.com",
    mfaAuthenticated: true,
    groups: [],
  });
  assert.equal(allowed, true);
});

test("authorizes unity super admin by cognito group", () => {
  delete process.env.UNITY_SUPER_ADMIN_SUBJECTS;
  const allowed = isUnitySuperAdmin({
    tokenTenantId: null,
    userSub: "random-sub",
    email: "owner@example.com",
    mfaAuthenticated: true,
    groups: ["unity_super_admin"],
  });
  assert.equal(allowed, true);
});

test("denies non-admin users", () => {
  process.env.UNITY_SUPER_ADMIN_SUBJECTS = "sub-a";
  const allowed = isUnitySuperAdmin({
    tokenTenantId: null,
    userSub: "sub-b",
    email: "member@example.com",
    mfaAuthenticated: true,
    groups: [],
  });
  assert.equal(allowed, false);
});
