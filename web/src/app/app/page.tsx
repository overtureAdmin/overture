"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ApiError,
  createThread,
  getAdminImpersonationContext,
  getProfileStatus,
  getThreads,
  sendChatMessage,
  type ThreadSummary,
} from "@/lib/client-api";
import { SuperAdminBanner } from "@/components/super-admin-banner";

type LoadState = "idle" | "loading" | "ready" | "error";
type DiagnosisOption = { code: string; title: string; label: string };
type PayerOption = { id: string; label: string; source: "availity" | "custom"; state?: string | null };
type KeyDateEntry = { id: string; type: string; date: string };

const KEY_DATE_TYPES = [
  "Submission",
  "Initial Denial",
  "Peer to peer",
  "Level 1 Appeal Submission",
  "Level 1 Appeal Denial",
  "Level 2 Submission",
  "Level 2 Denial",
  "IRO Submission",
];

function buildLoginRedirect(nextPath: string) {
  return `/login?next=${encodeURIComponent(nextPath)}`;
}

function formatTimestamp(value: string): string {
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

export default function AppPage() {
  const router = useRouter();
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showSidebarBody, setShowSidebarBody] = useState(true);
  const [searchExpanded, setSearchExpanded] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [visiblePatientCount, setVisiblePatientCount] = useState(8);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createBusy, setCreateBusy] = useState(false);
  const [accessLoading, setAccessLoading] = useState(true);
  const [starterRequest, setStarterRequest] = useState("");
  const starterInputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const addMenuRef = useRef<HTMLDivElement | null>(null);
  const diagnosisMenuRef = useRef<HTMLDivElement | null>(null);
  const payerMenuRef = useRef<HTMLDivElement | null>(null);
  const settingsMenuRef = useRef<HTMLDivElement | null>(null);
  const [selectedSpecialty, setSelectedSpecialty] = useState("");
  const [showFormFill, setShowFormFill] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [specialtyMenuOpen, setSpecialtyMenuOpen] = useState(false);
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
  const [canManageUsers, setCanManageUsers] = useState(false);
  const [canAccessSuperAdmin, setCanAccessSuperAdmin] = useState(false);
  const [patientSalutation, setPatientSalutation] = useState("");
  const [patientFirstName, setPatientFirstName] = useState("");
  const [patientLastName, setPatientLastName] = useState("");
  const [patientDob, setPatientDob] = useState("");
  const [patientSex, setPatientSex] = useState("");
  const [patientMemberId, setPatientMemberId] = useState("");
  const [patientPlan, setPatientPlan] = useState("");
  const [payerOptions, setPayerOptions] = useState<PayerOption[]>([]);
  const [payerMenuOpen, setPayerMenuOpen] = useState(false);
  const [payerLoading, setPayerLoading] = useState(false);
  const [payerDuplicateWarning, setPayerDuplicateWarning] = useState<string | null>(null);
  const [payerSearchError, setPayerSearchError] = useState<string | null>(null);
  const [patientDiagnosis, setPatientDiagnosis] = useState("");
  const [patientTreatment, setPatientTreatment] = useState("");
  const [patientKeyDates, setPatientKeyDates] = useState<KeyDateEntry[]>([]);
  const [diagnosisOptions, setDiagnosisOptions] = useState<DiagnosisOption[]>([]);
  const [selectedDiagnoses, setSelectedDiagnoses] = useState<DiagnosisOption[]>([]);
  const [diagnosisMenuOpen, setDiagnosisMenuOpen] = useState(false);
  const [diagnosisLoading, setDiagnosisLoading] = useState(false);
  const specialtyOptions = [
    "Radiation Oncology",
    "Medical Oncology",
    "Surgical Oncology",
    "Hematology",
    "Gynecologic Oncology",
    "Neuro-Oncology",
    "Pediatric Oncology",
  ];
  const sortedThreads = useMemo(
    () => [...threads].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    [threads],
  );
  const filteredThreads = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    if (!normalizedQuery) {
      return sortedThreads;
    }
    return sortedThreads.filter((thread) => thread.title.toLowerCase().includes(normalizedQuery));
  }, [searchQuery, sortedThreads]);
  const visibleThreads = useMemo(() => filteredThreads.slice(0, visiblePatientCount), [filteredThreads, visiblePatientCount]);
  const canLoadMoreThreads = visiblePatientCount < filteredThreads.length;

  const loadThreads = useCallback(async () => {
    setLoadState("loading");
    setLoadError(null);

    try {
      const nextThreads = await getThreads();
      setThreads(nextThreads);
      setLoadState("ready");
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        router.replace(buildLoginRedirect("/app"));
        return;
      }

      setLoadState("error");
      setLoadError(error instanceof Error ? error.message : "Failed to load threads");
    }
  }, [router]);

  useEffect(() => {
    void loadThreads();
  }, [loadThreads]);

  useEffect(() => {
    let mounted = true;
    async function checkAccess() {
      try {
        const status = await getProfileStatus();
        if (!mounted) {
          return;
        }
        if (status.access.redirectPath) {
          router.replace(status.access.redirectPath);
          return;
        }
        setCanManageUsers(status.actor.role === "org_owner" || status.actor.role === "org_admin");
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          router.replace(buildLoginRedirect("/app"));
          return;
        }
        // Fail closed on transient status errors so users do not bypass onboarding gates.
        router.replace("/onboarding");
        return;
      } finally {
        if (mounted) {
          setAccessLoading(false);
        }
      }
    }
    void checkAccess();
    return () => {
      mounted = false;
    };
  }, [router]);

  useEffect(() => {
    if (!sidebarCollapsed) {
      setShowSidebarBody(true);
      return;
    }
    setSearchExpanded(false);
    setSettingsMenuOpen(false);
    const timeout = window.setTimeout(() => setShowSidebarBody(false), 140);
    return () => window.clearTimeout(timeout);
  }, [sidebarCollapsed]);

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
          setCanAccessSuperAdmin(false);
          return;
        }
        setCanAccessSuperAdmin(false);
      }
    }
    void checkSuperAdminAccess();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    setVisiblePatientCount(8);
  }, [searchQuery]);

  useEffect(() => {
    function onDocumentPointerDown(event: MouseEvent) {
      if (!addMenuRef.current) {
        return;
      }
      if (!addMenuRef.current.contains(event.target as Node)) {
        setAddMenuOpen(false);
        setSpecialtyMenuOpen(false);
      }
      if (diagnosisMenuRef.current && !diagnosisMenuRef.current.contains(event.target as Node)) {
        setDiagnosisMenuOpen(false);
      }
      if (payerMenuRef.current && !payerMenuRef.current.contains(event.target as Node)) {
        setPayerMenuOpen(false);
      }
      if (settingsMenuRef.current && !settingsMenuRef.current.contains(event.target as Node)) {
        setSettingsMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocumentPointerDown);
    return () => document.removeEventListener("mousedown", onDocumentPointerDown);
  }, []);

  useEffect(() => {
    const trimmed = patientDiagnosis.trim();
    if (!showFormFill || trimmed.length < 2) {
      setDiagnosisOptions([]);
      setDiagnosisLoading(false);
      return;
    }

    const controller = new AbortController();
    setDiagnosisLoading(true);

    const timeout = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: trimmed, limit: "12" });
        const response = await fetch(`/api/icd/search?${params.toString()}`, {
          method: "GET",
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`ICD search failed (${response.status})`);
        }
        const payload = (await response.json()) as {
          data?: {
            diagnoses?: DiagnosisOption[];
          };
        };
        const next = payload.data?.diagnoses ?? [];
        setDiagnosisOptions(next);
        setDiagnosisMenuOpen(next.length > 0);
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          setDiagnosisOptions([]);
          setDiagnosisMenuOpen(false);
        }
      } finally {
        setDiagnosisLoading(false);
      }
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
      setDiagnosisLoading(false);
    };
  }, [patientDiagnosis, showFormFill]);

  useEffect(() => {
    const trimmed = patientPlan.trim();
    if (!showFormFill || trimmed.length < 2) {
      setPayerOptions([]);
      setPayerLoading(false);
      setPayerSearchError(null);
      return;
    }

    const controller = new AbortController();
    setPayerLoading(true);

    const timeout = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: trimmed, limit: "10" });
        const response = await fetch(`/api/payers/search?${params.toString()}`, {
          method: "GET",
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) {
          let errorMessage = `Payer search failed (${response.status})`;
          try {
            const payload = (await response.json()) as { error?: string };
            if (payload.error) {
              errorMessage = payload.error;
            }
          } catch {
            // ignore parse failure; preserve status message
          }
          throw new Error(errorMessage);
        }
        const payload = (await response.json()) as {
          data?: {
            payers?: PayerOption[];
          };
        };
        const next = payload.data?.payers ?? [];
        setPayerOptions(next);
        setPayerMenuOpen(next.length > 0);
        setPayerSearchError(null);
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          setPayerOptions([]);
          setPayerMenuOpen(false);
          setPayerSearchError(error instanceof Error ? error.message : "Payer search is unavailable right now.");
        }
      } finally {
        setPayerLoading(false);
      }
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
      setPayerLoading(false);
    };
  }, [patientPlan, showFormFill]);

  const onPatientListScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      if (!canLoadMoreThreads) {
        return;
      }
      const target = event.currentTarget;
      const remainingScroll = target.scrollHeight - target.scrollTop - target.clientHeight;
      if (remainingScroll <= 96) {
        setVisiblePatientCount((current) => Math.min(current + 8, filteredThreads.length));
      }
    },
    [canLoadMoreThreads, filteredThreads.length],
  );

  function buildThreadTitleFromRequest(request: string) {
    const trimmed = request.trim();
    if (trimmed.length === 0) {
      return `New Patient ${new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date())}`;
    }
    return trimmed.replace(/\s+/g, " ").slice(0, 80);
  }

  async function onCreatePatientThread(initialRequest?: string) {
    const requestText = initialRequest?.trim() ?? "";
    const generatedTitle = buildThreadTitleFromRequest(requestText);
    const requestSnapshot = requestText;

    setCreateBusy(true);
    setCreateError(null);

    try {
      const created = await createThread(generatedTitle);
      if (requestSnapshot.length > 0) {
        await sendChatMessage(created.id, requestSnapshot, { mode: "context_only" });
      }
      setThreads((current) => [created, ...current.filter((thread) => thread.id !== created.id)]);
      setStarterRequest("");
      router.push(`/document/${created.id}`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        router.replace(buildLoginRedirect("/app"));
        return;
      }
      setCreateError(error instanceof Error ? error.message : "Failed to create thread");
    } finally {
      setCreateBusy(false);
    }
  }

  function onNewCaseClick() {
    if (createBusy) {
      return;
    }
    setCreateError(null);
    setStarterRequest("");
    setSelectedFiles([]);
    setShowFormFill(false);
    setPatientSalutation("");
    setPatientFirstName("");
    setPatientLastName("");
    setPatientDob("");
    setPatientSex("");
    setPatientMemberId("");
    setPatientPlan("");
    setPayerOptions([]);
    setPayerMenuOpen(false);
    setPayerDuplicateWarning(null);
    setPayerSearchError(null);
    setPatientDiagnosis("");
    setSelectedDiagnoses([]);
    setPatientTreatment("");
    setPatientKeyDates([]);
    setDiagnosisOptions([]);
    setDiagnosisMenuOpen(false);
    setSelectedSpecialty("");
    setAddMenuOpen(false);
    setSpecialtyMenuOpen(false);
    starterInputRef.current?.focus();
  }

  function buildContextEnvelope(diagnosisOverride?: string) {
    const lines: string[] = [];

    if (selectedSpecialty.trim()) {
      lines.push(`Specialty: ${selectedSpecialty.trim()}`);
    }
    const patientName = [patientSalutation, patientFirstName, patientLastName].filter((part) => part.trim()).join(" ");
    if (patientName.trim()) {
      lines.push(`Patient name: ${patientName.trim()}`);
    }
    if (patientDob.trim()) {
      lines.push(`DOB: ${patientDob.trim()}`);
    }
    if (patientSex.trim()) {
      lines.push(`Sex: ${patientSex.trim()}`);
    }
    if (patientMemberId.trim()) {
      lines.push(`Member ID: ${patientMemberId.trim()}`);
    }
    if (patientPlan.trim()) {
      lines.push(`Payer/plan: ${patientPlan.trim()}`);
    }
    const diagnosisText = diagnosisOverride ?? patientDiagnosis.trim();
    if (selectedDiagnoses.length > 0) {
      lines.push(`Diagnosis: ${selectedDiagnoses.map((diagnosis) => diagnosis.label).join("; ")}`);
    } else if (diagnosisText) {
      lines.push(`Diagnosis: ${diagnosisText}`);
    }
    if (patientTreatment.trim()) {
      lines.push(`Primary CPT code requested: ${patientTreatment.trim()}`);
    }
    if (patientKeyDates.length > 0) {
      patientKeyDates.forEach((entry) => {
        if (entry.type.trim() || entry.date.trim()) {
          lines.push(`Key date: ${entry.type || "Unspecified"} - ${entry.date || "Date not set"}`);
        }
      });
    }
    if (selectedFiles.length > 0) {
      lines.push(`Uploaded file names: ${selectedFiles.map((file) => file.name).join(", ")}`);
    }

    return lines;
  }

  function diagnosisLooksLikeIcdLabel(value: string): boolean {
    return /^\s*[A-TV-Z]\d{2}(?:\.\d{1,2})?\b/i.test(value);
  }

  async function resolveDiagnosisToIcdLabel(value: string): Promise<string> {
    const trimmed = value.trim();
    if (trimmed.length < 3 || diagnosisLooksLikeIcdLabel(trimmed)) {
      return trimmed;
    }
    try {
      const params = new URLSearchParams({ q: trimmed, limit: "1" });
      const response = await fetch(`/api/icd/search?${params.toString()}`, {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        return trimmed;
      }
      const payload = (await response.json()) as { data?: { diagnoses?: DiagnosisOption[] } };
      const top = payload.data?.diagnoses?.[0];
      return top?.label?.trim() || trimmed;
    } catch {
      return trimmed;
    }
  }

  async function buildInitialMessage() {
    let resolvedDiagnosis = patientDiagnosis.trim();
    if (selectedDiagnoses.length === 0 && resolvedDiagnosis) {
      resolvedDiagnosis = await resolveDiagnosisToIcdLabel(resolvedDiagnosis);
      if (resolvedDiagnosis && resolvedDiagnosis !== patientDiagnosis.trim()) {
        setPatientDiagnosis(resolvedDiagnosis);
      }
    }
    const request = starterRequest.trim();
    const contextLines = buildContextEnvelope(resolvedDiagnosis);
    if (!request && contextLines.length === 0) {
      return "";
    }
    if (contextLines.length === 0) {
      return request;
    }
    if (!request) {
      return `Context for this case:\n${contextLines.join("\n")}`;
    }
    return `${request}\n\nContext for this case:\n${contextLines.join("\n")}`;
  }

  function onFileInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) {
      return;
    }
    setSelectedFiles((current) => {
      const merged = [...current];
      for (const file of files) {
        if (!merged.some((existing) => existing.name === file.name && existing.size === file.size)) {
          merged.push(file);
        }
      }
      return merged;
    });
    event.currentTarget.value = "";
  }

  function removeSelectedFile(indexToRemove: number) {
    setSelectedFiles((current) => current.filter((_, index) => index !== indexToRemove));
  }

  function addDiagnosis(option: DiagnosisOption) {
    setSelectedDiagnoses((current) => {
      if (current.some((entry) => entry.code === option.code)) {
        return current;
      }
      return [...current, option];
    });
    setPatientDiagnosis("");
    setDiagnosisMenuOpen(false);
  }

  function removeDiagnosis(codeToRemove: string) {
    setSelectedDiagnoses((current) => current.filter((diagnosis) => diagnosis.code !== codeToRemove));
  }

  function normalizePayerValue(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  }

  function payerSimilarityScore(a: string, b: string): number {
    const normalizedA = normalizePayerValue(a);
    const normalizedB = normalizePayerValue(b);
    if (!normalizedA || !normalizedB) {
      return 0;
    }
    if (normalizedA === normalizedB) {
      return 1;
    }
    if (normalizedA.includes(normalizedB) || normalizedB.includes(normalizedA)) {
      return 0.92;
    }
    const tokensA = new Set(normalizedA.split(" "));
    const tokensB = new Set(normalizedB.split(" "));
    let overlap = 0;
    for (const token of tokensA) {
      if (tokensB.has(token)) {
        overlap += 1;
      }
    }
    const denominator = Math.max(tokensA.size, tokensB.size, 1);
    return overlap / denominator;
  }

  function choosePayerOption(option: PayerOption) {
    setPatientPlan(option.label);
    setPayerDuplicateWarning(null);
    setPayerMenuOpen(false);
  }

  function addCustomPayerFromInput() {
    const trimmed = patientPlan.trim();
    if (!trimmed) {
      return;
    }
    const bestMatch = payerOptions
      .map((option) => ({ option, score: payerSimilarityScore(trimmed, option.label) }))
      .sort((a, b) => b.score - a.score)[0];

    if (bestMatch && bestMatch.score >= 0.78) {
      setPayerDuplicateWarning(`Possible duplicate: "${bestMatch.option.label}". Select it or keep your custom value.`);
    } else {
      setPayerDuplicateWarning(null);
    }
    setPayerMenuOpen(false);
  }

  function addKeyDateEntry() {
    setPatientKeyDates((current) => [...current, { id: crypto.randomUUID(), type: "", date: "" }]);
  }

  function updateKeyDateEntry(id: string, updates: Partial<KeyDateEntry>) {
    setPatientKeyDates((current) => current.map((entry) => (entry.id === id ? { ...entry, ...updates } : entry)));
  }

  function removeKeyDateEntry(id: string) {
    setPatientKeyDates((current) => current.filter((entry) => entry.id !== id));
  }

  function onChooseSpecialty(specialty: string) {
    setSelectedSpecialty(specialty);
    setAddMenuOpen(false);
    setSpecialtyMenuOpen(false);
  }

  async function onStarterRequestSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (createBusy) {
      return;
    }
    const initialMessage = await buildInitialMessage();
    if (initialMessage.length === 0) {
      starterInputRef.current?.focus();
      return;
    }
    await onCreatePatientThread(initialMessage);
  }

  async function onStarterRequestKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (createBusy) {
        return;
      }
      const initialMessage = await buildInitialMessage();
      if (initialMessage.length === 0) {
        return;
      }
      await onCreatePatientThread(initialMessage);
    }
  }

  function onSearchClick() {
    if (sidebarCollapsed) {
      setSidebarCollapsed(false);
      setSearchExpanded(true);
      window.setTimeout(() => searchInputRef.current?.focus(), 140);
      return;
    }
    if (searchExpanded) {
      setSearchExpanded(false);
      return;
    }
    setSearchExpanded(true);
    window.setTimeout(() => searchInputRef.current?.focus(), 80);
  }

  const layoutClassName =
    "mx-auto flex h-[100dvh] min-h-[100dvh] w-full max-w-[1600px] flex-col px-4 py-5 md:px-6 md:py-6";
  const workspaceRowClassName = "flex min-h-0 flex-1 flex-col gap-6 pb-4 md:flex-row";
  const asideClassName = sidebarCollapsed
    ? "calm-card-soft flex w-full shrink-0 flex-col overflow-hidden p-4 transition-[width] duration-300 ease-out md:h-full md:w-[68px]"
    : "calm-card-soft flex w-full shrink-0 flex-col overflow-hidden p-4 transition-[width] duration-300 ease-out md:h-full md:w-[324px]";

  if (accessLoading) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-[1600px] items-center justify-center px-6">
        <div className="calm-card-soft w-full max-w-xl p-6 text-center text-sm text-[#70598f]">Loading workspace access...</div>
      </main>
    );
  }

  return (
    <main className={layoutClassName}>
      <SuperAdminBanner className="mb-4 w-full shrink-0" />
      <div className={workspaceRowClassName}>
      <aside className={asideClassName}>
        <div className="flex items-center">
          <button
            type="button"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-lg text-[#5a3c78] transition hover:bg-[#f5effb]"
            aria-label="Toggle case list"
            aria-expanded={!sidebarCollapsed}
            onClick={() => setSidebarCollapsed((current) => !current)}
          >
            ☰
          </button>
          {!sidebarCollapsed ? (
            <div className="relative ml-auto h-9 w-[220px]">
              <div
                className={
                  searchExpanded
                    ? "pointer-events-auto absolute right-0 top-0 flex h-9 w-[220px] items-center rounded-xl border border-[var(--border)] bg-white pl-2 pr-1 opacity-100 transition-all duration-200 ease-out"
                    : "pointer-events-none absolute right-0 top-0 flex h-9 w-9 items-center rounded-xl border border-[var(--border)] bg-white pl-2 pr-1 opacity-0 transition-all duration-200 ease-out"
                }
              >
                <span className="text-base text-[#7b6498]">⌕</span>
                <input
                  id="patient-search-top"
                  ref={searchInputRef}
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search patients"
                  className="ml-2 w-full bg-transparent text-sm text-[#44295f] outline-none placeholder:text-[#8b74a6]"
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      setSearchExpanded(false);
                    }
                  }}
                />
              </div>
              <button
                type="button"
                className="absolute right-0 top-0 inline-flex h-9 w-9 items-center justify-center rounded-lg text-[22px] leading-none text-[#5a3c78] transition hover:bg-[#f5effb]"
                aria-label={searchExpanded ? "Close search" : "Search patients"}
                onClick={onSearchClick}
              >
                ⌕
              </button>
            </div>
          ) : null}
        </div>

        <div className="mt-3">
          <button
            type="button"
            className={
              sidebarCollapsed
                ? "inline-flex h-9 w-9 items-center justify-center rounded-lg text-[#5a3c78] transition hover:bg-[#f5effb]"
                : "inline-flex h-9 items-center rounded-lg pr-3 text-sm font-medium text-[#5a3c78] transition hover:bg-[#f5effb]"
            }
            onClick={onNewCaseClick}
            aria-label="New patient"
            disabled={createBusy}
          >
            <span className="inline-flex h-9 w-9 items-center justify-center">
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4 shrink-0"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M14 3h7v7" />
                <path d="M10 14 21 3" />
                <path d="M21 14v6a1 1 0 0 1-1 1h-16a1 1 0 0 1-1-1v-16a1 1 0 0 1 1-1h6" />
              </svg>
            </span>
            <span
              className={
                sidebarCollapsed
                  ? "w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-150 ease-out"
                  : "w-auto whitespace-nowrap opacity-100 transition-all duration-150 ease-out"
              }
            >
              {createBusy ? "Creating..." : "New Patient"}
            </span>
          </button>
          {createError && !sidebarCollapsed ? <p className="mt-2 text-xs text-[var(--danger)]">{createError}</p> : null}
        </div>

        {showSidebarBody ? (
          <div
            className={
              sidebarCollapsed
                ? "pointer-events-none mt-4 overflow-hidden opacity-0 transition-opacity duration-150 ease-out"
                : "mt-4 flex min-h-0 flex-1 flex-col overflow-hidden opacity-100 transition-opacity duration-150 ease-out"
            }
          >
            <h1 className="mt-4 pl-1 text-lg font-semibold tracking-tight">Patients</h1>

            <div className="mt-5 min-h-0 flex-1 overflow-y-auto pr-1" onScroll={onPatientListScroll}>
              {loadState === "loading" || loadState === "idle" ? (
                <ul className="space-y-2" aria-label="Loading threads">
                  {Array.from({ length: 4 }).map((_, index) => (
                    <li key={index} className="h-16 animate-pulse rounded-2xl border border-[var(--border)] bg-white/80" />
                  ))}
                </ul>
              ) : null}

              {loadState === "error" ? (
                <div className="rounded-2xl border border-red-200 bg-red-50/90 p-3 text-sm text-red-700">
                  <p>{loadError ?? "Failed to load threads."}</p>
                  <button
                    type="button"
                    className="mt-2 rounded-xl border border-red-300 px-2 py-1 text-xs font-medium"
                    onClick={() => void loadThreads()}
                  >
                    Retry
                  </button>
                </div>
              ) : null}

              {loadState === "ready" && sortedThreads.length === 0 ? (
                <div className="rounded-2xl border border-[var(--border)] bg-white p-4 text-sm text-[#664f82]">
                  No patients yet. Start the first case to begin drafting.
                </div>
              ) : null}

              {loadState === "ready" && sortedThreads.length > 0 && filteredThreads.length === 0 ? (
                <div className="rounded-2xl border border-[var(--border)] bg-white p-4 text-sm text-[#664f82]">
                  No cases match "{searchQuery}".
                </div>
              ) : null}

              {loadState === "ready" && visibleThreads.length > 0 ? (
                <ul className="space-y-2">
                  {visibleThreads.map((thread) => (
                    <li key={thread.id}>
                      <button
                        type="button"
                        className="w-full rounded-xl border border-[var(--border)] bg-white/90 p-3 text-left transition hover:border-[#d2c0e5]"
                        onClick={() => router.push(`/document/${thread.id}`)}
                      >
                        <p className="line-clamp-2 text-[13px] font-medium text-[#3a2155]">{thread.title}</p>
                        <p className="mt-1 text-xs text-[#715a90]">Last edit {formatTimestamp(thread.updatedAt)}</p>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="mt-auto border-t border-[var(--border)] pt-3">
          <div className="relative" ref={settingsMenuRef}>
            <button
              type="button"
              className={
                sidebarCollapsed
                  ? "inline-flex h-9 w-9 items-center justify-center rounded-lg text-[#5a3c78] transition hover:bg-[#f5effb]"
                  : "inline-flex h-9 items-center rounded-lg pr-3 text-sm text-[#5a3c78] transition hover:bg-[#f5effb]"
              }
              aria-label="Settings and help"
              aria-expanded={settingsMenuOpen}
              onClick={() => setSettingsMenuOpen((current) => !current)}
            >
              <span className="inline-flex h-9 w-9 items-center justify-center text-[22px] leading-none">⚙</span>
              {!sidebarCollapsed ? <span className="whitespace-nowrap">Settings &amp; Help</span> : null}
            </button>
            {settingsMenuOpen ? (
              <div
                className={
                  sidebarCollapsed
                    ? "absolute bottom-[calc(100%+8px)] left-0 z-30 w-44 rounded-xl border border-[var(--border)] bg-white p-1 shadow-lg"
                    : "absolute bottom-[calc(100%+8px)] left-0 z-30 w-56 rounded-xl border border-[var(--border)] bg-white p-1 shadow-lg"
                }
              >
                <Link href="/app/profile" className="block rounded-lg px-3 py-2 text-sm text-[#44295f] transition hover:bg-[#f8f3fd]">
                  Profile
                </Link>
                {canManageUsers ? (
                  <Link href="/app/users" className="block rounded-lg px-3 py-2 text-sm text-[#44295f] transition hover:bg-[#f8f3fd]">
                    Users
                  </Link>
                ) : null}
                <Link href="/app/llm-settings" className="block rounded-lg px-3 py-2 text-sm text-[#44295f] transition hover:bg-[#f8f3fd]">
                  LLM Settings
                </Link>
                {canAccessSuperAdmin ? (
                  <Link href="/app/super-admin" className="block rounded-lg px-3 py-2 text-sm text-[#44295f] transition hover:bg-[#f8f3fd]">
                    Super Admin
                  </Link>
                ) : null}
                <a
                  href="mailto:support@oncologyexecutive.com"
                  className="block rounded-lg px-3 py-2 text-sm text-[#44295f] transition hover:bg-[#f8f3fd]"
                >
                  Support
                </a>
                <a
                  href="/auth/logout?next=/login"
                  className="block rounded-lg px-3 py-2 text-sm text-[#44295f] transition hover:bg-[#f8f3fd]"
                >
                  Log out
                </a>
              </div>
            ) : null}
          </div>
        </div>
      </aside>

      <section className="calm-card min-h-0 min-w-0 flex-1 overflow-hidden p-6 md:h-full md:p-8">
        <div className="mx-auto flex h-full w-full max-w-3xl flex-col justify-center">
          <h2 className="text-3xl font-semibold tracking-tight text-[#2d1443]">What are we writing today?</h2>
          <p className="mt-2 text-sm leading-relaxed text-[#685285]">
            Start with a free-text request. We&apos;ll create a new patient case and carry your request into the workspace.
          </p>
          <form className="mt-6" onSubmit={(event) => void onStarterRequestSubmit(event)}>
            <div className="rounded-3xl border border-[var(--border)] bg-white p-3 shadow-sm">
              <textarea
                ref={starterInputRef}
                value={starterRequest}
                onChange={(event) => setStarterRequest(event.target.value)}
                onKeyDown={(event) => void onStarterRequestKeyDown(event)}
                placeholder="Type your request, for example: Draft an appeal for head and neck IMRT denial with comparative plan evidence."
                className="min-h-[120px] w-full resize-none bg-transparent px-2 py-2 text-[15px] leading-relaxed text-[#2d1443] outline-none placeholder:text-[#7c989c]"
                disabled={createBusy}
              />
              {showFormFill ? (
                <div className="mb-3 grid gap-2 border-t border-[var(--border)] px-2 pt-3 md:grid-cols-2">
                  <div className="grid grid-cols-[1fr_3fr] gap-2">
                    <select
                      value={patientSalutation}
                      onChange={(event) => setPatientSalutation(event.target.value)}
                      className="h-10 rounded-lg border border-[var(--border)] bg-white px-3 text-sm text-[#2d1443] outline-none focus:border-[#c7b3dc]"
                    >
                      <option value="">Sal.</option>
                      <option value="Mr.">Mr.</option>
                      <option value="Ms.">Ms.</option>
                      <option value="Mrs.">Mrs.</option>
                    </select>
                    <input
                      value={patientFirstName}
                      onChange={(event) => setPatientFirstName(event.target.value)}
                      placeholder="First name"
                      className="h-10 rounded-lg border border-[var(--border)] px-3 text-sm text-[#2d1443] outline-none focus:border-[#c7b3dc]"
                    />
                  </div>
                  <input
                    value={patientLastName}
                    onChange={(event) => setPatientLastName(event.target.value)}
                    placeholder="Last name"
                    className="h-10 rounded-lg border border-[var(--border)] px-3 text-sm text-[#2d1443] outline-none focus:border-[#c7b3dc]"
                  />
                  <input
                    type="date"
                    value={patientDob}
                    onChange={(event) => setPatientDob(event.target.value)}
                    aria-label="DOB"
                    title="DOB"
                    placeholder="mm/dd/yyyy"
                    className="h-10 rounded-lg border border-[var(--border)] px-3 text-sm text-[#2d1443] outline-none focus:border-[#c7b3dc]"
                  />
                  <div className="flex h-10 items-center gap-3 rounded-lg border border-[var(--border)] px-3 text-sm text-[#2d1443]">
                    <span className="text-xs font-medium text-[#6e588c]">Sex</span>
                    <label className="inline-flex items-center gap-1">
                      <input
                        type="radio"
                        name="patient-sex"
                        value="Male"
                        checked={patientSex === "Male"}
                        onChange={(event) => setPatientSex(event.target.value)}
                      />
                      <span>Male</span>
                    </label>
                    <label className="inline-flex items-center gap-1">
                      <input
                        type="radio"
                        name="patient-sex"
                        value="Female"
                        checked={patientSex === "Female"}
                        onChange={(event) => setPatientSex(event.target.value)}
                      />
                      <span>Female</span>
                    </label>
                  </div>
                  <div className="relative" ref={payerMenuRef}>
                    <input
                      value={patientPlan}
                      onChange={(event) => {
                        setPatientPlan(event.target.value);
                        setPayerDuplicateWarning(null);
                        setPayerSearchError(null);
                        setPayerMenuOpen(true);
                      }}
                      onFocus={() => {
                        if (payerOptions.length > 0) {
                          setPayerMenuOpen(true);
                        }
                      }}
                      placeholder="Payer/plan"
                      className="h-10 w-full rounded-lg border border-[var(--border)] px-3 text-sm text-[#2d1443] outline-none focus:border-[#c7b3dc]"
                    />
                    {payerMenuOpen && (payerOptions.length > 0 || payerLoading || patientPlan.trim().length > 1) ? (
                      <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-20 max-h-56 overflow-y-auto rounded-lg border border-[var(--border)] bg-white p-1 shadow-lg">
                        {payerLoading ? <div className="px-2 py-2 text-xs text-[#715a90]">Searching payers...</div> : null}
                        {!payerLoading
                          ? payerOptions.map((option) => (
                              <button
                                key={option.id}
                                type="button"
                                onClick={() => choosePayerOption(option)}
                                className="block w-full rounded-md px-2 py-2 text-left text-xs text-[#533472] transition-colors hover:bg-[#f5effb]"
                              >
                                {option.label}
                                {option.state ? ` (${option.state})` : ""}
                              </button>
                            ))
                          : null}
                        {patientPlan.trim().length > 1 ? (
                          <button
                            type="button"
                            onClick={addCustomPayerFromInput}
                            className="mt-1 block w-full rounded-md border border-dashed border-[var(--border)] px-2 py-2 text-left text-xs text-[#533472] transition-colors hover:bg-[#f5effb]"
                          >
                            Use custom: "{patientPlan.trim()}"
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                    {payerDuplicateWarning ? <p className="mt-1 text-xs text-[#7b5e00]">{payerDuplicateWarning}</p> : null}
                    {payerSearchError ? (
                      <p className="mt-1 text-xs text-[#7b5e00]">
                        Live payer search unavailable. You can still enter a custom payer.
                      </p>
                    ) : null}
                  </div>
                  <input
                    value={patientMemberId}
                    onChange={(event) => setPatientMemberId(event.target.value)}
                    placeholder="Member ID"
                    className="h-10 rounded-lg border border-[var(--border)] px-3 text-sm text-[#2d1443] outline-none focus:border-[#c7b3dc]"
                  />
                  <div className="relative" ref={diagnosisMenuRef}>
                    <input
                      value={patientDiagnosis}
                      onChange={(event) => {
                        setPatientDiagnosis(event.target.value);
                        setDiagnosisMenuOpen(true);
                      }}
                      onFocus={() => {
                        if (diagnosisOptions.length > 0) {
                          setDiagnosisMenuOpen(true);
                        }
                      }}
                      placeholder="Diagnosis (ICD-10)"
                      className="h-10 w-full rounded-lg border border-[var(--border)] px-3 text-sm text-[#2d1443] outline-none focus:border-[#c7b3dc]"
                    />
                    {diagnosisMenuOpen && (diagnosisOptions.length > 0 || diagnosisLoading) ? (
                      <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-20 max-h-52 overflow-y-auto rounded-lg border border-[var(--border)] bg-white p-1 shadow-lg">
                      {diagnosisLoading ? <div className="px-2 py-2 text-xs text-[#715a90]">Searching ICD...</div> : null}
                        {!diagnosisLoading
                          ? diagnosisOptions.map((option) => (
                              <button
                                key={`${option.code}-${option.title}`}
                                type="button"
                                onClick={() => addDiagnosis(option)}
                                className="block w-full rounded-md px-2 py-2 text-left text-xs text-[#533472] transition-colors hover:bg-[#f5effb]"
                              >
                                {option.label}
                              </button>
                            ))
                          : null}
                      </div>
                    ) : null}
                    {selectedDiagnoses.length > 0 ? (
                      <ul className="mt-2 flex flex-wrap gap-1">
                        {selectedDiagnoses.map((diagnosis) => (
                          <li key={diagnosis.code}>
                            <button
                              type="button"
                              onClick={() => removeDiagnosis(diagnosis.code)}
                              className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] px-2 py-1 text-xs text-[#5d3f7b] transition-colors duration-150 hover:bg-[#f5effb]"
                              title="Remove diagnosis"
                            >
                              <span className="max-w-[220px] truncate">{diagnosis.label}</span>
                              <span aria-hidden="true">×</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                  <input
                    value={patientTreatment}
                    onChange={(event) => setPatientTreatment(event.target.value)}
                    placeholder="Primary CPT code requested"
                    className="h-10 rounded-lg border border-[var(--border)] px-3 text-sm text-[#2d1443] outline-none focus:border-[#c7b3dc]"
                  />
                  <div className="md:col-span-2">
                    <button
                      type="button"
                      onClick={addKeyDateEntry}
                      className="inline-flex items-center gap-2 rounded-lg px-2 py-1 text-sm font-medium text-[#5d3f7b] transition-colors duration-150 hover:bg-[#f5effb]"
                    >
                      <span aria-hidden="true">+</span>
                      <span>Add Key date</span>
                    </button>
                    {patientKeyDates.length > 0 ? (
                      <div className="mt-2 space-y-2">
                        {patientKeyDates.map((entry) => (
                          <div key={entry.id} className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] gap-2">
                            <select
                              value={entry.type}
                              onChange={(event) => updateKeyDateEntry(entry.id, { type: event.target.value })}
                              className="h-10 rounded-lg border border-[var(--border)] bg-white px-3 text-sm text-[#2d1443] outline-none focus:border-[#c7b3dc]"
                            >
                              <option value="">Type</option>
                              {KEY_DATE_TYPES.map((typeOption) => (
                                <option key={typeOption} value={typeOption}>
                                  {typeOption}
                                </option>
                              ))}
                            </select>
                            <input
                              type="date"
                              value={entry.date}
                              onChange={(event) => updateKeyDateEntry(entry.id, { date: event.target.value })}
                              className="h-10 rounded-lg border border-[var(--border)] px-3 text-sm text-[#2d1443] outline-none focus:border-[#c7b3dc]"
                            />
                            <button
                              type="button"
                              onClick={() => removeKeyDateEntry(entry.id)}
                              className="h-10 rounded-lg px-3 text-sm text-[#6e588c] transition-colors duration-150 hover:bg-[#f5effb]"
                              aria-label="Remove key date"
                              title="Remove key date"
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
              {selectedFiles.length > 0 ? (
                <ul className="mb-3 flex flex-wrap gap-2 px-2">
                  {selectedFiles.map((file, index) => (
                    <li key={`${file.name}-${file.size}-${index}`}>
                      <button
                        type="button"
                        onClick={() => removeSelectedFile(index)}
                        className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] px-2 py-1 text-xs text-[#5d3f7b] transition-colors duration-150 hover:bg-[#f5effb]"
                        title="Remove file"
                      >
                        <span aria-hidden="true">📄</span>
                        <span className="max-w-[180px] truncate">{file.name}</span>
                        <span aria-hidden="true">×</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="flex items-center justify-between border-t border-[var(--border)] pt-3">
                <div className="flex items-center gap-2" ref={addMenuRef}>
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => {
                        setAddMenuOpen((current) => !current);
                        setSpecialtyMenuOpen(false);
                      }}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-lg text-[#5a3c78] transition-colors duration-150 hover:bg-[#f5effb]"
                      aria-label="Add options"
                      title="Add options"
                    >
                      +
                    </button>
                    {addMenuOpen ? (
                      <div className="absolute bottom-11 left-0 z-20 min-w-[260px] rounded-xl border border-[var(--border)] bg-white p-2 shadow-lg">
                        <div className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-[#715a90]">
                          Add Records &amp; Files
                        </div>
                        <div className="my-1 border-t border-[var(--border)]" />
                        <button
                          type="button"
                          onClick={() => {
                            fileInputRef.current?.click();
                            setAddMenuOpen(false);
                            setSpecialtyMenuOpen(false);
                          }}
                          className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-sm text-[#533472] transition-colors hover:bg-[#f5effb]"
                        >
                          <span>Upload from Computer</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setCreateError("EMR import is coming soon.");
                            setAddMenuOpen(false);
                            setSpecialtyMenuOpen(false);
                          }}
                          className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-sm text-[#533472] transition-colors hover:bg-[#f5effb]"
                        >
                          <span>Add Patient from EMR</span>
                        </button>
                        <div className="relative">
                          <button
                            type="button"
                            onClick={() => setSpecialtyMenuOpen((current) => !current)}
                            className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-sm text-[#533472] transition-colors hover:bg-[#f5effb]"
                          >
                            <span>Add Specialty Knowledge</span>
                            <span aria-hidden="true">›</span>
                          </button>
                          {specialtyMenuOpen ? (
                            <div className="absolute left-[calc(100%+8px)] top-0 z-30 min-w-[220px] rounded-xl border border-[var(--border)] bg-white p-2 shadow-lg">
                              {specialtyOptions.map((specialty) => (
                                <button
                                  key={specialty}
                                  type="button"
                                  onClick={() => onChooseSpecialty(specialty)}
                                  className="block w-full rounded-lg px-2 py-2 text-left text-sm text-[#533472] transition-colors hover:bg-[#f5effb]"
                                >
                                  {specialty}
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
                    multiple
                    className="hidden"
                    onChange={onFileInputChange}
                  />
                  <button
                    type="button"
                    onClick={() => setShowFormFill((current) => !current)}
                    className="inline-flex h-9 items-center rounded-lg px-3 text-xs font-medium text-[#5d3f7b] transition-colors duration-150 hover:bg-[#f5effb]"
                  >
                    Form-fill
                  </button>
                  {selectedSpecialty ? (
                    <div className="inline-flex h-9 items-center gap-2 rounded-full border border-[#9dc8c3] bg-[#e9f7f4] px-3 text-xs font-medium text-[#533472]">
                      <span className="max-w-[220px] truncate">Specialty: {selectedSpecialty}</span>
                      <button
                        type="button"
                        className="text-sm leading-none opacity-80 transition-opacity hover:opacity-100"
                        onClick={() => setSelectedSpecialty("")}
                        aria-label="Clear specialty"
                      >
                        ×
                      </button>
                    </div>
                  ) : null}
                </div>
                <button
                  type="submit"
                  className="calm-cta rounded-lg px-4 py-2 text-sm transition-colors duration-150 hover:bg-[#f5effb]"
                  disabled={createBusy}
                >
                  {createBusy ? "Starting..." : "Start Case"}
                </button>
              </div>
            </div>
          </form>
          {createError ? <p className="mt-3 text-sm text-[var(--danger)]">{createError}</p> : null}
        </div>
      </section>
      </div>
    </main>
  );
}
