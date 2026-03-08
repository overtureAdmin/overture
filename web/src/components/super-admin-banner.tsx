"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ApiError,
  getAdminImpersonationContext,
  listAdminImpersonationUsers,
  startAdminImpersonation,
  stopAdminImpersonation,
  type SuperAdminContext,
  type SuperAdminUser,
} from "@/lib/client-api";

type SuperAdminBannerProps = {
  className?: string;
};

function formatTargetUser(user: SuperAdminUser): string {
  return user.displayName ?? user.email ?? user.authSubject;
}

export function SuperAdminBanner({ className = "" }: SuperAdminBannerProps) {
  const [context, setContext] = useState<SuperAdminContext | null>(null);
  const [users, setUsers] = useState<SuperAdminUser[]>([]);
  const [selectedOrganizationId, setSelectedOrganizationId] = useState("");
  const [selectedAuthSubject, setSelectedAuthSubject] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedOrganization = useMemo(
    () => context?.organizations.find((org) => org.id === selectedOrganizationId) ?? null,
    [context?.organizations, selectedOrganizationId],
  );

  async function refreshContext() {
    const next = await getAdminImpersonationContext();
    setContext(next);
    const nextOrg = next.activeSession?.targetOrganizationId ?? next.organizations[0]?.id ?? "";
    setSelectedOrganizationId(nextOrg);
  }

  useEffect(() => {
    let mounted = true;
    async function load() {
      setError(null);
      try {
        const next = await getAdminImpersonationContext();
        if (!mounted) {
          return;
        }
        setContext(next);
        const nextOrg = next.activeSession?.targetOrganizationId ?? next.organizations[0]?.id ?? "";
        setSelectedOrganizationId(nextOrg);
      } catch (cause) {
        if (cause instanceof ApiError && cause.status === 403) {
          setContext(null);
          return;
        }
        if (mounted) {
          setError(cause instanceof Error ? cause.message : "Failed to load super admin context.");
        }
      }
    }
    void load();
    return () => {
      mounted = false;
    };
  }, []);

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
        const preferredSubject =
          context?.activeSession?.targetOrganizationId === selectedOrganizationId
            ? context.activeSession.targetAuthSubject
            : nextUsers[0]?.authSubject ?? "";
        setSelectedAuthSubject((current) => (current && nextUsers.some((user) => user.authSubject === current) ? current : preferredSubject));
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

  async function onApplyViewAs() {
    if (!selectedOrganizationId || !selectedAuthSubject) {
      setError("Select both organization and user.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await startAdminImpersonation({
        targetOrganizationId: selectedOrganizationId,
        targetAuthSubject: selectedAuthSubject,
        reason: "Quick switch from super-admin banner",
      });
      await refreshContext();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to switch impersonation session.");
    } finally {
      setBusy(false);
    }
  }

  async function onStopViewAs() {
    setBusy(true);
    setError(null);
    try {
      await stopAdminImpersonation();
      await refreshContext();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to stop impersonation session.");
    } finally {
      setBusy(false);
    }
  }

  if (!context) {
    return null;
  }

  return (
    <section className={`rounded-2xl border border-[#d2bee8] bg-[#f8f2ff] p-3 text-[#4a2f6e] shadow-sm ${className}`.trim()}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider">Super Admin</p>
          <p className="mt-1 text-sm">
            {context.activeSession
              ? `Viewing as ${context.activeSession.targetOrganizationName} / ${context.activeSession.targetUserDisplay}`
              : "No active view-as session."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={selectedOrganizationId}
            onChange={(event) => setSelectedOrganizationId(event.target.value)}
            className="rounded-lg border border-[#cdb8e4] bg-white px-2 py-1 text-sm text-[#3b2158] outline-none"
            disabled={busy}
          >
            <option value="">Select org</option>
            {context.organizations.map((organization) => (
              <option key={organization.id} value={organization.id}>
                {organization.name}
              </option>
            ))}
          </select>
          <select
            value={selectedAuthSubject}
            onChange={(event) => setSelectedAuthSubject(event.target.value)}
            className="rounded-lg border border-[#cdb8e4] bg-white px-2 py-1 text-sm text-[#3b2158] outline-none"
            disabled={busy || !selectedOrganizationId}
          >
            <option value="">Select user</option>
            {users.map((user) => (
              <option key={user.authSubject} value={user.authSubject}>
                {formatTargetUser(user)}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void onApplyViewAs()}
            className="rounded-lg bg-[#6d24a2] px-3 py-1 text-sm font-medium text-white transition hover:bg-[#5a108a] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={busy || !selectedOrganizationId || !selectedAuthSubject}
          >
            {busy ? "Applying..." : "Apply View As"}
          </button>
          {context.activeSession ? (
            <button
              type="button"
              onClick={() => void onStopViewAs()}
              className="rounded-lg border border-[#c5aedf] bg-white px-3 py-1 text-sm font-medium text-[#4a2f6e] transition hover:bg-[#f0e8fb] disabled:cursor-not-allowed disabled:opacity-60"
              disabled={busy}
            >
              Stop
            </button>
          ) : null}
        </div>
      </div>
      {selectedOrganization ? (
        <p className="mt-2 text-xs text-[#6e588c]">
          Org type: {selectedOrganization.accountType} · Status: {selectedOrganization.status} · Active users: {selectedOrganization.activeUsers}
        </p>
      ) : null}
      {error ? <p className="mt-2 text-xs text-[#a73726]">{error}</p> : null}
    </section>
  );
}
