"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  applyAdminQaUserAction,
  ApiError,
  deleteAdminOrganization,
  deleteAdminUser,
  getAdminActionHistory,
  getAdminMasterPrompt,
  getAdminWorkflowOrchestrationPolicy,
  getAdminWorkflowPolicyPreview,
  getAdminWorkflowPolicy,
  getAdminQaUserState,
  getAdminImpersonationContext,
  getAdminImpersonationHistory,
  listAdminImpersonationUsers,
  resetAdminOrganizationOnboarding,
  resetAdminUserPassword,
  updateAdminMasterPrompt,
  updateAdminWorkflowOrchestrationPolicy,
  updateAdminWorkflowPolicy,
  listAdminWorkflowBatches,
  dispatchAdminWorkflowBatch,
  type AdminWorkflowPolicyPreview,
  type AdminWorkflowPolicy,
  type AdminWorkflowOrchestrationPolicy,
  type AdminWorkflowBatch,
  type SuperAdminActionHistoryEntry,
  type SuperAdminContext,
  type SuperAdminImpersonationHistoryEntry,
  type SuperAdminOrganization,
  type SuperAdminQaUserState,
  type SuperAdminUser,
} from "@/lib/client-api";
import { SuperAdminBanner } from "@/components/super-admin-banner";
import { SettingsSidebar } from "@/components/settings-sidebar";

function buildLoginRedirect(nextPath: string) {
  return `/login?next=${encodeURIComponent(nextPath)}`;
}

function formatTimestamp(value: string | null): string {
  if (!value) {
    return "Active";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function userDisplay(user: SuperAdminUser): string {
  return user.displayName ?? user.email ?? user.authSubject;
}

function ownerDisplay(organization: SuperAdminOrganization): string {
  return organization.ownerDisplayName ?? organization.ownerEmail ?? organization.ownerAuthSubject ?? "No owner";
}

type SuperAdminTab = "orgs" | "llm-settings" | "workflow" | "history";
type OrganizationFilter = "active" | "pending" | "deleted";

export default function SuperAdminPage() {
  const router = useRouter();
  const [context, setContext] = useState<SuperAdminContext | null>(null);
  const [history, setHistory] = useState<SuperAdminImpersonationHistoryEntry[]>([]);
  const [actionHistory, setActionHistory] = useState<SuperAdminActionHistoryEntry[]>([]);
  const [users, setUsers] = useState<SuperAdminUser[]>([]);
  const [selectedOrganizationId, setSelectedOrganizationId] = useState("");
  const [selectedAuthSubject, setSelectedAuthSubject] = useState("");
  const [loading, setLoading] = useState(true);
  const [orgBusyId, setOrgBusyId] = useState<string | null>(null);
  const [passwordBusySubject, setPasswordBusySubject] = useState<string | null>(null);
  const [deleteOrganizationBusyId, setDeleteOrganizationBusyId] = useState<string | null>(null);
  const [deleteUserBusySubject, setDeleteUserBusySubject] = useState<string | null>(null);
  const [qaBusyAction, setQaBusyAction] = useState<string | null>(null);
  const [qaState, setQaState] = useState<SuperAdminQaUserState | null>(null);
  const [qaRole, setQaRole] = useState<"org_owner" | "org_admin" | "case_contributor" | "reviewer" | "read_only">("case_contributor");
  const [qaSeedCount, setQaSeedCount] = useState(3);
  const [activeTab, setActiveTab] = useState<SuperAdminTab>("orgs");
  const [organizationFilter, setOrganizationFilter] = useState<OrganizationFilter>("active");
  const [masterPrompt, setMasterPrompt] = useState("");
  const [masterPromptBusy, setMasterPromptBusy] = useState(false);
  const [workflowPolicy, setWorkflowPolicy] = useState<AdminWorkflowPolicy | null>(null);
  const [workflowOrchestration, setWorkflowOrchestration] = useState<AdminWorkflowOrchestrationPolicy | null>(null);
  const [workflowOrchestrationBusy, setWorkflowOrchestrationBusy] = useState(false);
  const [workflowBatches, setWorkflowBatches] = useState<AdminWorkflowBatch[]>([]);
  const [workflowBatchBusy, setWorkflowBatchBusy] = useState(false);
  const [workflowPolicyBusy, setWorkflowPolicyBusy] = useState(false);
  const [workflowPreview, setWorkflowPreview] = useState<AdminWorkflowPolicyPreview | null>(null);
  const [workflowPreviewThreadId, setWorkflowPreviewThreadId] = useState("");
  const [workflowPreviewBusy, setWorkflowPreviewBusy] = useState(false);
  const [workflowPreviewError, setWorkflowPreviewError] = useState<string | null>(null);
  const [workflowPreviewRefreshKey, setWorkflowPreviewRefreshKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const selectedOrganization = useMemo(
    () => context?.organizations.find((organization) => organization.id === selectedOrganizationId) ?? null,
    [context?.organizations, selectedOrganizationId],
  );
  const selectedUser = useMemo(
    () => users.find((user) => user.authSubject === selectedAuthSubject) ?? null,
    [users, selectedAuthSubject],
  );
  const filteredOrganizations = useMemo(() => {
    const organizations = context?.organizations ?? [];
    if (organizationFilter === "active") {
      return organizations.filter((organization) => organization.ownerTermsAccepted && organization.ownerBaaAccepted);
    }
    if (organizationFilter === "pending") {
      return organizations.filter((organization) => !organization.ownerTermsAccepted || !organization.ownerBaaAccepted);
    }
    return [];
  }, [context?.organizations, organizationFilter]);
  const deletedOrganizations = useMemo(() => {
    const entries = actionHistory.filter((entry) => entry.action === "admin.organization_delete");
    const dedup = new Map<string, { id: string; name: string; deletedAt: string; deletedBy: string; affectedUsers: number | null }>();
    for (const entry of entries) {
      const metadata = entry.metadata as { organizationName?: unknown; affectedUsers?: unknown };
      const orgId = entry.organizationId ?? `${entry.id}-deleted`;
      if (dedup.has(orgId)) {
        continue;
      }
      dedup.set(orgId, {
        id: orgId,
        name: typeof metadata.organizationName === "string" && metadata.organizationName.trim().length > 0 ? metadata.organizationName : orgId,
        deletedAt: entry.createdAt,
        deletedBy: entry.actorSubject,
        affectedUsers: typeof metadata.affectedUsers === "number" ? metadata.affectedUsers : null,
      });
    }
    return Array.from(dedup.values());
  }, [actionHistory]);

  async function refreshBase() {
    const [nextContext, nextHistory, nextActionHistory, nextMasterPrompt, nextOrchestrationPolicy] = await Promise.all([
      getAdminImpersonationContext(),
      getAdminImpersonationHistory(100),
      getAdminActionHistory({ limit: 200 }),
      getAdminMasterPrompt(),
      getAdminWorkflowOrchestrationPolicy(),
    ]);
    const nextWorkflowPolicy = await getAdminWorkflowPolicy();
    setContext(nextContext);
    setHistory(nextHistory);
    setActionHistory(nextActionHistory);
    setMasterPrompt(nextMasterPrompt);
    setWorkflowPolicy(nextWorkflowPolicy);
    setWorkflowOrchestration(nextOrchestrationPolicy);
    const orgId = nextContext.activeSession?.targetOrganizationId ?? nextContext.organizations[0]?.id ?? "";
    setSelectedOrganizationId(orgId);
  }

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [nextContext, nextHistory, nextActionHistory, nextMasterPrompt, nextOrchestrationPolicy] = await Promise.all([
          getAdminImpersonationContext(),
          getAdminImpersonationHistory(100),
          getAdminActionHistory({ limit: 200 }),
          getAdminMasterPrompt(),
          getAdminWorkflowOrchestrationPolicy(),
        ]);
        const nextWorkflowPolicy = await getAdminWorkflowPolicy();
        if (!mounted) {
          return;
        }
        setContext(nextContext);
        setHistory(nextHistory);
        setActionHistory(nextActionHistory);
        setMasterPrompt(nextMasterPrompt);
        setWorkflowPolicy(nextWorkflowPolicy);
        setWorkflowOrchestration(nextOrchestrationPolicy);
        const orgId = nextContext.activeSession?.targetOrganizationId ?? nextContext.organizations[0]?.id ?? "";
        setSelectedOrganizationId(orgId);
      } catch (cause) {
        if (cause instanceof ApiError && cause.status === 401) {
          router.replace(buildLoginRedirect("/app/super-admin"));
          return;
        }
        if (cause instanceof ApiError && cause.status === 403) {
          setError("Super admin access is required.");
        } else {
          setError(cause instanceof Error ? cause.message : "Failed to load super admin workspace.");
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }
    void load();
    return () => {
      mounted = false;
    };
  }, [router]);

  useEffect(() => {
    let mounted = true;
    async function loadUsers() {
      if (!selectedOrganizationId) {
        setUsers([]);
        setSelectedAuthSubject("");
        return;
      }
      try {
        const nextUsers = await listAdminImpersonationUsers(selectedOrganizationId);
        if (!mounted) {
          return;
        }
        setUsers(nextUsers);
        const preferred = context?.activeSession?.targetOrganizationId === selectedOrganizationId
          ? context.activeSession.targetAuthSubject
          : nextUsers[0]?.authSubject ?? "";
        setSelectedAuthSubject((current) => (current && nextUsers.some((user) => user.authSubject === current) ? current : preferred));
      } catch (cause) {
        if (mounted) {
          setError(cause instanceof Error ? cause.message : "Failed to load organization users.");
        }
      }
    }
    void loadUsers();
    return () => {
      mounted = false;
    };
  }, [context?.activeSession?.targetAuthSubject, context?.activeSession?.targetOrganizationId, selectedOrganizationId]);

  useEffect(() => {
    let mounted = true;
    async function loadQaState() {
      if (!selectedOrganizationId || !selectedAuthSubject) {
        setQaState(null);
        return;
      }
      try {
        const nextState = await getAdminQaUserState(selectedOrganizationId, selectedAuthSubject);
        if (!mounted) {
          return;
        }
        setQaState(nextState);
        setQaRole(nextState.role);
      } catch (cause) {
        if (mounted) {
          setError(cause instanceof Error ? cause.message : "Failed to load QA state.");
        }
      }
    }
    void loadQaState();
    return () => {
      mounted = false;
    };
  }, [selectedAuthSubject, selectedOrganizationId]);

  useEffect(() => {
    setWorkflowPreviewThreadId("");
    setWorkflowPreview(null);
    setWorkflowPreviewError(null);
  }, [selectedOrganizationId]);

  useEffect(() => {
    let mounted = true;
    async function loadWorkflowPreview() {
      if (activeTab !== "workflow" || !selectedOrganizationId) {
        return;
      }
      setWorkflowPreviewBusy(true);
      setWorkflowPreviewError(null);
      try {
        const preview = await getAdminWorkflowPolicyPreview(
          selectedOrganizationId,
          workflowPreviewThreadId || undefined,
        );
        if (!mounted) {
          return;
        }
        setWorkflowPreview(preview);
        if (preview.selectedThreadId && preview.selectedThreadId !== workflowPreviewThreadId) {
          setWorkflowPreviewThreadId(preview.selectedThreadId);
        }
      } catch (cause) {
        if (!mounted) {
          return;
        }
        setWorkflowPreviewError(cause instanceof Error ? cause.message : "Failed to load policy preview.");
      } finally {
        if (mounted) {
          setWorkflowPreviewBusy(false);
        }
      }
    }
    void loadWorkflowPreview();
    return () => {
      mounted = false;
    };
  }, [activeTab, selectedOrganizationId, workflowPreviewRefreshKey, workflowPreviewThreadId]);

  useEffect(() => {
    let mounted = true;
    async function loadBatches() {
      if (activeTab !== "workflow" || !selectedOrganizationId) {
        if (mounted) {
          setWorkflowBatches([]);
        }
        return;
      }
      try {
        const batches = await listAdminWorkflowBatches({ organizationId: selectedOrganizationId, limit: 20 });
        if (mounted) {
          setWorkflowBatches(batches);
        }
      } catch (cause) {
        if (mounted) {
          setError(cause instanceof Error ? cause.message : "Failed to load workflow batches.");
        }
      }
    }
    void loadBatches();
    return () => {
      mounted = false;
    };
  }, [activeTab, selectedOrganizationId, workflowPreviewRefreshKey]);

  async function runQaAction(action: "fresh_signup" | "reset_onboarding" | "accept_terms" | "accept_baa" | "complete_onboarding" | "set_role" | "seed_cases") {
    if (!selectedOrganizationId || !selectedAuthSubject) {
      setError("Select organization and user first.");
      return;
    }
    setQaBusyAction(action);
    setError(null);
    setMessage(null);
    try {
      await applyAdminQaUserAction({
        organizationId: selectedOrganizationId,
        authSubject: selectedAuthSubject,
        action,
        role: action === "set_role" ? qaRole : undefined,
        count: action === "seed_cases" ? qaSeedCount : undefined,
      });
      const nextState = await getAdminQaUserState(selectedOrganizationId, selectedAuthSubject);
      setQaState(nextState);
      setMessage(`QA action applied: ${action}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Failed QA action: ${action}`);
    } finally {
      setQaBusyAction(null);
    }
  }

  async function onResetOrganizationOnboarding(organizationId: string) {
    setOrgBusyId(organizationId);
    setError(null);
    setMessage(null);
    try {
      await resetAdminOrganizationOnboarding(organizationId);
      await refreshBase();
      if (selectedOrganizationId === organizationId && selectedAuthSubject) {
        const nextState = await getAdminQaUserState(organizationId, selectedAuthSubject);
        setQaState(nextState);
      }
      setMessage("Organization owner onboarding reset. Owner must re-accept Terms and BAA on next sign-in.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to reset organization onboarding.");
    } finally {
      setOrgBusyId(null);
    }
  }

  async function onResetUserPassword(organizationId: string, authSubject: string) {
    setPasswordBusySubject(authSubject);
    setError(null);
    setMessage(null);
    try {
      await resetAdminUserPassword({ organizationId, authSubject });
      setMessage("Password reset flow prepared. User should complete Hosted UI 'Forgot your password?' flow.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to start password reset flow.");
    } finally {
      setPasswordBusySubject(null);
    }
  }

  async function onDeleteOrganization(organizationId: string, organizationName: string) {
    const confirmed = window.confirm(
      `Delete organization "${organizationName}" and all org data/users? This action cannot be undone.`,
    );
    if (!confirmed) {
      return;
    }

    setDeleteOrganizationBusyId(organizationId);
    setError(null);
    setMessage(null);
    try {
      await deleteAdminOrganization(organizationId);
      await refreshBase();
      if (selectedOrganizationId === organizationId) {
        setSelectedAuthSubject("");
        setQaState(null);
      }
      setMessage(`Organization deleted: ${organizationName}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to delete organization.");
    } finally {
      setDeleteOrganizationBusyId(null);
    }
  }

  async function onDeleteUser(organizationId: string, authSubject: string) {
    const confirmed = window.confirm(
      "Delete this user from the selected organization? Their user-scoped references in this org will be detached.",
    );
    if (!confirmed) {
      return;
    }

    setDeleteUserBusySubject(authSubject);
    setError(null);
    setMessage(null);
    try {
      await deleteAdminUser({ organizationId, authSubject });
      await refreshBase();
      const nextUsers = await listAdminImpersonationUsers(organizationId);
      setUsers(nextUsers);
      setSelectedAuthSubject((current) =>
        current === authSubject ? (nextUsers[0]?.authSubject ?? "") : current,
      );
      setQaState(null);
      setMessage(`User removed from organization: ${authSubject}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to delete user.");
    } finally {
      setDeleteUserBusySubject(null);
    }
  }

  async function onSaveMasterPrompt() {
    setMasterPromptBusy(true);
    setError(null);
    setMessage(null);
    try {
      await updateAdminMasterPrompt(masterPrompt);
      setMessage("Master system prompt updated.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to update master system prompt.");
    } finally {
      setMasterPromptBusy(false);
    }
  }

  async function onSaveWorkflowPolicy() {
    if (!workflowPolicy) {
      return;
    }
    setWorkflowPolicyBusy(true);
    setError(null);
    setMessage(null);
    try {
      const updated = await updateAdminWorkflowPolicy(workflowPolicy);
      setWorkflowPolicy(updated);
      setMessage("Workflow policy updated.");
      await refreshBase();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to update workflow policy.");
    } finally {
      setWorkflowPolicyBusy(false);
    }
  }

  async function onSaveWorkflowOrchestration() {
    if (!workflowOrchestration) {
      return;
    }
    setWorkflowOrchestrationBusy(true);
    setError(null);
    setMessage(null);
    try {
      const updated = await updateAdminWorkflowOrchestrationPolicy(workflowOrchestration);
      setWorkflowOrchestration(updated);
      setMessage("Workflow orchestration settings updated.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to update workflow orchestration settings.");
    } finally {
      setWorkflowOrchestrationBusy(false);
    }
  }

  async function onDispatchWorkflowBatch() {
    if (!selectedOrganizationId) {
      setError("Select an organization first.");
      return;
    }
    setWorkflowBatchBusy(true);
    setError(null);
    setMessage(null);
    try {
      const selectedThread = workflowPreview?.selectedThreadId ?? workflowPreviewThreadId ?? undefined;
      const result = await dispatchAdminWorkflowBatch({
        organizationId: selectedOrganizationId,
        authSubject: selectedAuthSubject || undefined,
        threadId: selectedThread,
        source: "manual",
      });
      setMessage(
        result.dispatch.sent
          ? `Batch dispatched to n8n: ${result.batchId}`
          : `Batch created (${result.batchId}) but not dispatched: ${result.dispatch.message}`,
      );
      setWorkflowPreviewRefreshKey((current) => current + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to dispatch workflow batch.");
    } finally {
      setWorkflowBatchBusy(false);
    }
  }

  if (loading) {
    return (
      <main className="mx-auto h-screen w-full max-w-[1400px] overflow-hidden px-6 py-8">
        <div className="flex h-full min-h-0 flex-col gap-4">
          <SuperAdminBanner />
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
            <SettingsSidebar active="super-admin" className="h-full min-h-0 overflow-y-auto" />
            <section className="calm-card h-full min-h-0 overflow-y-auto p-6 text-sm text-[#6a5488]">Loading super admin controls...</section>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto h-screen w-full max-w-[1400px] overflow-hidden px-6 py-8">
      <div className="flex h-full min-h-0 flex-col gap-4">
        <SuperAdminBanner />
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
          <SettingsSidebar active="super-admin" className="h-full min-h-0 overflow-y-auto" />

          <section className="calm-card h-full min-h-0 overflow-y-auto p-6 md:p-8">
          <h1 className="text-2xl font-semibold tracking-tight text-[#331c4a]">Super Admin</h1>
          <p className="mt-2 text-sm text-[#6b5588]">
            Manage organizations, users, and QA state. Use the top banner for view-as controls.
          </p>
          <div className="mt-4 inline-flex rounded-xl border border-[var(--border)] bg-white p-1">
            <button
              type="button"
              className={`rounded-lg px-3 py-1.5 text-sm ${activeTab === "orgs" ? "bg-[#f2e8fb] text-[#4a2f6e]" : "text-[#685285]"}`}
              onClick={() => setActiveTab("orgs")}
            >
              Orgs
            </button>
            <button
              type="button"
              className={`rounded-lg px-3 py-1.5 text-sm ${activeTab === "history" ? "bg-[#f2e8fb] text-[#4a2f6e]" : "text-[#685285]"}`}
              onClick={() => setActiveTab("history")}
            >
              History
            </button>
            <button
              type="button"
              className={`rounded-lg px-3 py-1.5 text-sm ${activeTab === "llm-settings" ? "bg-[#f2e8fb] text-[#4a2f6e]" : "text-[#685285]"}`}
              onClick={() => setActiveTab("llm-settings")}
            >
              LLM Settings
            </button>
            <button
              type="button"
              className={`rounded-lg px-3 py-1.5 text-sm ${activeTab === "workflow" ? "bg-[#f2e8fb] text-[#4a2f6e]" : "text-[#685285]"}`}
              onClick={() => setActiveTab("workflow")}
            >
              Workflow
            </button>
          </div>
          {error ? <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
          {message ? <p className="mt-4 rounded-xl border border-[#d9cce8] bg-[#f8f3fd] px-3 py-2 text-sm text-[#543673]">{message}</p> : null}

          {activeTab === "orgs" ? (
            <>
              <div className="mt-6 rounded-xl border border-[var(--border)] bg-white p-4">
              <p className="text-xs uppercase tracking-wider text-[#7a6298]">Step 1 - Select Organization</p>
              <p className="mt-1 text-xs text-[#715a90]">
                Terms/BAA columns represent current org-owner acceptance status.
              </p>
              <div className="mt-3 inline-flex rounded-lg border border-[var(--border)] bg-[#fcf9ff] p-1">
                <button
                  type="button"
                  className={`rounded-md px-3 py-1 text-xs ${organizationFilter === "active" ? "bg-[#f2e8fb] text-[#4a2f6e]" : "text-[#715a90]"}`}
                  onClick={() => setOrganizationFilter("active")}
                >
                  Active
                </button>
                <button
                  type="button"
                  className={`rounded-md px-3 py-1 text-xs ${organizationFilter === "pending" ? "bg-[#f2e8fb] text-[#4a2f6e]" : "text-[#715a90]"}`}
                  onClick={() => setOrganizationFilter("pending")}
                >
                  Pending
                </button>
                <button
                  type="button"
                  className={`rounded-md px-3 py-1 text-xs ${organizationFilter === "deleted" ? "bg-[#f2e8fb] text-[#4a2f6e]" : "text-[#715a90]"}`}
                  onClick={() => setOrganizationFilter("deleted")}
                >
                  Deleted
                </button>
              </div>
              <div className="mt-3 overflow-x-auto">
                {organizationFilter !== "deleted" ? (
                  <table className="min-w-full text-left text-sm text-[#44295f]">
                    <thead className="text-xs uppercase tracking-wider text-[#7a6298]">
                      <tr>
                        <th className="px-2 py-1">Organization</th>
                        <th className="px-2 py-1">Owner</th>
                        <th className="px-2 py-1">Terms</th>
                        <th className="px-2 py-1">BAA</th>
                        <th className="px-2 py-1">Users</th>
                        <th className="px-2 py-1">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredOrganizations.map((organization) => (
                        <tr
                          key={organization.id}
                          className={`border-t border-[var(--border)] ${selectedOrganizationId === organization.id ? "bg-[#f8f3fd]" : ""}`}
                        >
                          <td className="px-2 py-2">
                            <button
                              type="button"
                              onClick={() => setSelectedOrganizationId(organization.id)}
                              className="text-left text-[#4a2f6e] underline-offset-2 hover:underline"
                            >
                              {organization.name}
                            </button>
                          </td>
                          <td className="px-2 py-2">{ownerDisplay(organization)}</td>
                          <td className="px-2 py-2">{organization.ownerTermsAccepted ? "Accepted" : "Pending"}</td>
                          <td className="px-2 py-2">{organization.ownerBaaAccepted ? "Accepted" : "Pending"}</td>
                          <td className="px-2 py-2">{organization.activeUsers}</td>
                          <td className="px-2 py-2">
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                className="calm-ghost px-2 py-1 text-xs"
                                disabled={orgBusyId !== null || deleteOrganizationBusyId !== null}
                                onClick={() => void onResetOrganizationOnboarding(organization.id)}
                              >
                                {orgBusyId === organization.id ? "Working..." : "Reset onboarding"}
                              </button>
                              <button
                                type="button"
                                className="rounded-md border border-red-300 px-2 py-1 text-xs text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                                disabled={orgBusyId !== null || deleteOrganizationBusyId !== null}
                                onClick={() => void onDeleteOrganization(organization.id, organization.name)}
                              >
                                {deleteOrganizationBusyId === organization.id ? "Deleting..." : "Delete org"}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {filteredOrganizations.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-2 py-3 text-sm text-[#715a90]">
                            No organizations for this filter.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                ) : (
                  <table className="min-w-full text-left text-sm text-[#44295f]">
                    <thead className="text-xs uppercase tracking-wider text-[#7a6298]">
                      <tr>
                        <th className="px-2 py-1">Organization</th>
                        <th className="px-2 py-1">Deleted By</th>
                        <th className="px-2 py-1">When</th>
                        <th className="px-2 py-1">Affected Users</th>
                      </tr>
                    </thead>
                    <tbody>
                      {deletedOrganizations.map((organization) => (
                        <tr key={organization.id} className="border-t border-[var(--border)]">
                          <td className="px-2 py-2">{organization.name}</td>
                          <td className="px-2 py-2">{organization.deletedBy}</td>
                          <td className="px-2 py-2">{formatTimestamp(organization.deletedAt)}</td>
                          <td className="px-2 py-2">{organization.affectedUsers ?? "-"}</td>
                        </tr>
                      ))}
                      {deletedOrganizations.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="px-2 py-3 text-sm text-[#715a90]">
                            No deleted organizations logged yet.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

              <div className="mt-6 rounded-xl border border-[#d9cce8] bg-[#faf4ff] p-4">
              <p className="text-xs uppercase tracking-wider text-[#7a6298]">Current Selection</p>
              <p className="mt-1 text-sm text-[#44295f]">
                Organization: {selectedOrganization?.name ?? "Not selected"} {" · "}
                User: {selectedUser ? userDisplay(selectedUser) : "Not selected"}
              </p>
              <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-[1fr_auto_1fr_auto_1fr] md:items-center">
                <div className={`rounded-lg border px-3 py-2 text-xs ${selectedOrganizationId ? "border-[#cdbbe0] bg-[#f3ebfb] text-[#4a2f6e]" : "border-[var(--border)] bg-white text-[#7a6298]"}`}>
                  1. Org selected
                </div>
                <div className="hidden text-[#b79cd4] md:block">→</div>
                <div className={`rounded-lg border px-3 py-2 text-xs ${selectedAuthSubject ? "border-[#cdbbe0] bg-[#f3ebfb] text-[#4a2f6e]" : "border-[var(--border)] bg-white text-[#7a6298]"}`}>
                  2. User selected
                </div>
                <div className="hidden text-[#b79cd4] md:block">→</div>
                <div className={`rounded-lg border px-3 py-2 text-xs ${selectedOrganizationId && selectedAuthSubject ? "border-[#cdbbe0] bg-[#f3ebfb] text-[#4a2f6e]" : "border-[var(--border)] bg-white text-[#7a6298]"}`}>
                  3. Actions enabled
                </div>
              </div>
            </div>

              <div
              className={`mt-6 rounded-xl border p-4 ${
                selectedOrganizationId ? "border-[#d9cce8] bg-[#faf4ff]" : "border-[var(--border)] bg-white"
              }`}
              >
              <p className="text-xs uppercase tracking-wider text-[#7a6298]">Step 2 - Organization Users</p>
              {!selectedOrganizationId ? <p className="mt-2 text-sm text-[#715a90]">Select an organization first.</p> : null}
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-full text-left text-sm text-[#44295f]">
                  <thead className="text-xs uppercase tracking-wider text-[#7a6298]">
                    <tr>
                      <th className="px-2 py-1">User</th>
                      <th className="px-2 py-1">Role</th>
                      <th className="px-2 py-1">Membership</th>
                      <th className="px-2 py-1">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((user) => (
                      <tr
                        key={user.authSubject}
                        className={`border-t border-[var(--border)] ${selectedAuthSubject === user.authSubject ? "bg-[#f3ebfb]" : ""}`}
                      >
                        <td className="px-2 py-2">{userDisplay(user)}</td>
                        <td className="px-2 py-2">{user.role}</td>
                        <td className="px-2 py-2">{user.membershipStatus}</td>
                        <td className="px-2 py-2">
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              className="calm-ghost px-2 py-1 text-xs"
                              disabled={!selectedOrganizationId || passwordBusySubject !== null || deleteUserBusySubject !== null}
                              onClick={() => void onResetUserPassword(selectedOrganizationId, user.authSubject)}
                            >
                              {passwordBusySubject === user.authSubject ? "Working..." : "Reset password"}
                            </button>
                            <button
                              type="button"
                              className="calm-ghost px-2 py-1 text-xs"
                              disabled={!selectedOrganizationId}
                              onClick={() => {
                                setSelectedAuthSubject(user.authSubject);
                              }}
                            >
                              Select user
                            </button>
                            <button
                              type="button"
                              className="rounded-md border border-red-300 px-2 py-1 text-xs text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                              disabled={!selectedOrganizationId || deleteUserBusySubject !== null}
                              onClick={() => void onDeleteUser(selectedOrganizationId, user.authSubject)}
                            >
                              {deleteUserBusySubject === user.authSubject ? "Deleting..." : "Delete user"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {users.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-2 py-3 text-sm text-[#715a90]">
                          No users found for selected organization.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>

              <div
              className={`mt-6 rounded-xl border p-4 ${
                selectedOrganizationId && selectedAuthSubject ? "border-[#d9cce8] bg-[#faf4ff]" : "border-[var(--border)] bg-white"
              }`}
              >
              <p className="text-xs uppercase tracking-wider text-[#7a6298]">Step 3 - QA Tools (Selected Org/User)</p>
              {!selectedOrganizationId || !selectedAuthSubject ? (
                <p className="mt-2 text-sm text-[#715a90]">Select an organization and user above to run QA actions.</p>
              ) : null}
              {qaState ? (
                <div className="mt-2 grid grid-cols-1 gap-2 text-sm text-[#44295f] md:grid-cols-2">
                  <p>Role: {qaState.role}</p>
                  <p>Membership: {qaState.membershipStatus}</p>
                  <p>Org confirmed: {qaState.organizationConfirmed ? "Yes" : "No"}</p>
                  <p>Join pending: {qaState.pendingJoinApproval ? "Yes" : "No"}</p>
                  <p>Terms accepted: {qaState.termsAccepted ? "Yes" : "No"}</p>
                  <p>BAA accepted: {qaState.baaAccepted ? "Yes" : "No"}</p>
                  <p>Onboarding complete: {qaState.onboardingCompleted ? "Yes" : "No"}</p>
                  <p>Threads created: {qaState.threadCount}</p>
                </div>
              ) : null}

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="calm-ghost px-3 py-2 text-sm"
                  disabled={qaBusyAction !== null || !selectedOrganizationId || !selectedAuthSubject}
                  onClick={() => void runQaAction("fresh_signup")}
                >
                  {qaBusyAction === "fresh_signup" ? "Working..." : "Set to fresh signup state"}
                </button>
                <button
                  type="button"
                  className="calm-ghost px-3 py-2 text-sm"
                  disabled={qaBusyAction !== null || !selectedOrganizationId || !selectedAuthSubject}
                  onClick={() => void runQaAction("reset_onboarding")}
                >
                  {qaBusyAction === "reset_onboarding" ? "Working..." : "Reset onboarding"}
                </button>
                <button
                  type="button"
                  className="calm-ghost px-3 py-2 text-sm"
                  disabled={qaBusyAction !== null || !selectedOrganizationId || !selectedAuthSubject}
                  onClick={() => void runQaAction("accept_terms")}
                >
                  {qaBusyAction === "accept_terms" ? "Working..." : "Accept terms"}
                </button>
                <button
                  type="button"
                  className="calm-ghost px-3 py-2 text-sm"
                  disabled={qaBusyAction !== null || !selectedOrganizationId || !selectedAuthSubject}
                  onClick={() => void runQaAction("accept_baa")}
                >
                  {qaBusyAction === "accept_baa" ? "Working..." : "Accept BAA"}
                </button>
                <button
                  type="button"
                  className="calm-ghost px-3 py-2 text-sm"
                  disabled={qaBusyAction !== null || !selectedOrganizationId || !selectedAuthSubject}
                  onClick={() => void runQaAction("complete_onboarding")}
                >
                  {qaBusyAction === "complete_onboarding" ? "Working..." : "Complete onboarding"}
                </button>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <select
                  value={qaRole}
                  onChange={(event) =>
                    setQaRole(event.target.value as "org_owner" | "org_admin" | "case_contributor" | "reviewer" | "read_only")
                  }
                  className="calm-input px-3 py-2 text-sm"
                  disabled={qaBusyAction !== null || !selectedOrganizationId || !selectedAuthSubject}
                >
                  <option value="org_owner">org_owner</option>
                  <option value="org_admin">org_admin</option>
                  <option value="case_contributor">case_contributor</option>
                  <option value="reviewer">reviewer</option>
                  <option value="read_only">read_only</option>
                </select>
                <button
                  type="button"
                  className="calm-ghost px-3 py-2 text-sm"
                  disabled={qaBusyAction !== null || !selectedOrganizationId || !selectedAuthSubject}
                  onClick={() => void runQaAction("set_role")}
                >
                  {qaBusyAction === "set_role" ? "Working..." : "Apply role"}
                </button>

                <input
                  type="number"
                  min={1}
                  max={15}
                  value={qaSeedCount}
                  onChange={(event) => setQaSeedCount(Math.max(1, Math.min(15, Number(event.target.value) || 1)))}
                  className="calm-input w-24 px-3 py-2 text-sm"
                  disabled={qaBusyAction !== null || !selectedOrganizationId || !selectedAuthSubject}
                />
                <button
                  type="button"
                  className="calm-ghost px-3 py-2 text-sm"
                  disabled={qaBusyAction !== null || !selectedOrganizationId || !selectedAuthSubject}
                  onClick={() => void runQaAction("seed_cases")}
                >
                  {qaBusyAction === "seed_cases" ? "Working..." : "Seed cases"}
                </button>
              </div>
              </div>
            </>
          ) : null}

          {activeTab === "llm-settings" ? (
            <div className="mt-6 rounded-xl border border-[var(--border)] bg-white p-4">
              <p className="text-xs uppercase tracking-wider text-[#7a6298]">Master System Prompt</p>
              <p className="mt-1 text-xs text-[#715a90]">Default prompt applied to users who do not set a personal prompt.</p>
              <textarea
                value={masterPrompt}
                onChange={(event) => setMasterPrompt(event.target.value)}
                className="calm-input mt-3 min-h-32 w-full px-3 py-2 text-sm"
                placeholder="Set global system prompt..."
                disabled={masterPromptBusy}
              />
              <button
                type="button"
                className="calm-ghost mt-3 px-3 py-2 text-sm"
                onClick={() => void onSaveMasterPrompt()}
                disabled={masterPromptBusy}
              >
                {masterPromptBusy ? "Saving..." : "Save master prompt"}
              </button>
            </div>
          ) : null}

          {activeTab === "workflow" && workflowPolicy ? (
            <div className="mt-6 rounded-xl border border-[var(--border)] bg-white p-4">
              <p className="text-xs uppercase tracking-wider text-[#7a6298]">Workflow Policy</p>
              <p className="mt-1 text-xs text-[#715a90]">Controls checklist blocking and stage guidance across all users.</p>

              <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-2">
                <label className="inline-flex items-center gap-2 text-sm text-[#44295f]">
                  <input
                    type="checkbox"
                    checked={workflowPolicy.requireChecklistCompletion}
                    onChange={(event) =>
                      setWorkflowPolicy((current) =>
                        current ? { ...current, requireChecklistCompletion: event.target.checked } : current,
                      )
                    }
                    disabled={workflowPolicyBusy}
                  />
                  Require checklist completion before draft generation
                </label>
                <label className="inline-flex items-center gap-2 text-sm text-[#44295f]">
                  <input
                    type="checkbox"
                    checked={workflowPolicy.allowOwnerAdminOverride}
                    onChange={(event) =>
                      setWorkflowPolicy((current) =>
                        current ? { ...current, allowOwnerAdminOverride: event.target.checked } : current,
                      )
                    }
                    disabled={workflowPolicyBusy}
                  />
                  Allow org owner/admin force override
                </label>
              </div>

              <div className="mt-4">
                <p className="text-xs uppercase tracking-wider text-[#7a6298]">Required Checklist Fields</p>
                <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
                  {[
                    ["patientName", "Patient name"],
                    ["dob", "DOB"],
                    ["sex", "Sex"],
                    ["diagnosis", "Diagnosis"],
                    ["requestedTreatment", "Requested/Denied treatment"],
                    ["denialReason", "Denial reason"],
                    ["payerName", "Payer name"],
                    ["memberId", "Member ID"],
                  ].map(([key, label]) => (
                    <label key={key} className="inline-flex items-center gap-2 text-sm text-[#44295f]">
                      <input
                        type="checkbox"
                        checked={workflowPolicy.requiredFieldKeys.includes(
                          key as AdminWorkflowPolicy["requiredFieldKeys"][number],
                        )}
                        onChange={(event) =>
                          setWorkflowPolicy((current) => {
                            if (!current) {
                              return current;
                            }
                            const typedKey = key as AdminWorkflowPolicy["requiredFieldKeys"][number];
                            const next = new Set(current.requiredFieldKeys);
                            if (event.target.checked) {
                              next.add(typedKey);
                            } else {
                              next.delete(typedKey);
                            }
                            return { ...current, requiredFieldKeys: Array.from(next) };
                          })
                        }
                        disabled={workflowPolicyBusy}
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-3">
                {(
                  [
                    ["intakeReady", "Intake ready summary"],
                    ["intakeBlocked", "Intake blocked summary"],
                    ["evidenceReady", "Evidence ready summary"],
                    ["evidencePending", "Evidence pending summary"],
                    ["draftBlocked", "Draft blocked summary"],
                    ["draftComplete", "Draft complete summary"],
                  ] as Array<[keyof AdminWorkflowPolicy["stageSummaries"], string]>
                ).map(([key, label]) => (
                  <label key={key} className="block">
                    <span className="text-xs font-medium text-[#6e588c]">{label}</span>
                    <input
                      value={workflowPolicy.stageSummaries[key]}
                      onChange={(event) =>
                        setWorkflowPolicy((current) =>
                          current
                            ? {
                                ...current,
                                stageSummaries: {
                                  ...current.stageSummaries,
                                  [key]: event.target.value,
                                },
                              }
                            : current,
                        )
                      }
                      className="calm-input mt-1 w-full px-3 py-2 text-sm"
                      disabled={workflowPolicyBusy}
                    />
                  </label>
                ))}
              </div>

              {workflowOrchestration ? (
                <div className="mt-6 rounded-xl border border-[var(--border)] bg-[#fcf9ff] p-4">
                  <p className="text-xs uppercase tracking-wider text-[#7a6298]">n8n Orchestration</p>
                  <p className="mt-1 text-xs text-[#715a90]">Configure open-source n8n batch dispatch in the same AWS environment.</p>
                  <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                    <label className="inline-flex items-center gap-2 text-sm text-[#44295f]">
                      <input
                        type="checkbox"
                        checked={workflowOrchestration.n8nEnabled}
                        onChange={(event) =>
                          setWorkflowOrchestration((current) =>
                            current ? { ...current, n8nEnabled: event.target.checked } : current,
                          )
                        }
                        disabled={workflowOrchestrationBusy}
                      />
                      Enable n8n dispatch
                    </label>
                    <label className="block">
                      <span className="text-xs font-medium text-[#6e588c]">Dispatch mode</span>
                      <select
                        value={workflowOrchestration.dispatchMode}
                        onChange={(event) =>
                          setWorkflowOrchestration((current) =>
                            current
                              ? {
                                  ...current,
                                  dispatchMode: event.target.value as AdminWorkflowOrchestrationPolicy["dispatchMode"],
                                }
                              : current,
                          )
                        }
                        className="calm-input mt-1 w-full px-3 py-2 text-sm"
                        disabled={workflowOrchestrationBusy}
                      >
                        <option value="disabled">Disabled</option>
                        <option value="shadow">Shadow</option>
                        <option value="active">Active</option>
                      </select>
                    </label>
                    <label className="block md:col-span-2">
                      <span className="text-xs font-medium text-[#6e588c]">n8n webhook URL</span>
                      <input
                        value={workflowOrchestration.webhookUrl}
                        onChange={(event) =>
                          setWorkflowOrchestration((current) =>
                            current ? { ...current, webhookUrl: event.target.value } : current,
                          )
                        }
                        className="calm-input mt-1 w-full px-3 py-2 text-sm"
                        placeholder="https://n8n.<domain>/webhook/batch-dispatch"
                        disabled={workflowOrchestrationBusy}
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs font-medium text-[#6e588c]">Webhook timeout (ms)</span>
                      <input
                        type="number"
                        min={1000}
                        max={30000}
                        value={workflowOrchestration.timeoutMs}
                        onChange={(event) =>
                          setWorkflowOrchestration((current) =>
                            current ? { ...current, timeoutMs: Number(event.target.value) } : current,
                          )
                        }
                        className="calm-input mt-1 w-full px-3 py-2 text-sm"
                        disabled={workflowOrchestrationBusy}
                      />
                    </label>
                    <label className="inline-flex items-center gap-2 text-sm text-[#44295f]">
                      <input
                        type="checkbox"
                        checked={workflowOrchestration.redactPhiBeforeDispatch}
                        onChange={(event) =>
                          setWorkflowOrchestration((current) =>
                            current ? { ...current, redactPhiBeforeDispatch: event.target.checked } : current,
                          )
                        }
                        disabled={workflowOrchestrationBusy}
                      />
                      Redact PHI before dispatch
                    </label>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="calm-ghost px-3 py-2 text-sm"
                      onClick={() => void onSaveWorkflowOrchestration()}
                      disabled={workflowOrchestrationBusy}
                    >
                      {workflowOrchestrationBusy ? "Saving..." : "Save orchestration settings"}
                    </button>
                    <button
                      type="button"
                      className="calm-ghost px-3 py-2 text-sm"
                      onClick={() => void onDispatchWorkflowBatch()}
                      disabled={workflowBatchBusy || !selectedOrganizationId}
                    >
                      {workflowBatchBusy ? "Dispatching..." : "Dispatch preview thread batch"}
                    </button>
                  </div>
                </div>
              ) : null}

              <div className="mt-6 rounded-xl border border-[var(--border)] bg-[#fcf9ff] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-xs uppercase tracking-wider text-[#7a6298]">Policy Preview</p>
                    <p className="mt-1 text-xs text-[#715a90]">
                      Validate current blocking behavior against a real case thread in the selected organization.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="calm-ghost px-3 py-1.5 text-xs"
                    onClick={() => setWorkflowPreviewRefreshKey((current) => current + 1)}
                    disabled={workflowPreviewBusy || !selectedOrganizationId}
                  >
                    {workflowPreviewBusy ? "Refreshing..." : "Refresh preview"}
                  </button>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                  <label className="block">
                    <span className="text-xs font-medium text-[#6e588c]">Thread</span>
                    <select
                      value={workflowPreviewThreadId}
                      onChange={(event) => setWorkflowPreviewThreadId(event.target.value)}
                      className="calm-input mt-1 w-full px-3 py-2 text-sm"
                      disabled={workflowPreviewBusy || (workflowPreview?.threads.length ?? 0) === 0}
                    >
                      {(workflowPreview?.threads ?? []).map((thread) => (
                        <option key={thread.id} value={thread.id}>
                          {thread.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="text-xs text-[#715a90]">
                    {workflowPreview?.threads.length ?? 0} thread(s) found in {selectedOrganization?.name ?? "selected org"}
                  </p>
                </div>
                {workflowPreviewError ? (
                  <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{workflowPreviewError}</p>
                ) : null}
                {workflowPreview?.evaluation ? (
                  <div className="mt-3 rounded-lg border border-[var(--border)] bg-white p-3 text-sm text-[#44295f]">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs uppercase tracking-wider text-[#7a6298]">Status</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${
                          workflowPreview.evaluation.status === "blocked"
                            ? "bg-red-100 text-red-700"
                            : workflowPreview.evaluation.status === "pending_context"
                              ? "bg-amber-100 text-amber-800"
                              : "bg-[#f2e8fb] text-[#4a2f6e]"
                        }`}
                      >
                        {workflowPreview.evaluation.status === "pending_context"
                          ? "Pending intake context"
                          : workflowPreview.evaluation.status}
                      </span>
                      <span className="text-xs text-[#715a90]">
                        Last user message: {formatTimestamp(workflowPreview.evaluation.latestUserMessageAt)}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-[#715a90]">
                      {workflowPreview.evaluation.latestUserPreview || "No user message found on selected thread."}
                    </p>
                    <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wider text-[#7a6298]">Required fields</p>
                        <p className="mt-1 text-xs text-[#715a90]">{workflowPreview.evaluation.requiredFields.join(", ") || "None"}</p>
                      </div>
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wider text-[#7a6298]">Missing required</p>
                        <p className="mt-1 text-xs text-[#715a90]">
                          {workflowPreview.evaluation.missingRequired.length > 0
                            ? workflowPreview.evaluation.missingRequired.join(", ")
                            : "None"}
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-[#715a90]">No threads available yet for selected organization.</p>
                )}
              </div>

              <div className="mt-6 rounded-xl border border-[var(--border)] bg-[#fcf9ff] p-4">
                <p className="text-xs uppercase tracking-wider text-[#7a6298]">Recent Batches</p>
                {workflowBatches.length === 0 ? (
                  <p className="mt-2 text-sm text-[#715a90]">No workflow batches for the selected organization.</p>
                ) : (
                  <div className="mt-3 overflow-x-auto">
                    <table className="min-w-full text-left text-xs text-[#44295f]">
                      <thead className="uppercase tracking-wider text-[#7a6298]">
                        <tr>
                          <th className="px-2 py-1">Batch</th>
                          <th className="px-2 py-1">Status</th>
                          <th className="px-2 py-1">Thread</th>
                          <th className="px-2 py-1">Execution</th>
                          <th className="px-2 py-1">Created</th>
                        </tr>
                      </thead>
                      <tbody>
                        {workflowBatches.map((batch) => (
                          <tr key={batch.id} className="border-t border-[var(--border)]">
                            <td className="px-2 py-2 font-mono">{batch.id.slice(0, 8)}</td>
                            <td className="px-2 py-2">{batch.status}</td>
                            <td className="px-2 py-2 font-mono">{batch.threadId ? batch.threadId.slice(0, 8) : "—"}</td>
                            <td className="px-2 py-2 font-mono">{batch.n8nExecutionId ?? "—"}</td>
                            <td className="px-2 py-2">{formatTimestamp(batch.createdAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <button
                type="button"
                className="calm-ghost mt-4 px-3 py-2 text-sm"
                onClick={() => void onSaveWorkflowPolicy()}
                disabled={workflowPolicyBusy}
              >
                {workflowPolicyBusy ? "Saving..." : "Save workflow policy"}
              </button>
            </div>
          ) : null}

          {activeTab === "history" ? (
            <div className="mt-6 space-y-4">
              <div className="rounded-xl border border-[var(--border)] bg-white p-4">
                <p className="text-xs uppercase tracking-wider text-[#7a6298]">View As History</p>
                <div className="mt-3 overflow-x-auto">
                  <table className="min-w-full text-left text-sm text-[#44295f]">
                    <thead className="text-xs uppercase tracking-wider text-[#7a6298]">
                      <tr>
                        <th className="px-2 py-1">Status</th>
                        <th className="px-2 py-1">Organization</th>
                        <th className="px-2 py-1">User</th>
                        <th className="px-2 py-1">Reason</th>
                        <th className="px-2 py-1">Started</th>
                        <th className="px-2 py-1">Ended</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((entry) => (
                        <tr key={entry.sessionId} className="border-t border-[var(--border)]">
                          <td className="px-2 py-2">{entry.status}</td>
                          <td className="px-2 py-2">{entry.targetOrganizationName}</td>
                          <td className="px-2 py-2">{entry.targetUserDisplay}</td>
                          <td className="px-2 py-2">{entry.reason}</td>
                          <td className="px-2 py-2">{formatTimestamp(entry.startedAt)}</td>
                          <td className="px-2 py-2">{formatTimestamp(entry.endedAt)}</td>
                        </tr>
                      ))}
                      {history.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-2 py-3 text-sm text-[#715a90]">
                            No impersonation history yet.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="rounded-xl border border-[var(--border)] bg-white p-4">
                <p className="text-xs uppercase tracking-wider text-[#7a6298]">Admin Action Log</p>
                <div className="mt-3 overflow-x-auto">
                  <table className="min-w-full text-left text-sm text-[#44295f]">
                    <thead className="text-xs uppercase tracking-wider text-[#7a6298]">
                      <tr>
                        <th className="px-2 py-1">Action</th>
                        <th className="px-2 py-1">Organization</th>
                        <th className="px-2 py-1">Target User</th>
                        <th className="px-2 py-1">Actor</th>
                        <th className="px-2 py-1">When</th>
                      </tr>
                    </thead>
                    <tbody>
                      {actionHistory.map((entry) => (
                        <tr key={entry.id} className="border-t border-[var(--border)]">
                          <td className="px-2 py-2">{entry.action}</td>
                          <td className="px-2 py-2">{entry.organizationId ?? "-"}</td>
                          <td className="px-2 py-2">{entry.targetAuthSubject ?? "-"}</td>
                          <td className="px-2 py-2">{entry.actorSubject}</td>
                          <td className="px-2 py-2">{formatTimestamp(entry.createdAt)}</td>
                        </tr>
                      ))}
                      {actionHistory.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-2 py-3 text-sm text-[#715a90]">
                            No admin actions logged yet.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : null}
          </section>
        </div>
      </div>
    </main>
  );
}
