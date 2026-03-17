"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import {
  ApiError,
  getMfaStatus,
  getPasswordResetAction,
  getProfileMe,
  startMfaSetup,
  requestEmailChange,
  type MfaStatus,
  type MfaSetupStart,
  type ProfileMe,
  updateProfileMe,
  verifyMfaSetup,
} from "@/lib/client-api";
import { SettingsSidebar } from "@/components/settings-sidebar";
import { SuperAdminBanner } from "@/components/super-admin-banner";

function buildLoginRedirect(nextPath: string) {
  return `/login?next=${encodeURIComponent(nextPath)}`;
}

type EditableForm = {
  firstName: string;
  lastName: string;
  displayName: string;
  jobTitle: string;
  phoneCountryCode: string;
  phoneLocalNumber: string;
};

const COUNTRY_CODES = [
  { label: "United States (+1)", value: "+1" },
  { label: "Canada (+1)", value: "+1" },
  { label: "United Kingdom (+44)", value: "+44" },
  { label: "Australia (+61)", value: "+61" },
  { label: "Germany (+49)", value: "+49" },
  { label: "France (+33)", value: "+33" },
  { label: "India (+91)", value: "+91" },
  { label: "Japan (+81)", value: "+81" },
];

const JOB_TITLE_OPTIONS = [
  "Physician",
  "Prior Authorization Specialist",
  "Nurse",
  "Practice Administrator",
  "Revenue Cycle Manager",
  "Case Manager",
  "Other",
];

function splitPhoneNumber(rawPhone: string | null): { countryCode: string; localNumber: string } {
  if (!rawPhone) {
    return { countryCode: "+1", localNumber: "" };
  }
  const compact = rawPhone.replace(/[^\d+]/g, "");
  const digitsOnly = compact.replace(/\D/g, "");
  if (!compact.startsWith("+")) {
    return { countryCode: "+1", localNumber: digitsOnly };
  }
  const countryDigits = [...new Set(COUNTRY_CODES.map((entry) => entry.value.slice(1)))].sort(
    (left, right) => right.length - left.length,
  );
  const matched = countryDigits.find((code) => digitsOnly.startsWith(code));
  if (!matched) {
    return { countryCode: "+1", localNumber: digitsOnly };
  }
  return { countryCode: `+${matched}`, localNumber: digitsOnly.slice(matched.length) };
}

function normalizePhoneDigits(value: string): string {
  return value.replace(/\D/g, "");
}

function toE164Phone(countryCode: string, localNumber: string): string | null {
  const digits = normalizePhoneDigits(localNumber);
  if (digits.length === 0) {
    return null;
  }
  const candidate = `${countryCode}${digits}`;
  if (!/^\+[1-9]\d{7,14}$/.test(candidate)) {
    return null;
  }
  return candidate;
}

function normalizeForm(profile: ProfileMe["profile"]): EditableForm {
  const phoneParts = splitPhoneNumber(profile.phone);
  return {
    firstName: profile.firstName ?? "",
    lastName: profile.lastName ?? "",
    displayName: profile.displayName ?? "",
    jobTitle: profile.jobTitle ?? "",
    phoneCountryCode: phoneParts.countryCode,
    phoneLocalNumber: phoneParts.localNumber,
  };
}

export default function ProfilePage() {
  const router = useRouter();
  const [profile, setProfile] = useState<ProfileMe | null>(null);
  const [mfaStatus, setMfaStatus] = useState<MfaStatus | null>(null);
  const [form, setForm] = useState<EditableForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [emailRequest, setEmailRequest] = useState("");
  const [mfaSetup, setMfaSetup] = useState<MfaSetupStart | null>(null);
  const [mfaQrDataUrl, setMfaQrDataUrl] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaBusy, setMfaBusy] = useState<"start" | "verify" | null>(null);
  const [jobTitleSelection, setJobTitleSelection] = useState<string>("");
  const [jobTitleCustom, setJobTitleCustom] = useState("");

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [profileData, mfaData] = await Promise.all([getProfileMe(), getMfaStatus()]);
        if (!mounted) {
          return;
        }
        setProfile(profileData);
        setMfaStatus(mfaData);
        const normalized = normalizeForm(profileData.profile);
        setForm(normalized);
        if (normalized.jobTitle && JOB_TITLE_OPTIONS.includes(normalized.jobTitle)) {
          setJobTitleSelection(normalized.jobTitle);
          setJobTitleCustom("");
        } else if (normalized.jobTitle) {
          setJobTitleSelection("Other");
          setJobTitleCustom(normalized.jobTitle);
        } else {
          setJobTitleSelection("");
          setJobTitleCustom("");
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          router.replace(buildLoginRedirect("/app/profile"));
          return;
        }
        setError(err instanceof Error ? err.message : "Failed to load profile");
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
    async function buildQr() {
      if (!mfaSetup?.otpauthUri) {
        setMfaQrDataUrl(null);
        return;
      }
      try {
        const dataUrl = await QRCode.toDataURL(mfaSetup.otpauthUri, {
          errorCorrectionLevel: "M",
          margin: 1,
          width: 192,
        });
        if (mounted) {
          setMfaQrDataUrl(dataUrl);
        }
      } catch {
        if (mounted) {
          setMfaQrDataUrl(null);
        }
      }
    }
    void buildQr();
    return () => {
      mounted = false;
    };
  }, [mfaSetup]);

  const dirty = useMemo(() => {
    if (!profile || !form) {
      return false;
    }
    const baseline = normalizeForm(profile.profile);
    return JSON.stringify(baseline) !== JSON.stringify(form);
  }, [form, profile]);

  function updateForm<K extends keyof EditableForm>(key: K, value: EditableForm[K]) {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  async function onSaveProfile() {
    if (!form || !profile) {
      return;
    }
    const effectiveJobTitle = jobTitleSelection === "Other" ? jobTitleCustom.trim() : jobTitleSelection.trim();
    if (!effectiveJobTitle) {
      setError("Please select or enter a job title.");
      return;
    }
    const e164Phone = toE164Phone(form.phoneCountryCode, form.phoneLocalNumber);
    if (!e164Phone) {
      setError("Phone must include country code and a valid number.");
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await updateProfileMe({
        firstName: form.firstName,
        lastName: form.lastName,
        displayName: form.displayName,
        jobTitle: effectiveJobTitle,
        phone: e164Phone,
      });
      const refreshed = await getProfileMe();
      setProfile(refreshed);
      const normalized = normalizeForm(refreshed.profile);
      setForm(normalized);
      if (normalized.jobTitle && JOB_TITLE_OPTIONS.includes(normalized.jobTitle)) {
        setJobTitleSelection(normalized.jobTitle);
        setJobTitleCustom("");
      } else if (normalized.jobTitle) {
        setJobTitleSelection("Other");
        setJobTitleCustom(normalized.jobTitle);
      } else {
        setJobTitleSelection("");
        setJobTitleCustom("");
      }
      setMessage("Profile updated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update profile");
    } finally {
      setSaving(false);
    }
  }

  async function onRequestEmailChange() {
    const trimmed = emailRequest.trim();
    if (!trimmed) {
      setError("New email is required.");
      return;
    }
    setError(null);
    setMessage(null);
    try {
      const result = await requestEmailChange(trimmed);
      setMessage(result.duplicate ? "Email change request already open." : "Email change request submitted.");
      setEmailRequest("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit email change request");
    }
  }

  async function onPasswordReset() {
    setError(null);
    setMessage(null);
    try {
      const action = await getPasswordResetAction();
      router.push(action.loginPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to open reset flow");
    }
  }

  async function onStartMfaSetup() {
    setMfaBusy("start");
    setError(null);
    setMessage(null);
    try {
      const data = await startMfaSetup();
      setMfaSetup(data);
      setMfaCode("");
      setMessage("Authenticator setup started. Enter the 6-digit code from your app to verify.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start MFA setup");
    } finally {
      setMfaBusy(null);
    }
  }

  async function onVerifyMfaSetup() {
    if (!mfaSetup) {
      return;
    }
    const code = mfaCode.trim();
    if (!/^\d{6}$/.test(code)) {
      setError("Enter a valid 6-digit authenticator code.");
      return;
    }
    setMfaBusy("verify");
    setError(null);
    setMessage(null);
    try {
      await verifyMfaSetup({ code, session: mfaSetup.session });
      const nextStatus = await getMfaStatus();
      setMfaStatus(nextStatus);
      setMfaSetup(null);
      setMfaCode("");
      setMessage("MFA device verified and enabled.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to verify MFA setup");
    } finally {
      setMfaBusy(null);
    }
  }

  return (
    <main className="mx-auto flex h-[100dvh] min-h-[100dvh] w-full max-w-[1600px] flex-col overflow-hidden px-4 py-5 md:px-6 md:py-6">
      <div className="flex h-full min-h-0 flex-col gap-4">
        <SuperAdminBanner />
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
          <SettingsSidebar active="profile" className="h-full min-h-0 overflow-y-auto" />
          <section className="calm-card h-full min-h-0 overflow-y-auto p-6 md:p-8">
        <h1 className="text-2xl font-semibold tracking-tight text-[#331c4a]">Profile</h1>
        <p className="mt-2 text-sm text-[#6b5588]">Account controls are policy-driven by role, organization type, and organization status.</p>

        {loading ? <p className="mt-4 text-sm text-[#70598f]">Loading profile...</p> : null}
        {error ? <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
        {message ? <p className="mt-4 rounded-xl border border-[#d9cce8] bg-[#f8f3fd] px-3 py-2 text-sm text-[#543673]">{message}</p> : null}

        {profile && form ? (
          <>
            <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-[var(--border)] bg-white p-4">
                <p className="text-xs uppercase tracking-wider text-[#7a6298]">Organization</p>
                <p className="mt-1 text-sm font-medium text-[#3f245c]">{profile.actor.organizationName}</p>
                <p className="mt-1 text-xs text-[#6d578c]">Type: {profile.actor.organizationType}</p>
                <p className="mt-1 text-xs text-[#6d578c]">Status: {profile.actor.organizationStatus}</p>
                <p className="mt-1 text-xs text-[#6d578c]">Role: {profile.actor.role}</p>
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-white p-4">
                <p className="text-xs uppercase tracking-wider text-[#7a6298]">Security</p>
                <p className="mt-1 text-xs text-[#6d578c]">MFA required: Yes (TOTP)</p>
                <p className="mt-1 text-xs text-[#6d578c]">Configured: {mfaStatus?.softwareTokenEnabled ? "Yes" : "No"}</p>
                <p className="mt-1 text-xs text-[#6d578c]">Preferred method: {mfaStatus?.preferredMethod ?? "none"}</p>
                <p className="mt-1 text-xs text-[#6d578c]">MFA in current session: {mfaStatus?.sessionMfaAuthenticated === true ? "Yes" : "Unknown"}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="calm-ghost px-3 py-2 text-sm"
                    onClick={onStartMfaSetup}
                    disabled={mfaBusy !== null || mfaStatus?.manageable === false}
                  >
                    {mfaBusy === "start" ? "Starting..." : "Reset MFA"}
                  </button>
                  <button type="button" className="calm-ghost px-3 py-2 text-sm" onClick={onPasswordReset} disabled={mfaBusy !== null}>
                    Password management
                  </button>
                </div>
                {mfaStatus?.manageable === false && mfaStatus.reason ? (
                  <p className="mt-2 text-xs text-[#6d578c]">{mfaStatus.reason}</p>
                ) : null}
                {mfaSetup ? (
                  <div className="mt-3 rounded-lg border border-[var(--border)] bg-[#fcf9ff] p-3">
                    <p className="text-xs text-[#6d578c]">Scan this QR code with your authenticator app.</p>
                    {mfaQrDataUrl ? (
                      <img
                        src={mfaQrDataUrl}
                        alt="MFA authenticator QR code"
                        className="mt-2 h-48 w-48 rounded-lg border border-[var(--border)] bg-white p-2"
                      />
                    ) : null}
                    <p className="mt-2 text-xs text-[#6d578c]">If scanning is unavailable, enter this setup key manually:</p>
                    <p className="mt-1 break-all rounded bg-white px-2 py-1 font-mono text-xs text-[#3f245c]">{mfaSetup.secretCode}</p>
                    <div className="mt-2 flex items-center gap-2">
                      <input
                        value={mfaCode}
                        onChange={(event) => setMfaCode(event.target.value.replace(/\D+/g, "").slice(0, 6))}
                        className="calm-input w-40 px-3 py-2 text-sm"
                        placeholder="123456"
                        inputMode="numeric"
                      />
                      <button
                        type="button"
                        className="calm-ghost px-3 py-2 text-sm"
                        onClick={onVerifyMfaSetup}
                        disabled={mfaBusy !== null}
                      >
                        {mfaBusy === "verify" ? "Verifying..." : "Verify device"}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="mt-6 rounded-xl border border-[var(--border)] bg-white p-4">
              <h2 className="text-sm font-semibold text-[#41285d]">Personal Details</h2>
              <p className="mt-1 text-xs text-[#6d578c]">Standardized profile fields with validated contact format.</p>
              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                <input
                  value={form.displayName}
                  onChange={(event) => updateForm("displayName", event.target.value)}
                  className="calm-input px-3 py-2 text-sm"
                  placeholder="Preferred display name"
                  disabled={!profile.policy.fields.displayName.editable || saving}
                />
                <input
                  value={form.firstName}
                  onChange={(event) => updateForm("firstName", event.target.value)}
                  className="calm-input px-3 py-2 text-sm"
                  placeholder="First name"
                  disabled={!profile.policy.fields.firstName.editable || saving}
                />
                <input
                  value={form.lastName}
                  onChange={(event) => updateForm("lastName", event.target.value)}
                  className="calm-input px-3 py-2 text-sm"
                  placeholder="Last name"
                  disabled={!profile.policy.fields.lastName.editable || saving}
                />
                <select
                  value={jobTitleSelection}
                  onChange={(event) => {
                    const next = event.target.value;
                    setJobTitleSelection(next);
                    const derived = next === "Other" ? jobTitleCustom.trim() : next;
                    updateForm("jobTitle", derived);
                  }}
                  className="calm-input px-3 py-2 text-sm"
                  disabled={!profile.policy.fields.jobTitle.editable || saving}
                >
                  <option value="">Select job title</option>
                  {JOB_TITLE_OPTIONS.map((jobTitle) => (
                    <option key={jobTitle} value={jobTitle}>
                      {jobTitle}
                    </option>
                  ))}
                </select>
                {jobTitleSelection === "Other" ? (
                  <input
                    value={jobTitleCustom}
                    onChange={(event) => {
                      const next = event.target.value;
                      setJobTitleCustom(next);
                      updateForm("jobTitle", next);
                    }}
                    className="calm-input px-3 py-2 text-sm"
                    placeholder="Enter job title"
                    disabled={!profile.policy.fields.jobTitle.editable || saving}
                  />
                ) : (
                  <div />
                )}
                <div className="grid grid-cols-[180px_1fr] gap-2 md:col-span-2">
                  <select
                    value={form.phoneCountryCode}
                    onChange={(event) => updateForm("phoneCountryCode", event.target.value)}
                    className="calm-input px-3 py-2 text-sm"
                    disabled={!profile.policy.fields.phone.editable || saving}
                  >
                    {COUNTRY_CODES.map((country) => (
                      <option key={`${country.label}-${country.value}`} value={country.value}>
                        {country.label}
                      </option>
                    ))}
                  </select>
                  <input
                    value={form.phoneLocalNumber}
                    onChange={(event) => updateForm("phoneLocalNumber", normalizePhoneDigits(event.target.value))}
                    className="calm-input px-3 py-2 text-sm"
                    placeholder="Phone number"
                    inputMode="tel"
                    disabled={!profile.policy.fields.phone.editable || saving}
                  />
                </div>
                <p className="text-xs text-[#6d578c] md:col-span-2">Saved format: E.164 (example: +14155552671).</p>
              </div>
              <div className="mt-3 flex items-center gap-3">
                <button type="button" className="calm-ghost px-3 py-2 text-sm" disabled={!dirty || saving} onClick={onSaveProfile}>
                  {saving ? "Saving..." : "Save profile"}
                </button>
                {!profile.policy.fields.email.editable && profile.policy.fields.email.reason ? (
                  <p className="text-xs text-[#6d578c]">{profile.policy.fields.email.reason}</p>
                ) : null}
              </div>
            </div>

            <div className="mt-6 rounded-xl border border-[var(--border)] bg-white p-4">
              <h2 className="text-sm font-semibold text-[#41285d]">Email</h2>
              <p className="mt-2 text-sm text-[#6d578c]">Current email: {profile.profile.email ?? "Not set"}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input
                  value={emailRequest}
                  onChange={(event) => setEmailRequest(event.target.value)}
                  className="calm-input min-w-72 flex-1 px-3 py-2 text-sm"
                  placeholder="New email"
                  disabled={!profile.policy.actions.canRequestEmailChange}
                />
                <button
                  type="button"
                  className="calm-ghost px-3 py-2 text-sm"
                  onClick={onRequestEmailChange}
                  disabled={!profile.policy.actions.canRequestEmailChange}
                >
                  Request email change
                </button>
              </div>
              {!profile.policy.actions.canRequestEmailChange && profile.policy.actions.emailChangeReason ? (
                <p className="mt-2 text-xs text-[#6d578c]">{profile.policy.actions.emailChangeReason}</p>
              ) : null}
            </div>

            {profile.actor.role === "org_owner" || profile.actor.role === "org_admin" ? (
              <div className="mt-6 rounded-xl border border-[var(--border)] bg-white p-4 text-sm text-[#6d578c]">
                User management moved to <span className="font-medium text-[#3f245c]">Settings → Users</span>.
              </div>
            ) : null}
          </>
        ) : null}
          </section>
        </div>
      </div>
    </main>
  );
}
