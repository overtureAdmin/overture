type SqlClientLike = {
  query: <T = unknown>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
};

export type WorkflowPolicy = {
  version: string;
  requireChecklistCompletion: boolean;
  allowOwnerAdminOverride: boolean;
  requiredFieldKeys: string[];
  stageSummaries: {
    intakeBlocked: string;
    intakeReady: string;
    evidencePending: string;
    evidenceReady: string;
    draftBlocked: string;
    draftComplete: string;
  };
};

const DEFAULT_POLICY: WorkflowPolicy = {
  version: "v1",
  requireChecklistCompletion: true,
  allowOwnerAdminOverride: true,
  requiredFieldKeys: [
    "patient_name",
    "dob",
    "sex",
    "diagnosis",
    "requested_treatment",
    "denial_reason",
    "payer_name",
    "member_id",
  ],
  stageSummaries: {
    intakeBlocked: "Missing required intake data.",
    intakeReady: "Intake complete.",
    evidencePending: "Evidence planning pending.",
    evidenceReady: "Evidence plan ready.",
    draftBlocked: "Drafting blocked pending required intake.",
    draftComplete: "Draft generated.",
  },
};

export function getDefaultWorkflowPolicy(): WorkflowPolicy {
  return DEFAULT_POLICY;
}

export function normalizeWorkflowPolicy(input: unknown): WorkflowPolicy {
  if (!input || typeof input !== "object") {
    return DEFAULT_POLICY;
  }
  const candidate = input as Partial<WorkflowPolicy>;
  const stageSummaries = (candidate.stageSummaries ?? {}) as Partial<WorkflowPolicy["stageSummaries"]>;
  return {
    version: typeof candidate.version === "string" && candidate.version.trim() ? candidate.version.trim() : DEFAULT_POLICY.version,
    requireChecklistCompletion:
      typeof candidate.requireChecklistCompletion === "boolean"
        ? candidate.requireChecklistCompletion
        : DEFAULT_POLICY.requireChecklistCompletion,
    allowOwnerAdminOverride:
      typeof candidate.allowOwnerAdminOverride === "boolean"
        ? candidate.allowOwnerAdminOverride
        : DEFAULT_POLICY.allowOwnerAdminOverride,
    requiredFieldKeys:
      Array.isArray(candidate.requiredFieldKeys) && candidate.requiredFieldKeys.length > 0
        ? candidate.requiredFieldKeys.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
        : DEFAULT_POLICY.requiredFieldKeys,
    stageSummaries: {
      intakeBlocked:
        typeof stageSummaries.intakeBlocked === "string" && stageSummaries.intakeBlocked.trim()
          ? stageSummaries.intakeBlocked
          : DEFAULT_POLICY.stageSummaries.intakeBlocked,
      intakeReady:
        typeof stageSummaries.intakeReady === "string" && stageSummaries.intakeReady.trim()
          ? stageSummaries.intakeReady
          : DEFAULT_POLICY.stageSummaries.intakeReady,
      evidencePending:
        typeof stageSummaries.evidencePending === "string" && stageSummaries.evidencePending.trim()
          ? stageSummaries.evidencePending
          : DEFAULT_POLICY.stageSummaries.evidencePending,
      evidenceReady:
        typeof stageSummaries.evidenceReady === "string" && stageSummaries.evidenceReady.trim()
          ? stageSummaries.evidenceReady
          : DEFAULT_POLICY.stageSummaries.evidenceReady,
      draftBlocked:
        typeof stageSummaries.draftBlocked === "string" && stageSummaries.draftBlocked.trim()
          ? stageSummaries.draftBlocked
          : DEFAULT_POLICY.stageSummaries.draftBlocked,
      draftComplete:
        typeof stageSummaries.draftComplete === "string" && stageSummaries.draftComplete.trim()
          ? stageSummaries.draftComplete
          : DEFAULT_POLICY.stageSummaries.draftComplete,
    },
  };
}

export async function getWorkflowPolicy(db: SqlClientLike): Promise<WorkflowPolicy> {
  try {
    const result = await db.query<{ policy: unknown }>(
      `
        SELECT policy
        FROM admin_workflow_policy
        WHERE id = 1
        LIMIT 1
      `,
    );
    return normalizeWorkflowPolicy(result.rows[0]?.policy);
  } catch {
    return DEFAULT_POLICY;
  }
}
