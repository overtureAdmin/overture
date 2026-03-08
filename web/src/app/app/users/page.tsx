"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ApiError,
  inviteOrganizationUser,
  listOrganizationUsers,
  type OrganizationEmailInvite,
  type OrganizationUser,
  type ProfileStatus,
  getProfileStatus,
} from "@/lib/client-api";
import { SettingsSidebar } from "@/components/settings-sidebar";
import { SuperAdminBanner } from "@/components/super-admin-banner";

function buildLoginRedirect(nextPath: string) {
  return `/login?next=${encodeURIComponent(nextPath)}`;
}

export default function UsersPage() {
  const router = useRouter();
  const [profileStatus, setProfileStatus] = useState<ProfileStatus | null>(null);
  const [users, setUsers] = useState<OrganizationUser[]>([]);
  const [invites, setInvites] = useState<OrganizationEmailInvite[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"org_owner" | "org_admin" | "case_contributor" | "reviewer" | "read_only">("case_contributor");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const canManageUsers = profileStatus?.actor.role === "org_owner" || profileStatus?.actor.role === "org_admin";

  async function loadUsersPage() {
    const [status, data] = await Promise.all([getProfileStatus(), listOrganizationUsers()]);
    setProfileStatus(status);
    setUsers(data.users);
    setInvites(data.invites);
  }

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        await loadUsersPage();
      } catch (cause) {
        if (!mounted) {
          return;
        }
        if (cause instanceof ApiError && cause.status === 401) {
          router.replace(buildLoginRedirect("/app/users"));
          return;
        }
        setError(cause instanceof Error ? cause.message : "Failed to load users.");
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

  async function onInviteUser() {
    const email = inviteEmail.trim();
    if (!email) {
      setError("Email is required.");
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const result = await inviteOrganizationUser({ email, role: inviteRole });
      await loadUsersPage();
      setInviteEmail("");
      setMessage(result.delivery.message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to send invite.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="mx-auto h-screen w-full max-w-[1400px] overflow-hidden px-6 py-8">
      <div className="flex h-full min-h-0 flex-col gap-4">
        <SuperAdminBanner />
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
          <SettingsSidebar active="users" className="h-full min-h-0 overflow-y-auto" />
          <section className="calm-card h-full min-h-0 overflow-y-auto p-6 md:p-8">
            <h1 className="text-2xl font-semibold tracking-tight text-[#331c4a]">Users</h1>
            <p className="mt-2 text-sm text-[#6b5588]">Invite and manage organization members.</p>
            {loading ? <p className="mt-4 text-sm text-[#70598f]">Loading users...</p> : null}
            {error ? <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
            {message ? <p className="mt-4 rounded-xl border border-[#d9cce8] bg-[#f8f3fd] px-3 py-2 text-sm text-[#543673]">{message}</p> : null}

            {!loading && !canManageUsers ? (
              <div className="mt-6 rounded-xl border border-[var(--border)] bg-white p-4 text-sm text-[#715a90]">
                User management is available to organization owners and admins only.
              </div>
            ) : null}

            {!loading && canManageUsers ? (
              <>
                <div className="mt-6 rounded-xl border border-[var(--border)] bg-white p-4">
                  <h2 className="text-sm font-semibold text-[#41285d]">Invite User</h2>
                  <p className="mt-1 text-xs text-[#6d578c]">
                    Send an invite by email. The user receives Cognito login instructions and will complete password + MFA setup.
                  </p>
                  <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-[1fr_220px_auto]">
                    <input
                      value={inviteEmail}
                      onChange={(event) => setInviteEmail(event.target.value)}
                      className="calm-input px-3 py-2 text-sm"
                      placeholder="name@organization.com"
                      type="email"
                      disabled={saving}
                    />
                    <select
                      value={inviteRole}
                      onChange={(event) =>
                        setInviteRole(event.target.value as "org_owner" | "org_admin" | "case_contributor" | "reviewer" | "read_only")
                      }
                      className="calm-input px-3 py-2 text-sm"
                      disabled={saving}
                    >
                      <option value="org_admin">org_admin</option>
                      <option value="case_contributor">case_contributor</option>
                      <option value="reviewer">reviewer</option>
                      <option value="read_only">read_only</option>
                      <option value="org_owner">org_owner</option>
                    </select>
                    <button type="button" className="calm-ghost px-3 py-2 text-sm" onClick={() => void onInviteUser()} disabled={saving}>
                      {saving ? "Sending..." : "Send invite"}
                    </button>
                  </div>
                </div>

                <div className="mt-6 rounded-xl border border-[var(--border)] bg-white p-4">
                  <h2 className="text-sm font-semibold text-[#41285d]">Organization Members</h2>
                  <div className="mt-3 overflow-x-auto">
                    <table className="min-w-full text-left text-sm text-[#44295f]">
                      <thead className="text-xs uppercase tracking-wider text-[#7a6298]">
                        <tr>
                          <th className="px-2 py-1">User</th>
                          <th className="px-2 py-1">Role</th>
                          <th className="px-2 py-1">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {users.map((user) => (
                          <tr key={user.authSubject} className="border-t border-[var(--border)]">
                            <td className="px-2 py-2">{user.displayName ?? user.email ?? user.authSubject}</td>
                            <td className="px-2 py-2">{user.role}</td>
                            <td className="px-2 py-2">{user.status}</td>
                          </tr>
                        ))}
                        {users.length === 0 ? (
                          <tr>
                            <td colSpan={3} className="px-2 py-3 text-sm text-[#715a90]">
                              No organization users found.
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="mt-6 rounded-xl border border-[var(--border)] bg-white p-4">
                  <h2 className="text-sm font-semibold text-[#41285d]">Recent Invites</h2>
                  <div className="mt-3 overflow-x-auto">
                    <table className="min-w-full text-left text-sm text-[#44295f]">
                      <thead className="text-xs uppercase tracking-wider text-[#7a6298]">
                        <tr>
                          <th className="px-2 py-1">Email</th>
                          <th className="px-2 py-1">Role</th>
                          <th className="px-2 py-1">Status</th>
                          <th className="px-2 py-1">Expires</th>
                        </tr>
                      </thead>
                      <tbody>
                        {invites.map((invite) => (
                          <tr key={invite.id} className="border-t border-[var(--border)]">
                            <td className="px-2 py-2">{invite.email}</td>
                            <td className="px-2 py-2">{invite.role}</td>
                            <td className="px-2 py-2">{invite.status}</td>
                            <td className="px-2 py-2">{new Date(invite.expiresAt).toLocaleDateString()}</td>
                          </tr>
                        ))}
                        {invites.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="px-2 py-3 text-sm text-[#715a90]">
                              No invites sent yet.
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            ) : null}
          </section>
        </div>
      </div>
    </main>
  );
}
