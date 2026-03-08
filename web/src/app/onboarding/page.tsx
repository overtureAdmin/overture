"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ApiError,
  acceptBaa,
  acceptTerms,
  completeOnboarding,
  getProfileStatus,
  setupOrganization,
  type ProfileStatus,
} from "@/lib/client-api";

function buildLoginRedirect(nextPath: string) {
  return `/login?next=${encodeURIComponent(nextPath)}`;
}

export default function OnboardingPage() {
  const router = useRouter();
  const [stepParam, setStepParam] = useState<string | null>(null);

  const [status, setStatus] = useState<ProfileStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [legalName, setLegalName] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [phone, setPhone] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [joinInviteCode, setJoinInviteCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [acceptTermsChecked, setAcceptTermsChecked] = useState(false);
  const [acceptBaaChecked, setAcceptBaaChecked] = useState(false);

  async function refreshStatus() {
    setLoading(true);
    setError(null);
    try {
      const next = await getProfileStatus();
      setStatus(next);
      if (next.access.redirectPath) {
        router.replace(next.access.redirectPath);
        return;
      }
      if (next.access.gate === "none") {
        router.replace("/app");
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace(buildLoginRedirect("/onboarding"));
        return;
      }
      setError(err instanceof Error ? err.message : "Failed to load onboarding status");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      setStepParam(params.get("step"));
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const effectiveStep = useMemo(() => {
    if (!status) {
      return stepParam ?? "terms";
    }
    if (status.access.gate === "none") {
      return "done";
    }
    if (status.access.gate === "require_org_selection") {
      return "organization";
    }
    if (status.access.gate === "pending_org_join_approval") {
      return "join-pending";
    }
    if (status.access.gate === "require_terms") {
      return "terms";
    }
    if (status.access.gate === "require_baa") {
      return "baa";
    }
    if (status.access.gate === "require_subscription") {
      return "subscription";
    }
    if (status.access.gate === "pending_enterprise_verification") {
      return "enterprise-pending";
    }
    return stepParam ?? "profile";
  }, [status, stepParam]);

  async function onAcceptTerms(event: FormEvent) {
    event.preventDefault();
    if (!acceptTermsChecked) {
      setError("You must accept the Terms of Use to continue.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await acceptTerms();
      setAcceptTermsChecked(false);
      await refreshStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to accept Terms of Use");
    } finally {
      setBusy(false);
    }
  }

  async function onAcceptBaa(event: FormEvent) {
    event.preventDefault();
    if (!acceptBaaChecked) {
      setError("You must accept the BAA to continue.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await acceptBaa();
      setAcceptBaaChecked(false);
      await refreshStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to accept BAA");
    } finally {
      setBusy(false);
    }
  }

  async function onCreateOrganization(event: FormEvent) {
    event.preventDefault();
    const name = organizationName.trim();
    if (!name) {
      setError("Organization name is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await setupOrganization({ action: "create", organizationName: name });
      await refreshStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create organization");
    } finally {
      setBusy(false);
    }
  }

  async function onCompleteProfile(event: FormEvent) {
    event.preventDefault();
    const legal = legalName.trim();
    if (!legal) {
      setError("Legal name is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await completeOnboarding({
        legalName: legal,
        jobTitle: jobTitle.trim(),
        phone: phone.trim(),
        organizationName: organizationName.trim(),
      });
      await refreshStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to complete onboarding");
    } finally {
      setBusy(false);
    }
  }

  async function onJoinOrganization(event: FormEvent) {
    event.preventDefault();
    const code = joinInviteCode.trim();
    if (!code) {
      setError("Invite code is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await setupOrganization({
        action: "join",
        inviteCode: code,
      });
      setMessage("Join request submitted. Awaiting organization approval.");
      setJoinInviteCode("");
      await refreshStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit join request");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto grid min-h-screen w-full max-w-4xl grid-cols-1 items-start gap-6 px-6 py-10">
      <section className="calm-card-soft p-6 md:p-8">
        <h1 className="text-3xl font-semibold tracking-tight text-[#331c4a]">Account Setup</h1>
        <p className="mt-2 text-sm text-[#695386]">
          Complete legal and billing setup before using the workspace. MFA is required and enforced by identity policy.
        </p>
      </section>

      <section className="calm-card p-6 md:p-8">
        {loading ? <p className="text-sm text-[#70598f]">Loading onboarding status...</p> : null}
        {error ? <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
        {message ? <p className="rounded-xl border border-[#d9cce8] bg-[#f8f3fd] px-3 py-2 text-sm text-[#543673]">{message}</p> : null}

        {!loading && effectiveStep === "organization" ? (
          <div className="space-y-3">
            <h2 className="text-xl font-semibold text-[#331c4a]">Organization Setup</h2>
            <p className="text-sm text-[#695386]">
              Every account must belong to an organization. Create your organization or join with an invite code.
            </p>
            <form className="space-y-2 rounded-xl border border-[var(--border)] p-3" onSubmit={onCreateOrganization}>
              <h3 className="text-sm font-semibold text-[#3d2359]">Create organization (org owner)</h3>
              <input
                value={organizationName}
                onChange={(event) => setOrganizationName(event.target.value)}
                className="calm-input w-full px-3 py-2 text-sm"
                placeholder="Organization name"
              />
              <button type="submit" className="calm-primary px-3 py-2 text-sm" disabled={busy}>
                {busy ? "Creating..." : "Create organization"}
              </button>
            </form>
            <form className="space-y-2 rounded-xl border border-[var(--border)] p-3" onSubmit={onJoinOrganization}>
              <h3 className="text-sm font-semibold text-[#3d2359]">Join organization (invite code)</h3>
              <input
                value={joinInviteCode}
                onChange={(event) => setJoinInviteCode(event.target.value)}
                className="calm-input w-full px-3 py-2 text-sm uppercase"
                placeholder="UHT-XXXXXXXX"
              />
              <button type="submit" className="calm-ghost px-3 py-2 text-sm" disabled={busy}>
                {busy ? "Submitting..." : "Request access"}
              </button>
            </form>
          </div>
        ) : null}

        {!loading && effectiveStep === "join-pending" ? (
          <div className="space-y-2">
            <h2 className="text-xl font-semibold text-[#331c4a]">Join Request Pending</h2>
            <p className="text-sm text-[#695386]">
              Your organization join request is waiting for an organization admin to approve access.
            </p>
          </div>
        ) : null}

        {!loading && effectiveStep === "terms" ? (
          <form className="space-y-3" onSubmit={onAcceptTerms}>
            <h2 className="text-xl font-semibold text-[#331c4a]">Terms of Use</h2>
            <p className="text-sm text-[#695386]">Review and accept the Terms of Use for Overture before continuing.</p>
            <div className="max-h-72 overflow-y-auto rounded-xl border border-[var(--border)] bg-white p-4 text-xs leading-5 text-[#573978]">
              <p className="font-semibold">Overture Terms of Use (Canned Draft)</p>
              <p className="mt-2">This service is for authorized healthcare workflow support only. You agree to use it lawfully and in accordance with organization policies and applicable regulations.</p>
              <p className="mt-2">You are responsible for account security and safeguarding credentials. You must promptly report unauthorized access and may not misuse, disrupt, or reverse engineer the service.</p>
              <p className="mt-2">Generated content is assistive and must be reviewed by qualified professionals before clinical, legal, billing, or operational use. Overture does not provide legal advice or medical care.</p>
              <p className="mt-2">You represent that your use complies with payer requirements and all applicable privacy and security obligations adopted by your organization.</p>
              <p className="mt-2">Subscription and service terms may be updated with notice. Overture may suspend access for policy violations, security risk, or non-payment.</p>
              <p className="mt-2">To the maximum extent permitted by law, the service is provided "as is" without warranties. Liability is limited to fees paid in the prior 12 months, except for willful misconduct or non-waivable rights.</p>
            </div>
            <label className="flex items-start gap-2 text-sm text-[#5a3d79]">
              <input type="checkbox" checked={acceptTermsChecked} onChange={(event) => setAcceptTermsChecked(event.target.checked)} className="mt-1" />
              <span>I have read and agree to the Terms of Use.</span>
            </label>
            <button type="submit" className="calm-primary px-4 py-2 text-sm" disabled={busy}>
              {busy ? "Submitting..." : "Accept Terms"}
            </button>
          </form>
        ) : null}

        {!loading && effectiveStep === "baa" ? (
          <form className="space-y-3" onSubmit={onAcceptBaa}>
            <h2 className="text-xl font-semibold text-[#331c4a]">Business Associate Agreement</h2>
            <p className="text-sm text-[#695386]">Accept the BAA to proceed. Acceptance is recorded with signer identity and timestamp.</p>
            <div className="max-h-72 overflow-y-auto rounded-xl border border-[var(--border)] bg-white p-4 text-xs leading-5 text-[#573978]">
              <p className="font-semibold">Overture Business Associate Agreement (Canned Draft)</p>
              <p className="mt-2">This BAA governs permitted and required uses and disclosures of Protected Health Information (PHI) by Overture as Business Associate on behalf of your organization.</p>
              <p className="mt-2">Overture will implement administrative, technical, and physical safeguards to protect PHI and prevent unauthorized use or disclosure.</p>
              <p className="mt-2">Overture will report known security incidents and breaches without unreasonable delay and cooperate on mitigation and required notifications.</p>
              <p className="mt-2">Overture will bind subcontractors handling PHI to substantially similar privacy and security obligations.</p>
              <p className="mt-2">Upon termination, Overture will return or destroy PHI where feasible, or continue protections where return/destruction is infeasible.</p>
              <p className="mt-2">By accepting, you represent you are authorized to bind your organization to this BAA version and related service terms.</p>
            </div>
            <label className="flex items-start gap-2 text-sm text-[#5a3d79]">
              <input type="checkbox" checked={acceptBaaChecked} onChange={(event) => setAcceptBaaChecked(event.target.checked)} className="mt-1" />
              <span>I have read and accept the Business Associate Agreement.</span>
            </label>
            <button type="submit" className="calm-primary px-4 py-2 text-sm" disabled={busy}>
              {busy ? "Submitting..." : "Accept BAA"}
            </button>
          </form>
        ) : null}

        {!loading && effectiveStep === "subscription" ? (
          <div className="space-y-2">
            <h2 className="text-xl font-semibold text-[#331c4a]">Subscription Required</h2>
            <p className="text-sm text-[#695386]">
              Your organization does not have an active subscription. Contact your organization admin or support.
            </p>
          </div>
        ) : null}

        {!loading && effectiveStep === "profile" ? (
          <form className="space-y-3" onSubmit={onCompleteProfile}>
            <h2 className="text-xl font-semibold text-[#331c4a]">Profile Wizard</h2>
            <p className="text-sm text-[#695386]">Add your key details to finish setup.</p>
            <input
              value={legalName}
              onChange={(event) => setLegalName(event.target.value)}
              className="calm-input w-full px-3 py-2 text-sm"
              placeholder="Legal full name"
            />
            <input
              value={jobTitle}
              onChange={(event) => setJobTitle(event.target.value)}
              className="calm-input w-full px-3 py-2 text-sm"
              placeholder="Role / title"
            />
            <input
              value={organizationName}
              onChange={(event) => setOrganizationName(event.target.value)}
              className="calm-input w-full px-3 py-2 text-sm"
              placeholder="Organization display name"
            />
            <input
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              className="calm-input w-full px-3 py-2 text-sm"
              placeholder="Phone"
            />
            <button type="submit" className="calm-primary px-4 py-2 text-sm" disabled={busy}>
              {busy ? "Saving..." : "Complete Setup"}
            </button>
          </form>
        ) : null}

        {!loading && effectiveStep === "enterprise-pending" ? (
          <div className="space-y-2">
            <h2 className="text-xl font-semibold text-[#331c4a]">Enterprise Verification Pending</h2>
            <p className="text-sm text-[#695386]">
              Your organization is pending verification. Contact sales to finalize enterprise activation.
            </p>
            <a className="calm-ghost inline-flex px-3 py-2 text-sm" href="mailto:support@oncologyexecutive.com?subject=Enterprise%20verification">
              Contact Sales
            </a>
          </div>
        ) : null}
      </section>
    </main>
  );
}
