export type ThreadSummary = {
  id: string;
  title: string;
  updatedAt: string;
};

export type ThreadMessage = {
  id: string;
  role: "system" | "user" | "assistant";
  content: string;
  createdAt: string;
};

export type ThreadWorkflowStage = {
  stageKey: "intake_review" | "evidence_plan" | "draft_plan";
  status: "pending" | "blocked" | "ready" | "complete";
  summary: string;
  metadata: Record<string, unknown>;
  updatedAt: string;
};

export type LlmReferenceSetting = {
  id: string;
  referenceKind: "link" | "document";
  title: string;
  referenceValue: string;
  usageNote: string;
  sortOrder: number;
};

export type LlmSettings = {
  manageable: boolean;
  systemPrompt: string | null;
  effectiveSystemPrompt: string;
  masterPrompt: string | null;
  references: LlmReferenceSetting[];
};

export type DocumentKind = "lmn" | "appeal" | "p2p";

export type DocumentSummary = {
  id: string;
  threadId: string;
  kind: DocumentKind;
  version: number;
  createdAt: string;
};

export type DocumentDetail = {
  id: string;
  threadId: string;
  kind: DocumentKind;
  version: number;
  content: string;
  createdAt: string;
};

export type ExportFormat = "docx" | "pdf";

export type ExportStatus =
  | "queued"
  | "processing"
  | "completed"
  | "failed";

export type ExportRecord = {
  exportId: string;
  documentId: string;
  format: ExportFormat;
  status: ExportStatus;
  errorMessage: string | null;
  storageKey: string | null;
  downloadUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProfileStatus = {
  actor: {
    tenantId: string;
    role: "org_owner" | "org_admin" | "case_contributor" | "reviewer" | "read_only";
    organizationId: string;
    organizationName: string;
    organizationStatus: "verified" | "pending_verification" | "suspended";
    organizationType: "solo" | "enterprise";
  };
  access: {
    gate:
      | "none"
      | "require_org_selection"
      | "pending_org_join_approval"
      | "require_terms"
      | "require_baa"
      | "require_subscription"
      | "require_onboarding"
      | "pending_enterprise_verification";
    redirectPath: string | null;
    organizationConfirmed: boolean;
    pendingJoinApproval: boolean;
    termsAccepted: boolean;
    baaAccepted: boolean;
    onboardingCompleted: boolean;
    subscriptionStatus: "trialing" | "active" | "past_due" | "canceled" | "none";
  };
};

export type ProfileFieldPolicy = {
  editable: boolean;
  reason: string | null;
};

export type ProfileMe = {
  actor: {
    role: "org_owner" | "org_admin" | "case_contributor" | "reviewer" | "read_only";
    organizationId: string;
    organizationName: string;
    organizationStatus: "verified" | "pending_verification" | "suspended";
    organizationType: "solo" | "enterprise";
    subscriptionStatus: "trialing" | "active" | "past_due" | "canceled" | "none";
  };
  profile: {
    salutation: string | null;
    firstName: string | null;
    lastName: string | null;
    displayName: string | null;
    email: string | null;
    legalName: string | null;
    jobTitle: string | null;
    phone: string | null;
  };
  policy: {
    fields: {
      salutation: ProfileFieldPolicy;
      firstName: ProfileFieldPolicy;
      lastName: ProfileFieldPolicy;
      displayName: ProfileFieldPolicy;
      jobTitle: ProfileFieldPolicy;
      phone: ProfileFieldPolicy;
      legalName: ProfileFieldPolicy;
      email: ProfileFieldPolicy;
    };
    actions: {
      canRequestEmailChange: boolean;
      emailChangeReason: string | null;
      canRequestPasswordReset: boolean;
      canManageMfa: boolean;
    };
  };
};

export type MfaStatus = {
  required: boolean;
  enabled: boolean;
  softwareTokenEnabled?: boolean;
  preferredMethod?: "software_token" | "sms" | "none";
  sessionMfaAuthenticated: boolean | null;
  manageable: boolean;
  reason: string | null;
};

export type MfaSetupStart = {
  secretCode: string;
  otpauthUri: string;
  session: string | null;
};

export type SuperAdminOrganization = {
  id: string;
  name: string;
  status: "verified" | "pending_verification" | "suspended";
  accountType: "solo" | "enterprise";
  activeUsers: number;
  ownerAuthSubject: string | null;
  ownerEmail: string | null;
  ownerDisplayName: string | null;
  ownerTermsAccepted: boolean;
  ownerBaaAccepted: boolean;
};

export type SuperAdminContext = {
  isSuperAdmin: true;
  superAdminSubject: string;
  activeSession: {
    sessionId: string;
    reason: string;
    startedAt: string;
    targetOrganizationId: string;
    targetOrganizationName: string;
    targetAuthSubject: string;
    targetUserDisplay: string;
  } | null;
  organizations: SuperAdminOrganization[];
};

export type SuperAdminUser = {
  authSubject: string;
  email: string | null;
  displayName: string | null;
  role: string;
  membershipStatus: string;
};

export type SuperAdminImpersonationHistoryEntry = {
  sessionId: string;
  status: "active" | "ended";
  reason: string;
  startedAt: string;
  endedAt: string | null;
  targetOrganizationId: string | null;
  targetOrganizationName: string;
  targetAuthSubject: string | null;
  targetUserDisplay: string;
};

export type SuperAdminActionHistoryEntry = {
  id: string;
  actorSubject: string;
  action: string;
  organizationId: string | null;
  targetAuthSubject: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type SuperAdminQaUserState = {
  role: "org_owner" | "org_admin" | "case_contributor" | "reviewer" | "read_only";
  membershipStatus: string;
  organizationConfirmed: boolean;
  pendingJoinApproval: boolean;
  onboardingCompleted: boolean;
  termsAccepted: boolean;
  baaAccepted: boolean;
  threadCount: number;
};

export type SuperAdminQaAction =
  | "fresh_signup"
  | "reset_onboarding"
  | "accept_terms"
  | "accept_baa"
  | "complete_onboarding"
  | "set_role"
  | "seed_cases";

export type AdminWorkflowPolicy = {
  version: number;
  requireChecklistCompletion: boolean;
  allowOwnerAdminOverride: boolean;
  requiredFieldKeys: Array<
    "patientName" | "dob" | "sex" | "diagnosis" | "requestedTreatment" | "denialReason" | "payerName" | "memberId"
  >;
  stageSummaries: {
    intakeReady: string;
    intakeBlocked: string;
    evidenceReady: string;
    evidencePending: string;
    draftBlocked: string;
    draftComplete: string;
  };
};

export type AdminWorkflowPolicyPreviewThread = {
  id: string;
  title: string;
  updatedAt: string;
  hasStructuredContext: boolean;
  latestUserPreview: string;
};

export type AdminWorkflowPolicyPreview = {
  organizationId: string;
  organizationName: string;
  policyVersion: number;
  requireChecklistCompletion: boolean;
  threads: AdminWorkflowPolicyPreviewThread[];
  selectedThreadId: string | null;
  evaluation: {
    status: "ready" | "blocked" | "pending_context";
    hasStructuredContext: boolean;
    requiredFields: string[];
    missingRequired: string[];
    latestUserMessageAt: string | null;
    latestUserPreview: string;
  } | null;
};

export type AdminWorkflowOrchestrationPolicy = {
  version: number;
  n8nEnabled: boolean;
  dispatchMode: "disabled" | "shadow" | "active";
  webhookUrl: string;
  callbackTokenRequired: boolean;
  timeoutMs: number;
  redactPhiBeforeDispatch: boolean;
};

export type AdminWorkflowBatch = {
  id: string;
  organizationId: string;
  threadId: string | null;
  documentId: string | null;
  requestedBySubject: string | null;
  source: "manual" | "document_generate" | "chat";
  status: "queued" | "running" | "completed" | "failed" | "blocked" | "canceled";
  n8nExecutionId: string | null;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
};

export type OrganizationInvite = {
  id: string;
  code: string;
  defaultRole: "org_owner" | "org_admin" | "case_contributor" | "reviewer" | "read_only";
  expiresAt: string;
  maxUses: number;
  usedCount: number;
  status: "active" | "disabled";
};

export type OrganizationJoinRequest = {
  id: string;
  authSubject: string;
  email: string | null;
  requestedRole: "org_owner" | "org_admin" | "case_contributor" | "reviewer" | "read_only";
  status: "pending" | "approved" | "rejected";
  createdAt: string;
};

export type OrganizationUser = {
  authSubject: string;
  email: string | null;
  displayName: string | null;
  role: "org_owner" | "org_admin" | "case_contributor" | "reviewer" | "read_only";
  status: "active" | "invited" | "disabled";
  createdAt: string;
};

export type OrganizationEmailInvite = {
  id: string;
  email: string;
  role: "org_owner" | "org_admin" | "case_contributor" | "reviewer" | "read_only";
  status: "pending" | "accepted" | "canceled" | "expired" | "failed";
  sentAt: string | null;
  expiresAt: string;
  createdAt: string;
};

type ApiErrorPayload = {
  error?: string;
};

export class ApiError extends Error {
  public readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function parseErrorMessage(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as ApiErrorPayload;
    if (typeof payload.error === "string" && payload.error.length > 0) {
      return payload.error;
    }
  } catch {
    // Fall back to generic message for non-JSON failures.
  }
  return `Request failed with status ${response.status}`;
}

async function requestJson<T>(input: string, init: RequestInit): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");

  const response = await fetch(input, {
    ...init,
    headers,
    cache: "no-store",
  });

  if (!response.ok) {
    throw new ApiError(await parseErrorMessage(response), response.status);
  }

  return (await response.json()) as T;
}

type GetThreadsResponse = {
  data: {
    threads: ThreadSummary[];
  };
};

type CreateThreadResponse = {
  data: {
    thread: ThreadSummary;
  };
};

type GetThreadMessagesResponse = {
  data: {
    messages: ThreadMessage[];
  };
};

type GetThreadWorkflowResponse = {
  data: {
    stages: ThreadWorkflowStage[];
  };
};

type GetThreadDocumentsResponse = {
  data: {
    documents: DocumentSummary[];
  };
};

type GetDocumentResponse = {
  data: {
    document: DocumentDetail;
  };
};

type ChatMessageResponse = {
  data: {
    threadId: string;
    userMessageId: string;
    assistantMessageId: string | null;
    assistantReply: string | null;
    citations: unknown[];
  };
};

type GenerateDocumentResponse = {
  data: {
    threadId: string;
    documentId: string;
    kind: DocumentKind;
    version: number;
    status: "draft_ready";
    createdAt: string;
  };
};

type ReviseDocumentResponse = {
  data: {
    documentId: string;
    previousDocumentId: string;
    status: "revised";
    version: number;
    updatedAt: string;
  };
};

type RequestExportResponse = {
  data: {
    documentId: string;
    format: ExportFormat;
    exportId: string;
    status: ExportStatus;
    createdAt: string;
    statusUrl: string;
  };
};

type ExportStatusResponse = {
  data: ExportRecord;
};

type ProcessExportsResponse = {
  data: {
    processed: Array<{
      exportId: string;
      outcome: "completed" | "failed";
      storageKey?: string;
      reason?: string;
    }>;
    exhausted: boolean;
  };
};

type ProfileStatusResponse = {
  data: ProfileStatus;
};

type ProfileMeResponse = {
  data: ProfileMe;
};

type MfaStatusResponse = {
  data: MfaStatus;
};

type MfaSetupStartResponse = {
  data: MfaSetupStart;
};

type SuperAdminContextResponse = {
  data: SuperAdminContext;
};

type SuperAdminUsersResponse = {
  data: {
    users: SuperAdminUser[];
  };
};

type SuperAdminHistoryResponse = {
  data: {
    history: SuperAdminImpersonationHistoryEntry[];
  };
};

type SuperAdminQaUserStateResponse = {
  data: SuperAdminQaUserState;
};

type SuperAdminActionHistoryResponse = {
  data: {
    entries: SuperAdminActionHistoryEntry[];
  };
};

type OrganizationInvitesResponse = {
  data: {
    invites: OrganizationInvite[];
  };
};

type OrganizationJoinRequestsResponse = {
  data: {
    requests: OrganizationJoinRequest[];
  };
};

type OrganizationUsersResponse = {
  data: {
    users: OrganizationUser[];
    invites: OrganizationEmailInvite[];
  };
};

type LlmSettingsResponse = {
  data: LlmSettings;
};

type AdminMasterPromptResponse = {
  data: {
    prompt: string;
  };
};

type AdminWorkflowPolicyResponse = {
  data: {
    policy: AdminWorkflowPolicy;
  };
};

type AdminWorkflowOrchestrationResponse = {
  data: {
    policy: AdminWorkflowOrchestrationPolicy;
  };
};

type AdminWorkflowPolicyPreviewResponse = {
  data: AdminWorkflowPolicyPreview;
};

type AdminWorkflowBatchListResponse = {
  data: {
    batches: AdminWorkflowBatch[];
  };
};

export async function getThreads(): Promise<ThreadSummary[]> {
  const response = await requestJson<GetThreadsResponse>("/api/threads", {
    method: "GET",
  });
  return response.data.threads;
}

export async function createThread(patientCaseTitle: string): Promise<ThreadSummary> {
  const response = await requestJson<CreateThreadResponse>("/api/threads", {
    method: "POST",
    body: JSON.stringify({ patientCaseTitle }),
  });
  return response.data.thread;
}

export async function getThreadMessages(threadId: string): Promise<ThreadMessage[]> {
  const response = await requestJson<GetThreadMessagesResponse>(`/api/threads/${threadId}/messages`, {
    method: "GET",
  });
  return response.data.messages;
}

export async function getThreadWorkflow(threadId: string): Promise<ThreadWorkflowStage[]> {
  const response = await requestJson<GetThreadWorkflowResponse>(`/api/threads/${threadId}/workflow`, {
    method: "GET",
  });
  return response.data.stages;
}

export async function getThreadDocuments(threadId: string): Promise<DocumentSummary[]> {
  const response = await requestJson<GetThreadDocumentsResponse>(`/api/threads/${threadId}/documents`, {
    method: "GET",
  });
  return response.data.documents;
}

export async function getDocumentDetail(documentId: string): Promise<DocumentDetail> {
  const response = await requestJson<GetDocumentResponse>(`/api/documents/${documentId}`, {
    method: "GET",
  });
  return response.data.document;
}

export async function sendChatMessage(
  threadId: string,
  content: string,
  options?: { mode?: "interactive" | "context_only" },
): Promise<ChatMessageResponse["data"]> {
  const response = await requestJson<ChatMessageResponse>(`/api/chat/${threadId}/message`, {
    method: "POST",
    body: JSON.stringify({ role: "user", content, mode: options?.mode }),
  });
  return response.data;
}

export async function generateDocument(
  threadId: string,
  kind: DocumentKind,
  instructions?: string,
  options?: { allowIncomplete?: boolean },
): Promise<GenerateDocumentResponse["data"]> {
  const response = await requestJson<GenerateDocumentResponse>(`/api/documents/${threadId}/generate`, {
    method: "POST",
    body: JSON.stringify({ kind, instructions, allowIncomplete: options?.allowIncomplete === true }),
  });
  return response.data;
}

export async function reviseDocument(
  documentId: string,
  revisionPrompt: string,
): Promise<ReviseDocumentResponse["data"]> {
  const response = await requestJson<ReviseDocumentResponse>(`/api/documents/${documentId}/revise`, {
    method: "POST",
    body: JSON.stringify({ revisionPrompt }),
  });
  return response.data;
}

export async function requestDocumentExport(
  documentId: string,
  format: ExportFormat,
): Promise<RequestExportResponse["data"]> {
  const response = await requestJson<RequestExportResponse>(`/api/documents/${documentId}/export`, {
    method: "POST",
    body: JSON.stringify({ format }),
  });
  return response.data;
}

export async function getDocumentExportStatus(
  documentId: string,
  exportId: string,
): Promise<ExportRecord> {
  const response = await requestJson<ExportStatusResponse>(`/api/documents/${documentId}/export/${exportId}`, {
    method: "GET",
  });
  return response.data;
}

export async function processExports(limit = 1): Promise<void> {
  await requestJson<ProcessExportsResponse>("/api/exports/process", {
    method: "POST",
    body: JSON.stringify({ limit }),
  });
}

export async function getProfileStatus(): Promise<ProfileStatus> {
  const response = await requestJson<ProfileStatusResponse>("/api/profile/status", {
    method: "GET",
  });
  return response.data;
}

export async function acceptBaa(legalName?: string): Promise<void> {
  await requestJson<{ data: { accepted: true } }>("/api/profile/accept-baa", {
    method: "POST",
    body: JSON.stringify(legalName ? { legalName } : {}),
  });
}

export async function acceptTerms(legalName?: string): Promise<void> {
  await requestJson<{ data: { accepted: true } }>("/api/profile/accept-terms", {
    method: "POST",
    body: JSON.stringify(legalName ? { legalName } : {}),
  });
}

export async function activateSoloSubscription(planCode = "solo_monthly"): Promise<void> {
  await requestJson<{ data: { status: "active"; planCode: string } }>("/api/profile/subscription", {
    method: "POST",
    body: JSON.stringify({ action: "start_solo_plan", planCode }),
  });
}

export async function completeOnboarding(params: {
  legalName: string;
  jobTitle?: string;
  phone?: string;
  organizationName?: string;
}): Promise<void> {
  await requestJson<{ data: { completed: true } }>("/api/profile/onboarding", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export async function requestEnterpriseContact(params: { organizationName: string; requestNotes?: string }): Promise<void> {
  await requestJson<{ data: { requestId: string; status: "open" } }>("/api/profile/enterprise-request", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export async function getProfileMe(): Promise<ProfileMe> {
  const response = await requestJson<ProfileMeResponse>("/api/profile/me", {
    method: "GET",
  });
  return response.data;
}

export async function updateProfileMe(params: {
  salutation?: string;
  firstName?: string;
  lastName?: string;
  displayName?: string;
  legalName?: string;
  jobTitle?: string;
  phone?: string;
}): Promise<void> {
  await requestJson<{ data: { updated: true } }>("/api/profile/me", {
    method: "PATCH",
    body: JSON.stringify(params),
  });
}

export async function requestEmailChange(newEmail: string): Promise<{ requestId: string; status: "open"; duplicate: boolean }> {
  const response = await requestJson<{ data: { requestId: string; status: "open"; duplicate: boolean } }>(
    "/api/profile/email-change-request",
    {
      method: "POST",
      body: JSON.stringify({ newEmail }),
    },
  );
  return response.data;
}

export async function getMfaStatus(): Promise<MfaStatus> {
  const response = await requestJson<MfaStatusResponse>("/api/profile/security/mfa-status", {
    method: "GET",
  });
  return response.data;
}

export async function startMfaSetup(): Promise<MfaSetupStart> {
  const response = await requestJson<MfaSetupStartResponse>("/api/profile/security/mfa/setup/start", {
    method: "POST",
    body: "{}",
  });
  return response.data;
}

export async function verifyMfaSetup(params: { code: string; session?: string | null }): Promise<void> {
  await requestJson<{ data: { ok: true } }>("/api/profile/security/mfa/setup/verify", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export async function getPasswordResetAction(): Promise<{ action: string; loginPath: string; instructions: string }> {
  const response = await requestJson<{ data: { action: string; loginPath: string; instructions: string } }>(
    "/api/profile/security/password-reset-link",
    { method: "POST", body: "{}" },
  );
  return response.data;
}

export async function setupOrganization(params:
  | { action: "create"; organizationName: string }
  | { action: "join"; inviteCode: string }): Promise<void> {
  await requestJson<{ data: { ok: true } }>("/api/profile/organization/setup", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export async function listOrganizationInvites(): Promise<OrganizationInvite[]> {
  const response = await requestJson<OrganizationInvitesResponse>("/api/profile/organization/invites", {
    method: "GET",
  });
  return response.data.invites;
}

export async function createOrganizationInvite(params?: {
  defaultRole?: "org_owner" | "org_admin" | "case_contributor" | "reviewer" | "read_only";
  expiresInDays?: number;
  maxUses?: number;
}): Promise<OrganizationInvite> {
  const response = await requestJson<{ data: { invite: OrganizationInvite } }>("/api/profile/organization/invites", {
    method: "POST",
    body: JSON.stringify(params ?? {}),
  });
  return response.data.invite;
}

export async function listOrganizationJoinRequests(): Promise<OrganizationJoinRequest[]> {
  const response = await requestJson<OrganizationJoinRequestsResponse>("/api/profile/organization/join-requests", {
    method: "GET",
  });
  return response.data.requests;
}

export async function reviewOrganizationJoinRequest(requestId: string, decision: "approve" | "reject"): Promise<void> {
  await requestJson<{ data: { ok: true } }>("/api/profile/organization/join-requests/review", {
    method: "POST",
    body: JSON.stringify({ requestId, decision }),
  });
}

export async function listOrganizationUsers(): Promise<{ users: OrganizationUser[]; invites: OrganizationEmailInvite[] }> {
  const response = await requestJson<OrganizationUsersResponse>("/api/profile/organization/users", {
    method: "GET",
  });
  return response.data;
}

export async function inviteOrganizationUser(params: {
  email: string;
  role?: "org_owner" | "org_admin" | "case_contributor" | "reviewer" | "read_only";
}): Promise<{
  invite: OrganizationEmailInvite;
  delivery: { status: "sent" | "existing_user" | "failed"; message: string };
}> {
  const response = await requestJson<{
    data: {
      invite: OrganizationEmailInvite;
      delivery: { status: "sent" | "existing_user" | "failed"; message: string };
    };
  }>("/api/profile/organization/users", {
    method: "POST",
    body: JSON.stringify(params),
  });
  return response.data;
}

export async function getLlmSettings(): Promise<LlmSettings> {
  const response = await requestJson<LlmSettingsResponse>("/api/profile/llm-settings", {
    method: "GET",
  });
  return response.data;
}

export async function updateLlmSettings(params: {
  systemPrompt?: string;
  references?: Array<{
    referenceKind: "link" | "document";
    title: string;
    referenceValue: string;
    usageNote: string;
    sortOrder?: number;
  }>;
}): Promise<void> {
  await requestJson<{ data: { updated: true } }>("/api/profile/llm-settings", {
    method: "PATCH",
    body: JSON.stringify(params),
  });
}

export async function getAdminMasterPrompt(): Promise<string> {
  const response = await requestJson<AdminMasterPromptResponse>("/api/admin/llm/master-prompt", {
    method: "GET",
  });
  return response.data.prompt;
}

export async function updateAdminMasterPrompt(prompt: string): Promise<void> {
  await requestJson<{ data: { updated: true } }>("/api/admin/llm/master-prompt", {
    method: "PATCH",
    body: JSON.stringify({ prompt }),
  });
}

export async function getAdminWorkflowPolicy(): Promise<AdminWorkflowPolicy> {
  const response = await requestJson<AdminWorkflowPolicyResponse>("/api/admin/workflow/policy", {
    method: "GET",
  });
  return response.data.policy;
}

export async function updateAdminWorkflowPolicy(policy: AdminWorkflowPolicy): Promise<AdminWorkflowPolicy> {
  const response = await requestJson<AdminWorkflowPolicyResponse>("/api/admin/workflow/policy", {
    method: "PATCH",
    body: JSON.stringify({ policy }),
  });
  return response.data.policy;
}

export async function getAdminWorkflowPolicyPreview(
  organizationId: string,
  threadId?: string,
): Promise<AdminWorkflowPolicyPreview> {
  const params = new URLSearchParams({ organizationId });
  if (threadId) {
    params.set("threadId", threadId);
  }
  const response = await requestJson<AdminWorkflowPolicyPreviewResponse>(
    `/api/admin/workflow/policy-preview?${params.toString()}`,
    { method: "GET" },
  );
  return response.data;
}

export async function getAdminWorkflowOrchestrationPolicy(): Promise<AdminWorkflowOrchestrationPolicy> {
  const response = await requestJson<AdminWorkflowOrchestrationResponse>("/api/admin/workflow/orchestration", {
    method: "GET",
  });
  return response.data.policy;
}

export async function updateAdminWorkflowOrchestrationPolicy(
  policy: AdminWorkflowOrchestrationPolicy,
): Promise<AdminWorkflowOrchestrationPolicy> {
  const response = await requestJson<AdminWorkflowOrchestrationResponse>("/api/admin/workflow/orchestration", {
    method: "PATCH",
    body: JSON.stringify({ policy }),
  });
  return response.data.policy;
}

export async function listAdminWorkflowBatches(params?: {
  organizationId?: string;
  limit?: number;
}): Promise<AdminWorkflowBatch[]> {
  const query = new URLSearchParams();
  if (params?.organizationId) {
    query.set("organizationId", params.organizationId);
  }
  if (params?.limit) {
    query.set("limit", String(params.limit));
  }
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  const response = await requestJson<AdminWorkflowBatchListResponse>(`/api/admin/workflow/batches${suffix}`, {
    method: "GET",
  });
  return response.data.batches;
}

export async function dispatchAdminWorkflowBatch(params: {
  organizationId: string;
  authSubject?: string;
  threadId?: string;
  documentId?: string;
  source?: "manual" | "document_generate" | "chat";
}): Promise<{ batchId: string; status: string; dispatch: { attempted: boolean; sent: boolean; message: string } }> {
  const response = await requestJson<{
    data: { batchId: string; status: string; dispatch: { attempted: boolean; sent: boolean; message: string } };
  }>("/api/admin/workflow/batches", {
    method: "POST",
    body: JSON.stringify(params),
  });
  return response.data;
}

export async function getAdminImpersonationContext(): Promise<SuperAdminContext> {
  const response = await requestJson<SuperAdminContextResponse>("/api/admin/impersonation/context", {
    method: "GET",
  });
  return response.data;
}

export async function listAdminImpersonationUsers(organizationId: string): Promise<SuperAdminUser[]> {
  const params = new URLSearchParams({ organizationId });
  const response = await requestJson<SuperAdminUsersResponse>(`/api/admin/impersonation/users?${params.toString()}`, {
    method: "GET",
  });
  return response.data.users;
}

export async function startAdminImpersonation(params: {
  targetOrganizationId: string;
  targetAuthSubject: string;
  reason: string;
}): Promise<{ sessionId: string; active: true }> {
  const response = await requestJson<{ data: { sessionId: string; active: true } }>("/api/admin/impersonation/start", {
    method: "POST",
    body: JSON.stringify(params),
  });
  return response.data;
}

export async function stopAdminImpersonation(): Promise<void> {
  await requestJson<{ data: { active: false } }>("/api/admin/impersonation/stop", {
    method: "POST",
    body: "{}",
  });
}

export async function getAdminImpersonationHistory(limit = 50): Promise<SuperAdminImpersonationHistoryEntry[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  const response = await requestJson<SuperAdminHistoryResponse>(`/api/admin/impersonation/history?${params.toString()}`, {
    method: "GET",
  });
  return response.data.history;
}

export async function getAdminQaUserState(organizationId: string, authSubject: string): Promise<SuperAdminQaUserState> {
  const params = new URLSearchParams({ organizationId, authSubject });
  const response = await requestJson<SuperAdminQaUserStateResponse>(`/api/admin/qa/user-tools?${params.toString()}`, {
    method: "GET",
  });
  return response.data;
}

export async function applyAdminQaUserAction(params: {
  organizationId: string;
  authSubject: string;
  action: SuperAdminQaAction;
  role?: "org_owner" | "org_admin" | "case_contributor" | "reviewer" | "read_only";
  count?: number;
}): Promise<void> {
  await requestJson<{ data: { ok: true } }>("/api/admin/qa/user-tools", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export async function resetAdminOrganizationOnboarding(organizationId: string): Promise<void> {
  await requestJson<{ data: { ok: true; ownerAuthSubject: string } }>("/api/admin/organizations/reset-onboarding", {
    method: "POST",
    body: JSON.stringify({ organizationId }),
  });
}

export async function resetAdminUserPassword(params: { organizationId: string; authSubject: string }): Promise<void> {
  await requestJson<{ data: { ok: true; username: string } }>("/api/admin/users/reset-password", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export async function deleteAdminOrganization(organizationId: string): Promise<void> {
  await requestJson<{ data: { ok: true } }>("/api/admin/organizations/delete", {
    method: "POST",
    body: JSON.stringify({ organizationId }),
  });
}

export async function deleteAdminUser(params: { organizationId: string; authSubject: string }): Promise<void> {
  await requestJson<{ data: { ok: true } }>("/api/admin/users/delete", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export async function getAdminActionHistory(params?: {
  limit?: number;
  organizationId?: string;
}): Promise<SuperAdminActionHistoryEntry[]> {
  const search = new URLSearchParams();
  search.set("limit", String(params?.limit ?? 200));
  if (params?.organizationId) {
    search.set("organizationId", params.organizationId);
  }
  const response = await requestJson<SuperAdminActionHistoryResponse>(`/api/admin/actions/history?${search.toString()}`, {
    method: "GET",
  });
  return response.data.entries;
}
