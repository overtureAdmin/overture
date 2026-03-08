type SuperAdminAuth = {
  userSub: string;
  groups?: string[];
};

function parseSubjectAllowlist(raw: string | null): Set<string> {
  if (!raw) {
    return new Set();
  }
  return new Set(
    raw
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
  );
}

export function isUnitySuperAdmin(auth: SuperAdminAuth): boolean {
  const configuredSubjects = parseSubjectAllowlist(process.env.UNITY_SUPER_ADMIN_SUBJECTS ?? null);
  if (configuredSubjects.has(auth.userSub)) {
    return true;
  }
  return (auth.groups ?? []).some((group) => group === "unity_super_admin");
}
