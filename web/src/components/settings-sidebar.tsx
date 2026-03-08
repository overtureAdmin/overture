"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiError, getAdminImpersonationContext, getProfileStatus } from "@/lib/client-api";

type SettingsSidebarProps = {
  active: "profile" | "users" | "llm-settings" | "super-admin";
  className?: string;
};

export function SettingsSidebar({ active, className }: SettingsSidebarProps) {
  const [canManageUsers, setCanManageUsers] = useState(active === "users");
  const [canAccessSuperAdmin, setCanAccessSuperAdmin] = useState(active === "super-admin");

  useEffect(() => {
    let mounted = true;
    async function checkUserManagementAccess() {
      try {
        const status = await getProfileStatus();
        if (!mounted) {
          return;
        }
        setCanManageUsers(status.actor.role === "org_owner" || status.actor.role === "org_admin");
      } catch {
        if (mounted) {
          setCanManageUsers(active === "users");
        }
      }
    }
    void checkUserManagementAccess();
    return () => {
      mounted = false;
    };
  }, [active]);

  useEffect(() => {
    let mounted = true;
    async function checkSuperAdminAccess() {
      try {
        await getAdminImpersonationContext();
        if (mounted) {
          setCanAccessSuperAdmin(true);
        }
      } catch (error) {
        if (!mounted) {
          return;
        }
        if (error instanceof ApiError && error.status === 403) {
          setCanAccessSuperAdmin(active === "super-admin");
          return;
        }
        setCanAccessSuperAdmin(active === "super-admin");
      }
    }
    void checkSuperAdminAccess();
    return () => {
      mounted = false;
    };
  }, [active]);

  return (
    <aside className={`calm-card flex h-full min-h-0 flex-col p-4 ${className ?? ""}`}>
      <p className="px-2 text-xs font-semibold uppercase tracking-wider text-[#7a6298]">Settings</p>
      <nav className="mt-3 space-y-1">
        <Link href="/app" prefetch={false} className="block rounded-lg px-3 py-2 text-sm text-[#44295f] transition hover:bg-[#f8f3fd]">
          Home
        </Link>
        <Link
          href="/app/profile"
          prefetch={false}
          className={`block rounded-lg px-3 py-2 text-sm transition ${
            active === "profile" ? "bg-[#f6effc] text-[#4a2f6e]" : "text-[#44295f] hover:bg-[#f8f3fd]"
          }`}
        >
          Profile
        </Link>
        {canManageUsers ? (
          <Link
            href="/app/users"
            prefetch={false}
            className={`block rounded-lg px-3 py-2 text-sm transition ${
              active === "users" ? "bg-[#f6effc] text-[#4a2f6e]" : "text-[#44295f] hover:bg-[#f8f3fd]"
            }`}
          >
            Users
          </Link>
        ) : null}
        <Link
          href="/app/llm-settings"
          prefetch={false}
          className={`block rounded-lg px-3 py-2 text-sm transition ${
            active === "llm-settings" ? "bg-[#f6effc] text-[#4a2f6e]" : "text-[#44295f] hover:bg-[#f8f3fd]"
          }`}
        >
          LLM Settings
        </Link>
        {canAccessSuperAdmin ? (
          <Link
            href="/app/super-admin"
            prefetch={false}
            className={`block rounded-lg px-3 py-2 text-sm transition ${
              active === "super-admin" ? "bg-[#f6effc] text-[#4a2f6e]" : "text-[#44295f] hover:bg-[#f8f3fd]"
            }`}
          >
            Super Admin
          </Link>
        ) : null}
        <a href="mailto:support@oncologyexecutive.com" className="block rounded-lg px-3 py-2 text-sm text-[#44295f] transition hover:bg-[#f8f3fd]">
          Support
        </a>
      </nav>
      <div className="mt-auto border-t border-[var(--border)] pt-3">
        <a href="/auth/logout?next=%2Flogin" className="block rounded-lg px-3 py-2 text-sm text-[#a23b44] transition hover:bg-[#fdf2f3]">
          Log out
        </a>
      </div>
    </aside>
  );
}
