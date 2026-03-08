export const APP_ROLES = [
  "org_owner",
  "org_admin",
  "case_contributor",
  "reviewer",
  "read_only",
] as const;

export type AppRole = (typeof APP_ROLES)[number];

export type Permission =
  | "case:create"
  | "message:send"
  | "document:generate"
  | "document:revise"
  | "document:export"
  | "workspace:view"
  | "org:manage";

const rolePermissions: Record<AppRole, ReadonlySet<Permission>> = {
  org_owner: new Set([
    "case:create",
    "message:send",
    "document:generate",
    "document:revise",
    "document:export",
    "workspace:view",
    "org:manage",
  ]),
  org_admin: new Set([
    "case:create",
    "message:send",
    "document:generate",
    "document:revise",
    "document:export",
    "workspace:view",
    "org:manage",
  ]),
  case_contributor: new Set([
    "case:create",
    "message:send",
    "document:generate",
    "document:revise",
    "document:export",
    "workspace:view",
  ]),
  reviewer: new Set(["workspace:view", "document:export", "message:send"]),
  read_only: new Set(["workspace:view"]),
};

export function normalizeRole(input: string | null | undefined): AppRole {
  if (!input) {
    return "case_contributor";
  }
  return APP_ROLES.includes(input as AppRole) ? (input as AppRole) : "case_contributor";
}

export function canRole(role: AppRole, permission: Permission): boolean {
  return rolePermissions[role].has(permission);
}
