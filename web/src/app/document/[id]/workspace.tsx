"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ApiError,
  type DocumentDetail,
  type DocumentKind,
  type DocumentSummary,
  type ExportRecord,
  type ThreadMessage,
  type ThreadSummary,
  type ThreadWorkflowStage,
  generateDocument,
  getDocumentExportStatus,
  getDocumentDetail,
  getAdminImpersonationContext,
  getProfileStatus,
  getThreads,
  getThreadDocuments,
  getThreadMessages,
  getThreadWorkflow,
  processExports,
  requestDocumentExport,
  reviseDocument,
  sendChatMessage,
} from "@/lib/client-api";
import { SuperAdminBanner } from "@/components/super-admin-banner";
import {
  buildSmartPromptAddendum,
  buildWorkspaceIntelligence,
  emptyIntakeModel,
  inferIntakeFromText,
  mergeIntakeWithInference,
  type IntakeFieldKey,
  type IntakeModel,
} from "@/lib/workspace-intelligence";
import {
  createInitialPilotMetrics,
  getDraftTimeSeconds,
  withDerivedFollowUpCount,
  withFirstDraftReady,
  withFirstDraftRequested,
  withSatisfaction,
  type PilotMetrics,
} from "@/lib/pilot-metrics";

type WorkspaceProps = {
  threadId: string;
  initialDocumentId?: string | null;
};

type ThreadLoadState = "idle" | "loading" | "ready" | "error";
type DiagnosisOption = { code: string; title: string; label: string };
type PayerOption = { id: string; label: string; source: "availity" | "custom"; state?: string | null };

type WorkspaceSnapshot = {
  messages: ThreadMessage[];
  selectedDocumentId: string | null;
  selectedDocument: DocumentDetail | null;
  label: string;
};

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

function kindLabel(kind: DocumentKind): string {
  if (kind === "lmn") {
    return "LMN";
  }
  if (kind === "p2p") {
    return "P2P";
  }
  return "Appeal";
}

function triggerDownload(url: string) {
  const link = document.createElement("a");
  link.href = url;
  link.rel = "noreferrer";
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function parseMissingRequiredFromError(error: unknown): string[] {
  if (!(error instanceof ApiError) || error.status !== 422) {
    return [];
  }
  const marker = "MISSING_REQUIRED::";
  const index = error.message.indexOf(marker);
  if (index < 0) {
    return [];
  }
  return error.message
    .slice(index + marker.length)
    .split("|")
    .map((value) => value.trim())
    .filter(Boolean);
}

function intakeFieldLabel(field: IntakeFieldKey): string {
  const labels: Record<IntakeFieldKey, string> = {
    patientName: "Patient Name",
    dob: "DOB",
    sex: "Sex",
    diagnosis: "Diagnosis",
    requestedTreatment: "Requested/Denied Treatment",
    denialReason: "Denial Reason",
    payerName: "Payer/Insurance",
    memberId: "Member ID",
    planType: "Plan Type (ERISA/other)",
    jurisdiction: "Jurisdiction/State",
    appealDates: "Appeal-Level Dates",
  };
  return labels[field];
}

function workflowStageLabel(stageKey: ThreadWorkflowStage["stageKey"]): string {
  if (stageKey === "intake_review") {
    return "Intake Review";
  }
  if (stageKey === "evidence_plan") {
    return "Evidence Plan";
  }
  return "Draft Plan";
}

function workflowStageStatusClass(status: ThreadWorkflowStage["status"]): string {
  if (status === "complete") {
    return "bg-emerald-100 text-emerald-800";
  }
  if (status === "ready") {
    return "bg-cyan-100 text-cyan-800";
  }
  if (status === "blocked") {
    return "bg-rose-100 text-rose-700";
  }
  return "bg-amber-100 text-amber-800";
}

function hasIntakeChanged(previous: IntakeModel, next: IntakeModel): boolean {
  return (Object.keys(previous) as IntakeFieldKey[]).some((key) => previous[key] !== next[key]);
}

const OPERATION_STEPS = [
  "Understanding intake context",
  "Checking policy, legal, and evidence expectations",
  "Drafting with Bedrock",
  "Finalizing workspace updates",
];

const ORG_LOGO_STORAGE_KEY = "overture-org-default-logo";
const CASE_LOGO_STORAGE_PREFIX = "overture-case-logo-";
const PILOT_METRICS_STORAGE_PREFIX = "overture-pilot-metrics-";

function caseLogoStorageKey(threadId: string): string {
  return `${CASE_LOGO_STORAGE_PREFIX}${threadId}`;
}

function pilotMetricsStorageKey(threadId: string): string {
  return `${PILOT_METRICS_STORAGE_PREFIX}${threadId}`;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read image file."));
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsDataURL(file);
  });
}

type DocumentUpdateMeta = {
  documentId: string;
  label: string;
  action: "created" | "revised" | "updated";
  href: string;
};

type ChecklistBlockedMeta = {
  missingItems: string[];
};

const DOCUMENT_UPDATE_TOKEN = /\[\[DOCUMENT_UPDATE\|([^|\]]+)\|([^|\]]+)\|([^|\]]+)\|([^\]]+)]]/;
const CHECKLIST_BLOCKED_TOKEN = /\[\[CHECKLIST_BLOCKED\|([^\]]+)]]/;

function parseAssistantMessage(content: string): {
  text: string;
  rawText: string;
  update: DocumentUpdateMeta | null;
  checklistBlocked: ChecklistBlockedMeta | null;
  collapsedLegacyDraft: boolean;
} {
  const updateMatch = content.match(DOCUMENT_UPDATE_TOKEN);
  const checklistMatch = content.match(CHECKLIST_BLOCKED_TOKEN);
  const rawText = content.replace(DOCUMENT_UPDATE_TOKEN, "").replace(CHECKLIST_BLOCKED_TOKEN, "").trim();

  let update: DocumentUpdateMeta | null = null;
  if (updateMatch) {
    const [, documentId, label, actionRaw, href] = updateMatch;
    const normalizedAction = actionRaw === "created" || actionRaw === "revised" ? actionRaw : "updated";
    update = {
      documentId,
      label,
      action: normalizedAction,
      href,
    };
  }

  let checklistBlocked: ChecklistBlockedMeta | null = null;
  if (checklistMatch) {
    checklistBlocked = {
      missingItems: checklistMatch[1]
        .split("|")
        .map((value) => value.trim())
        .filter(Boolean),
    };
  }

  const collapsedLegacyDraft = !update && rawText.length > 500 && /(?:subject:|dear\s|\bappeal\b)/i.test(rawText);
  const text = collapsedLegacyDraft
    ? "Draft content is in the Document Canvas. Use document update cards and version selection to review full text."
    : rawText;

  return { text, rawText, update, checklistBlocked, collapsedLegacyDraft };
}

export default function DocumentWorkspace({ threadId, initialDocumentId = null }: WorkspaceProps) {
  const router = useRouter();
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const settingsMenuRef = useRef<HTMLDivElement | null>(null);
  const diagnosisMenuRef = useRef<HTMLDivElement | null>(null);
  const payerMenuRef = useRef<HTMLDivElement | null>(null);

  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [workflowStages, setWorkflowStages] = useState<ThreadWorkflowStage[]>([]);
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [selectedDocument, setSelectedDocument] = useState<DocumentDetail | null>(null);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [threadsLoadState, setThreadsLoadState] = useState<ThreadLoadState>("idle");
  const [threadsLoadError, setThreadsLoadError] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showSidebarBody, setShowSidebarBody] = useState(true);
  const [searchExpanded, setSearchExpanded] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [visiblePatientCount, setVisiblePatientCount] = useState(8);
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
  const [canManageUsers, setCanManageUsers] = useState(false);
  const [canAccessSuperAdmin, setCanAccessSuperAdmin] = useState(false);
  const [rightPanelTab, setRightPanelTab] = useState<"chat" | "details">("chat");
  const [accessLoading, setAccessLoading] = useState(true);

  const [initialLoading, setInitialLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [documentLoading, setDocumentLoading] = useState(false);

  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

  const [generateKind, setGenerateKind] = useState<DocumentKind>("appeal");
  const [generateBusy, setGenerateBusy] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [missingRequiredForGenerate, setMissingRequiredForGenerate] = useState<string[]>([]);

  const [reviseBusy, setReviseBusy] = useState(false);
  const [reviseError, setReviseError] = useState<string | null>(null);
  const [revertBusy, setRevertBusy] = useState(false);
  const [revertError, setRevertError] = useState<string | null>(null);
  const [revertTargetDocumentId, setRevertTargetDocumentId] = useState<string>("");

  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportRecord, setExportRecord] = useState<ExportRecord | null>(null);

  const [operationStep, setOperationStep] = useState(0);

  const [intake, setIntake] = useState<IntakeModel>(() => emptyIntakeModel());
  const [diagnosisOptions, setDiagnosisOptions] = useState<DiagnosisOption[]>([]);
  const [diagnosisMenuOpen, setDiagnosisMenuOpen] = useState(false);
  const [diagnosisLoading, setDiagnosisLoading] = useState(false);
  const [payerOptions, setPayerOptions] = useState<PayerOption[]>([]);
  const [payerMenuOpen, setPayerMenuOpen] = useState(false);
  const [payerLoading, setPayerLoading] = useState(false);
  const [undoStack, setUndoStack] = useState<WorkspaceSnapshot[]>([]);
  const [orgDefaultLogo, setOrgDefaultLogo] = useState<string | null>(null);
  const [caseLogoOverride, setCaseLogoOverride] = useState<string | null>(null);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [pilotMetrics, setPilotMetrics] = useState<PilotMetrics | null>(null);
  const [satisfactionNotesInput, setSatisfactionNotesInput] = useState("");
  const [metricsMessage, setMetricsMessage] = useState<string | null>(null);
  const previousDocumentCountRef = useRef(0);

  const documentsById = useMemo(() => new Map(documents.map((doc) => [doc.id, doc])), [documents]);

  const combinedContext = useMemo(() => {
    const messageText = messages.map((message) => message.content).join("\n");
    return [messageText, selectedDocument?.content ?? ""].filter(Boolean).join("\n");
  }, [messages, selectedDocument?.content]);

  const inferredIntake = useMemo(() => inferIntakeFromText(combinedContext), [combinedContext]);

  useEffect(() => {
    setIntake((current) => {
      const merged = mergeIntakeWithInference(current, inferredIntake);
      return hasIntakeChanged(current, merged) ? merged : current;
    });
  }, [inferredIntake]);

  const intelligence = useMemo(
    () =>
      buildWorkspaceIntelligence({
        intake,
        combinedContext,
        documentContent: selectedDocument?.content ?? "",
      }),
    [combinedContext, intake, selectedDocument?.content],
  );

  const versionOptions = useMemo(() => {
    if (!selectedDocument) {
      return documents;
    }
    return documents.filter((document) => document.kind === selectedDocument.kind);
  }, [documents, selectedDocument]);
  const activeLogo = caseLogoOverride ?? orgDefaultLogo;
  const draftTimeSeconds = pilotMetrics ? getDraftTimeSeconds(pilotMetrics) : null;
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

  useEffect(() => {
    if (!versionOptions.length) {
      setRevertTargetDocumentId("");
      return;
    }

    if (!revertTargetDocumentId || !versionOptions.some((doc) => doc.id === revertTargetDocumentId)) {
      const fallback = versionOptions.find((doc) => doc.id !== selectedDocumentId)?.id ?? versionOptions[0]?.id ?? "";
      setRevertTargetDocumentId(fallback);
    }
  }, [revertTargetDocumentId, selectedDocumentId, versionOptions]);

  const isBusy = chatBusy || generateBusy || reviseBusy || revertBusy || exportBusy;

  useEffect(() => {
    if (!isBusy) {
      setOperationStep(0);
      return;
    }

    const interval = window.setInterval(() => {
      setOperationStep((current) => (current + 1) % OPERATION_STEPS.length);
    }, 1800);

    return () => window.clearInterval(interval);
  }, [isBusy]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      const storedOrgLogo = window.localStorage.getItem(ORG_LOGO_STORAGE_KEY);
      setOrgDefaultLogo(storedOrgLogo || null);

      const storedCaseLogo = window.localStorage.getItem(caseLogoStorageKey(threadId));
      setCaseLogoOverride(storedCaseLogo || null);

      const storedMetrics = window.localStorage.getItem(pilotMetricsStorageKey(threadId));
      if (storedMetrics) {
        const parsed = JSON.parse(storedMetrics) as PilotMetrics;
        setPilotMetrics(parsed);
        setSatisfactionNotesInput(parsed.satisfactionNotes);
      } else {
        const nowIso = new Date().toISOString();
        setPilotMetrics(createInitialPilotMetrics(threadId, nowIso));
      }
    } catch {
      setLogoError("Unable to restore saved logo settings.");
      const nowIso = new Date().toISOString();
      setPilotMetrics(createInitialPilotMetrics(threadId, nowIso));
    }
  }, [threadId]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (orgDefaultLogo) {
      window.localStorage.setItem(ORG_LOGO_STORAGE_KEY, orgDefaultLogo);
    } else {
      window.localStorage.removeItem(ORG_LOGO_STORAGE_KEY);
    }
  }, [orgDefaultLogo]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const storageKey = caseLogoStorageKey(threadId);
    if (caseLogoOverride) {
      window.localStorage.setItem(storageKey, caseLogoOverride);
    } else {
      window.localStorage.removeItem(storageKey);
    }
  }, [caseLogoOverride, threadId]);

  useEffect(() => {
    if (typeof window === "undefined" || !pilotMetrics) {
      return;
    }
    window.localStorage.setItem(pilotMetricsStorageKey(threadId), JSON.stringify(pilotMetrics));
  }, [pilotMetrics, threadId]);

  useEffect(() => {
    if (!pilotMetrics) {
      return;
    }
    const nowIso = new Date().toISOString();
    setPilotMetrics((current) => {
      if (!current) {
        return current;
      }
      return withDerivedFollowUpCount(current, messages, nowIso);
    });
  }, [messages, pilotMetrics?.firstDraftReadyAt]);

  useEffect(() => {
    if (!pilotMetrics) {
      previousDocumentCountRef.current = documents.length;
      return;
    }

    const previousCount = previousDocumentCountRef.current;
    if (previousCount === 0 && documents.length > 0) {
      const nowIso = new Date().toISOString();
      setPilotMetrics((current) => (current ? withFirstDraftReady(current, nowIso) : current));
    }
    previousDocumentCountRef.current = documents.length;
  }, [documents.length, pilotMetrics]);

  useEffect(() => {
    if (!metricsMessage) {
      return;
    }
    const timeout = window.setTimeout(() => setMetricsMessage(null), 2500);
    return () => window.clearTimeout(timeout);
  }, [metricsMessage]);

  const handleAuthAwareError = useCallback(
    (error: unknown, fallbackMessage: string): string => {
      if (error instanceof ApiError && error.status === 401) {
        router.replace(buildLoginRedirect(`/document/${threadId}`));
        return "Redirecting to login...";
      }
      if (error instanceof Error) {
        return error.message;
      }
      return fallbackMessage;
    },
    [router, threadId],
  );

  const pushUndoSnapshot = useCallback(
    (label: string) => {
      const snapshot: WorkspaceSnapshot = {
        messages,
        selectedDocumentId,
        selectedDocument,
        label,
      };
      setUndoStack((current) => [snapshot, ...current].slice(0, 20));
    },
    [messages, selectedDocument, selectedDocumentId],
  );

  const handleUndo = useCallback(() => {
    setUndoStack((current) => {
      const [latest, ...rest] = current;
      if (!latest) {
        return current;
      }
      setMessages(latest.messages);
      setSelectedDocumentId(latest.selectedDocumentId);
      setSelectedDocument(latest.selectedDocument);
      return rest;
    });
  }, []);

  const selectDocument = useCallback(
    async (documentId: string | null) => {
      setSelectedDocumentId(documentId);
      setExportRecord(null);
      setExportError(null);
      if (!documentId) {
        setSelectedDocument(null);
        return;
      }

      setDocumentLoading(true);
      try {
        const detail = await getDocumentDetail(documentId);
        setSelectedDocument(detail);
      } catch (error) {
        setLoadError(handleAuthAwareError(error, "Failed to load document detail"));
      } finally {
        setDocumentLoading(false);
      }
    },
    [handleAuthAwareError],
  );

  const refreshDocuments = useCallback(
    async (preferredDocumentId?: string) => {
      const nextDocuments = await getThreadDocuments(threadId);
      setDocuments(nextDocuments);

      const nextSelectedId = preferredDocumentId ?? nextDocuments[0]?.id ?? null;
      await selectDocument(nextSelectedId);
    },
    [selectDocument, threadId],
  );

  const openDocumentFromChat = useCallback(
    async (documentId: string) => {
      try {
        if (documentsById.has(documentId)) {
          await selectDocument(documentId);
          return;
        }
        await refreshDocuments(documentId);
      } catch (error) {
        setChatError(handleAuthAwareError(error, "Failed to open document version"));
      }
    },
    [documentsById, handleAuthAwareError, refreshDocuments, selectDocument],
  );

  const hydrateWorkspace = useCallback(async () => {
    setInitialLoading(true);
    setLoadError(null);

    try {
      const [initialMessages, initialDocuments, initialWorkflowStages] = await Promise.all([
        getThreadMessages(threadId),
        getThreadDocuments(threadId),
        getThreadWorkflow(threadId),
      ]);
      setMessages(initialMessages);
      setDocuments(initialDocuments);
      setWorkflowStages(initialWorkflowStages);

      const preferredDocumentId =
        (initialDocumentId && initialDocuments.some((document) => document.id === initialDocumentId) ? initialDocumentId : null) ??
        initialDocuments[0]?.id ??
        null;
      setSelectedDocumentId(preferredDocumentId);

      if (preferredDocumentId) {
        const detail = await getDocumentDetail(preferredDocumentId);
        setSelectedDocument(detail);
      } else {
        setSelectedDocument(null);
      }
    } catch (error) {
      setLoadError(handleAuthAwareError(error, "Failed to load workspace"));
    } finally {
      setInitialLoading(false);
    }
  }, [handleAuthAwareError, initialDocumentId, threadId]);

  useEffect(() => {
    void hydrateWorkspace();
  }, [hydrateWorkspace]);

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
          router.replace(buildLoginRedirect(`/document/${threadId}`));
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
  }, [router, threadId]);

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

  const loadThreads = useCallback(async () => {
    setThreadsLoadState("loading");
    setThreadsLoadError(null);
    try {
      const nextThreads = await getThreads();
      setThreads(nextThreads);
      setThreadsLoadState("ready");
    } catch (error) {
      setThreadsLoadState("error");
      setThreadsLoadError(handleAuthAwareError(error, "Failed to load threads"));
    }
  }, [handleAuthAwareError]);

  const refreshMessages = useCallback(async () => {
    const nextMessages = await getThreadMessages(threadId);
    setMessages(nextMessages);
  }, [threadId]);

  const refreshWorkflowStages = useCallback(async () => {
    const nextStages = await getThreadWorkflow(threadId);
    setWorkflowStages(nextStages);
  }, [threadId]);

  useEffect(() => {
    void loadThreads();
  }, [loadThreads]);

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
    function onDocumentPointerDown(event: MouseEvent) {
      if (settingsMenuRef.current && !settingsMenuRef.current.contains(event.target as Node)) {
        setSettingsMenuOpen(false);
      }
      if (diagnosisMenuRef.current && !diagnosisMenuRef.current.contains(event.target as Node)) {
        setDiagnosisMenuOpen(false);
      }
      if (payerMenuRef.current && !payerMenuRef.current.contains(event.target as Node)) {
        setPayerMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocumentPointerDown);
    return () => document.removeEventListener("mousedown", onDocumentPointerDown);
  }, []);

  useEffect(() => {
    const trimmed = intake.diagnosis.trim();
    if (trimmed.length < 2) {
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
  }, [intake.diagnosis]);

  useEffect(() => {
    const trimmed = intake.payerName.trim();
    if (trimmed.length < 2) {
      setPayerOptions([]);
      setPayerLoading(false);
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
          throw new Error(`Payer search failed (${response.status})`);
        }
        const payload = (await response.json()) as {
          data?: {
            payers?: PayerOption[];
          };
        };
        const next = payload.data?.payers ?? [];
        setPayerOptions(next);
        setPayerMenuOpen(next.length > 0);
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          setPayerOptions([]);
          setPayerMenuOpen(false);
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
  }, [intake.payerName]);

  useEffect(() => {
    setVisiblePatientCount(8);
  }, [searchQuery]);

  useEffect(() => {
    if (!selectedDocument || !exportRecord) {
      return;
    }
    if (exportRecord.status !== "queued" && exportRecord.status !== "processing") {
      return;
    }

    const interval = window.setInterval(() => {
      void (async () => {
        try {
          await processExports(1);
          const latest = await getDocumentExportStatus(selectedDocument.id, exportRecord.exportId);
          setExportRecord(latest);
        } catch (error) {
          setExportError(handleAuthAwareError(error, "Failed to refresh export status"));
        }
      })();
    }, 3000);

    return () => window.clearInterval(interval);
  }, [exportRecord, handleAuthAwareError, selectedDocument]);

  async function onLogoUpload(event: ChangeEvent<HTMLInputElement>, mode: "org-default" | "case-override") {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) {
      return;
    }

    setLogoError(null);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      if (!dataUrl.startsWith("data:image/")) {
        setLogoError("Logo upload must be an image file.");
        return;
      }
      if (mode === "org-default") {
        setOrgDefaultLogo(dataUrl);
      } else {
        setCaseLogoOverride(dataUrl);
      }
    } catch (error) {
      setLogoError(error instanceof Error ? error.message : "Failed to upload logo.");
    } finally {
      input.value = "";
    }
  }

  function onSetSatisfaction(score: number) {
    if (!pilotMetrics) {
      return;
    }
    const nowIso = new Date().toISOString();
    setPilotMetrics(withSatisfaction(pilotMetrics, score, satisfactionNotesInput.trim(), nowIso));
    setMetricsMessage("Satisfaction score saved.");
  }

  function onSaveSatisfactionNotes() {
    if (!pilotMetrics) {
      return;
    }
    const nowIso = new Date().toISOString();
    setPilotMetrics(withSatisfaction(pilotMetrics, pilotMetrics.satisfactionScore, satisfactionNotesInput.trim(), nowIso));
    setMetricsMessage("Satisfaction notes saved.");
  }

  async function onChatSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = chatInput.trim();
    if (!content) {
      setChatError("Message content is required.");
      return;
    }

    setChatBusy(true);
    setChatError(null);
    setGenerateError(null);
    setReviseError(null);

    try {
      const addendum = buildSmartPromptAddendum(intelligence);
      const promptWithRules = `${content}\n\n${addendum}`;
      await sendChatMessage(threadId, promptWithRules, { mode: "context_only" });

      let opFailed = false;
      if (!selectedDocument) {
        setGenerateBusy(true);
        setMissingRequiredForGenerate([]);
        setPilotMetrics((current) => {
          if (!current) {
            return current;
          }
          return withFirstDraftRequested(current, new Date().toISOString());
        });
        try {
          const result = await generateDocument(threadId, generateKind, promptWithRules, { allowIncomplete: false });
          await refreshDocuments(result.documentId);
        } catch (error) {
          opFailed = true;
          const missingRequired = parseMissingRequiredFromError(error);
          if (missingRequired.length > 0) {
            setMissingRequiredForGenerate(missingRequired);
            setGenerateError("Required checklist items are missing. Complete them in Details or send them in chat.");
          } else {
            const resolved = handleAuthAwareError(error, "Failed to generate document");
            setGenerateError(resolved);
            setChatError(resolved);
          }
        } finally {
          setGenerateBusy(false);
        }
      } else {
        setReviseBusy(true);
        try {
          const result = await reviseDocument(selectedDocument.id, promptWithRules);
          await refreshDocuments(result.documentId);
        } catch (error) {
          opFailed = true;
          const resolved = handleAuthAwareError(error, "Failed to revise document");
          setReviseError(resolved);
          setChatError(resolved);
        } finally {
          setReviseBusy(false);
        }
      }
      await refreshMessages();
      await refreshWorkflowStages();
      if (!opFailed) {
        setChatInput("");
      }
    } catch (error) {
      setChatError(handleAuthAwareError(error, "Failed to send message"));
    } finally {
      setChatBusy(false);
    }
  }

  async function onRevertVersion() {
    if (!selectedDocument) {
      setRevertError("Select a current document first.");
      return;
    }

    if (!revertTargetDocumentId || revertTargetDocumentId === selectedDocument.id) {
      setRevertError("Choose a prior version to revert.");
      return;
    }

    setRevertBusy(true);
    setRevertError(null);
    pushUndoSnapshot("revert");

    try {
      const target = await getDocumentDetail(revertTargetDocumentId);
      const targetSummary = documentsById.get(revertTargetDocumentId);

      const revertPrompt = [
        "Revert this draft so the output closely matches the provided prior version.",
        "Retain concise, compliant language and trusted-citation policy.",
        "Target prior version content:",
        target.content,
      ].join("\n\n");

      const result = await reviseDocument(selectedDocument.id, revertPrompt);
      await refreshDocuments(result.documentId);
      await refreshMessages();
      await refreshWorkflowStages();
    } catch (error) {
      setRevertError(handleAuthAwareError(error, "Failed to revert version"));
    } finally {
      setRevertBusy(false);
    }
  }

  async function onRequestExport(format: "pdf" | "docx") {
    if (!selectedDocument) {
      setExportError("Select a document before requesting export.");
      return;
    }

    setExportBusy(true);
    setExportError(null);

    try {
      const documentId = selectedDocument.id;
      const queued = await requestDocumentExport(documentId, format);
      let latest = await getDocumentExportStatus(documentId, queued.exportId);
      setExportRecord(latest);

      for (let i = 0; i < 15 && (latest.status === "queued" || latest.status === "processing"); i += 1) {
        await processExports(1);
        await new Promise((resolve) => window.setTimeout(resolve, 900));
        latest = await getDocumentExportStatus(documentId, queued.exportId);
        setExportRecord(latest);
      }

      if (latest.status === "completed" && latest.downloadUrl) {
        triggerDownload(latest.downloadUrl);
      } else if (latest.status === "failed") {
        throw new Error(latest.errorMessage ?? "Export failed.");
      } else {
        throw new Error("Export is taking longer than expected. Retry in a few seconds.");
      }
    } catch (error) {
      setExportError(handleAuthAwareError(error, "Failed to queue export"));
    } finally {
      setExportBusy(false);
    }
  }

  async function onForceGenerate() {
    const userPrompt = chatInput.trim();
    const promptWithRules = `${userPrompt || "Continue improving this appeal draft."}\n\n${buildSmartPromptAddendum(intelligence)}`;

    setGenerateBusy(true);
    setGenerateError(null);
    try {
      const result = await generateDocument(threadId, generateKind, promptWithRules, { allowIncomplete: true });
      setMissingRequiredForGenerate([]);
      await refreshDocuments(result.documentId);
      await refreshMessages();
      await refreshWorkflowStages();
    } catch (error) {
      setGenerateError(handleAuthAwareError(error, "Failed to force generate document"));
    } finally {
      setGenerateBusy(false);
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

  function chooseDiagnosisOption(option: DiagnosisOption) {
    setIntake((current) => ({ ...current, diagnosis: option.label }));
    setDiagnosisMenuOpen(false);
  }

  function choosePayerOption(option: PayerOption) {
    setIntake((current) => ({ ...current, payerName: option.label }));
    setPayerMenuOpen(false);
  }

  if (initialLoading || accessLoading) {
    return (
      <main className="mx-auto grid min-h-screen w-full max-w-[1600px] grid-cols-1 gap-4 px-4 py-5 lg:grid-cols-[350px_1fr_360px]">
        <div className="calm-card-soft h-96 animate-pulse" />
        <div className="calm-card h-96 animate-pulse" />
        <div className="calm-card-soft h-96 animate-pulse" />
      </main>
    );
  }

  if (loadError) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center px-6">
        <h1 className="text-2xl font-semibold">Document Workspace</h1>
        <p className="mt-3 text-sm text-[var(--danger)]">{loadError}</p>
        <div className="mt-4 flex gap-2">
          <button type="button" className="calm-ghost px-3 py-2 text-sm" onClick={() => void hydrateWorkspace()}>
            Retry
          </button>
          <button type="button" className="calm-primary px-3 py-2 text-sm" onClick={() => router.push("/app")}>
            Back to Cases
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex h-[100dvh] min-h-[100dvh] w-full max-w-[1600px] flex-col px-4 py-5 md:px-6 md:py-6">
      <SuperAdminBanner className="mb-4 w-full shrink-0" />
      <div className="flex min-h-0 flex-1 flex-col gap-6 pb-4 md:flex-row">
      <aside
        className={
          sidebarCollapsed
            ? "calm-card-soft flex w-full shrink-0 flex-col overflow-hidden p-4 transition-[width] duration-300 ease-out md:h-full md:w-[68px]"
            : "calm-card-soft flex w-full shrink-0 flex-col overflow-hidden p-4 transition-[width] duration-300 ease-out md:h-full md:w-[324px]"
        }
      >
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
            onClick={() => router.push("/app")}
            aria-label="New patient"
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
              New Patient
            </span>
          </button>
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
              {threadsLoadState === "loading" || threadsLoadState === "idle" ? (
                <ul className="space-y-2" aria-label="Loading threads">
                  {Array.from({ length: 4 }).map((_, index) => (
                    <li key={index} className="h-16 animate-pulse rounded-2xl border border-[var(--border)] bg-white/80" />
                  ))}
                </ul>
              ) : null}
              {threadsLoadState === "error" ? (
                <div className="rounded-2xl border border-red-200 bg-red-50/90 p-3 text-sm text-red-700">
                  <p>{threadsLoadError ?? "Failed to load threads."}</p>
                  <button
                    type="button"
                    className="mt-2 rounded-xl border border-red-300 px-2 py-1 text-xs font-medium"
                    onClick={() => void loadThreads()}
                  >
                    Retry
                  </button>
                </div>
              ) : null}
              {threadsLoadState === "ready" && visibleThreads.length > 0 ? (
                <ul className="space-y-2">
                  {visibleThreads.map((thread) => (
                    <li key={thread.id}>
                      <button
                        type="button"
                        className={
                          thread.id === threadId
                            ? "w-full rounded-xl border border-[#cfbce3] bg-[#f8f3fd] p-3 text-left"
                            : "w-full rounded-xl border border-[var(--border)] bg-white/90 p-3 text-left transition hover:border-[#d2c0e5]"
                        }
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

      <section className="calm-card flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden p-6 md:h-full md:p-8">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-[#331c4a]">Document Canvas</h1>
            <p className="mt-1 text-xs text-[#725b90]">Editable draft content with version-safe updates.</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex items-center gap-1 rounded-xl border border-[var(--border)] bg-[var(--surface-alt)] px-2 py-1.5">
              <span className="px-1 text-xs font-medium uppercase tracking-wide text-[#6e588d]">Export:</span>
              <button
                type="button"
                onClick={() => void onRequestExport("pdf")}
                className="rounded-md px-2 py-1 text-sm font-medium text-[#5a3c78] transition hover:bg-[#f5effb] hover:text-[#4a2f6e] disabled:cursor-not-allowed disabled:opacity-50"
                disabled={exportBusy || !selectedDocument}
              >
                PDF
              </button>
              <button
                type="button"
                onClick={() => void onRequestExport("docx")}
                className="rounded-md px-2 py-1 text-sm font-medium text-[#5a3c78] transition hover:bg-[#f5effb] hover:text-[#4a2f6e] disabled:cursor-not-allowed disabled:opacity-50"
                disabled={exportBusy || !selectedDocument}
              >
                Word
              </button>
            </div>
            <button
              type="button"
              onClick={handleUndo}
              className="calm-ghost px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
              disabled={undoStack.length === 0}
            >
              Undo
            </button>
          </div>
        </div>
        {exportError ? <p className="mt-2 text-sm text-[var(--danger)]">{exportError}</p> : null}

        <div className="mt-4 flex min-h-0 flex-1 flex-col rounded-2xl border border-[var(--border)] bg-white p-4">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {selectedDocumentId && documentsById.get(selectedDocumentId) ? (
                <span className="calm-badge px-3 py-1 text-xs">
                  {kindLabel(documentsById.get(selectedDocumentId)!.kind)} v{documentsById.get(selectedDocumentId)!.version}
                </span>
              ) : null}
              <select
                value={selectedDocumentId ?? ""}
                onChange={(event) => void selectDocument(event.target.value || null)}
                className="calm-input px-2 py-2 text-sm"
              >
                <option value="">Select version</option>
                {versionOptions.map((document) => (
                  <option key={document.id} value={document.id}>
                    {kindLabel(document.kind)} v{document.version} - {formatTimestamp(document.createdAt)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {revertError ? <p className="mb-2 text-sm text-[var(--danger)]">{revertError}</p> : null}
          {documentLoading ? <p className="text-sm text-[#6a5488]">Loading document...</p> : null}
          {!documentLoading && !selectedDocument ? (
            <div className="rounded-2xl border border-dashed border-[var(--border)] bg-gradient-to-br from-[#f8f3fd] via-[#fcf9ff] to-white p-8 text-center">
              <h3 className="text-lg font-semibold text-[#41285d]">No draft yet</h3>
              <p className="mx-auto mt-2 max-w-lg text-sm text-[#6d578c]">Use chat to request the first draft. Details is for form-fill and checklist quality.</p>
            </div>
          ) : null}
          {selectedDocument ? (
            <textarea
              className="h-full min-h-0 w-full resize-none rounded-xl border border-[var(--border)] bg-[#fffefc] px-10 py-10 font-['Georgia'] text-[15px] leading-7 text-[#341d4c] outline-none focus:border-[#cdb9e2]"
              value={selectedDocument.content}
              onChange={(event) => setSelectedDocument({ ...selectedDocument, content: event.target.value })}
            />
          ) : null}
        </div>
      </section>

      <aside className="calm-card-soft flex w-full shrink-0 flex-col overflow-hidden p-4 md:h-full md:w-[360px] md:p-5">
        <div className="grid grid-cols-2 gap-1 rounded-xl border border-[var(--border)] bg-white p-1">
          <button
            type="button"
            className={
              rightPanelTab === "chat"
                ? "rounded-lg bg-[#f5effb] px-3 py-2 text-sm font-medium text-[#523674]"
                : "rounded-lg px-3 py-2 text-sm text-[#715a90] transition hover:bg-[#f8f3fd]"
            }
            onClick={() => setRightPanelTab("chat")}
          >
            Chat
          </button>
          <button
            type="button"
            className={
              rightPanelTab === "details"
                ? "rounded-lg bg-[#f5effb] px-3 py-2 text-sm font-medium text-[#523674]"
                : "rounded-lg px-3 py-2 text-sm text-[#715a90] transition hover:bg-[#f8f3fd]"
            }
            onClick={() => setRightPanelTab("details")}
          >
            Details
          </button>
        </div>

        {workflowStages.length > 0 ? (
          <div className="mt-3 grid gap-2">
            {workflowStages.map((stage) => (
              <div key={stage.stageKey} className="rounded-xl border border-[var(--border)] bg-white px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-[#715a90]">{workflowStageLabel(stage.stageKey)}</p>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${workflowStageStatusClass(stage.status)}`}>
                    {stage.status}
                  </span>
                </div>
                <p className="mt-1 text-xs text-[#4e316d]">{stage.summary}</p>
              </div>
            ))}
          </div>
        ) : null}

        {rightPanelTab === "chat" ? (
          <div className="mt-4 flex min-h-0 flex-1 flex-col">
            <div className="flex-1 space-y-2 overflow-y-auto rounded-2xl border border-[var(--border)] bg-white p-3">
              {messages.length === 0 ? <p className="text-sm text-[#715a90]">Start a message to shape this draft with the copilot.</p> : null}
              {messages.map((message) => (
                (() => {
                  const parsed = parseAssistantMessage(message.content);
                  return (
                    <div
                      key={message.id}
                      className={
                        message.role === "assistant"
                          ? "rounded-2xl border border-[#e0d2ee] bg-[var(--accent-soft)] p-3"
                          : "rounded-2xl border border-[var(--border)] bg-white p-3"
                      }
                    >
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-[#725b90]">{message.role}</p>
                      <p className="mt-1 whitespace-pre-wrap text-sm text-[#331c4a]">{parsed.text || message.content}</p>
                      {parsed.collapsedLegacyDraft && selectedDocumentId ? (
                        <button
                          type="button"
                          onClick={() => void openDocumentFromChat(selectedDocumentId)}
                          className="mt-2 inline-flex rounded-lg border border-[#b6d5d0] bg-white px-3 py-1.5 text-xs font-medium text-[#4a2f6e] transition hover:border-[#c3addb] hover:bg-[#faf4ff]"
                        >
                          Open latest document version
                        </button>
                      ) : null}
                      {parsed.update ? (
                        <button
                          type="button"
                          onClick={() => void openDocumentFromChat(parsed.update!.documentId)}
                          className="mt-2 block w-full rounded-xl border border-[#b6d5d0] bg-white px-3 py-2 text-left text-sm text-[#4a2f6e] transition hover:border-[#c3addb] hover:bg-[#faf4ff]"
                        >
                          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#7c6598]">
                            {parsed.update.action === "created" ? "Document Created" : "Document Updated"}
                          </p>
                          <p className="mt-1 font-medium">{parsed.update.label}</p>
                        </button>
                      ) : null}
                      {parsed.checklistBlocked ? (
                        <div className="mt-2 rounded-xl border border-[var(--border)] bg-white px-3 py-2 text-sm text-[#4a2f6e]">
                          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#7c6598]">Checklist Required</p>
                          <p className="mt-1 text-xs text-[#5a3d79]">{parsed.checklistBlocked.missingItems.join(", ")}</p>
                          {canManageUsers ? (
                            <button
                              type="button"
                              className="calm-ghost mt-2 px-2 py-1 text-xs"
                              onClick={() => void onForceGenerate()}
                              disabled={generateBusy}
                            >
                              {generateBusy ? "Working..." : "Force generate"}
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })()
              ))}
            </div>
            <form className="mt-3 shrink-0 space-y-2" onSubmit={onChatSubmit}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-[#715a90]">
                  {selectedDocument ? "Chat updates the current draft." : "Chat creates the first draft."}
                </p>
                <select
                  value={generateKind}
                  onChange={(event) => setGenerateKind(event.target.value as DocumentKind)}
                  className="calm-input px-2 py-1.5 text-xs"
                  disabled={isBusy}
                >
                  <option value="appeal">Appeal</option>
                  <option value="lmn">LMN</option>
                  <option value="p2p">P2P</option>
                </select>
              </div>
              {isBusy ? (
                <div className="rounded-xl border border-[#ddcdec] bg-[var(--accent-soft)]/40 p-3">
                  <p className="text-sm font-medium text-[#4e326d]">{OPERATION_STEPS[operationStep]}</p>
                </div>
              ) : null}
              <textarea
                value={chatInput}
                onChange={(event) => setChatInput(event.target.value)}
                placeholder="Describe what to draft or change. You can also paste missing intake details here."
                className="calm-input min-h-28 w-full px-3 py-2 text-sm"
                disabled={isBusy}
              />
              <button
                type="submit"
                disabled={isBusy}
                className="calm-primary w-full px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isBusy ? "Working..." : selectedDocument ? "Update Draft" : "Generate Draft"}
              </button>
              {generateError ? <p className="text-sm text-[var(--danger)]">{generateError}</p> : null}
              {missingRequiredForGenerate.length > 0 ? (
                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-alt)] p-2 text-xs text-[#44295f]">
                  <p className="font-medium">Missing required intake items</p>
                  <p>{missingRequiredForGenerate.join(", ")}</p>
                  {canManageUsers ? (
                    <button
                      type="button"
                      className="calm-ghost mt-2 px-2 py-1 text-xs"
                      onClick={() => void onForceGenerate()}
                      disabled={generateBusy}
                    >
                      {generateBusy ? "Working..." : "Force generate"}
                    </button>
                  ) : null}
                </div>
              ) : null}
              {reviseError ? <p className="text-sm text-[var(--danger)]">{reviseError}</p> : null}
              {chatError ? <p className="text-sm text-[var(--danger)]">{chatError}</p> : null}
            </form>
          </div>
        ) : (
          <div className="mt-4 flex-1 space-y-3 overflow-y-auto pr-1">
            <div className="rounded-2xl border border-[var(--border)] bg-white p-3">
              <h3 className="text-sm font-semibold">Checklist</h3>
              <ul className="mt-2 space-y-1">
                {intelligence.requiredChecklist.map((item) => (
                  <li key={item.id} className="flex items-start justify-between gap-2 text-sm">
                    <span>{item.label}</span>
                    <span className={item.status === "complete" ? "text-emerald-700" : "text-amber-700"}>
                      {item.status === "complete" ? "Complete" : "Missing"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-2xl border border-[var(--border)] bg-white p-3">
              {(Object.keys(intake) as IntakeFieldKey[]).map((field) => (
                <label key={field} className="mt-2 block first:mt-0">
                  <span className="text-xs font-medium text-[#6e588c]">{intakeFieldLabel(field)}</span>
                  {field === "sex" ? (
                    <div className="mt-1 flex h-10 items-center gap-3 rounded-lg border border-[var(--border)] px-3 text-sm text-[#331c4a]">
                      <label className="inline-flex items-center gap-1">
                        <input
                          type="radio"
                          name="workspace-intake-sex"
                          value="Male"
                          checked={intake.sex === "Male"}
                          onChange={(event) => setIntake((current) => ({ ...current, sex: event.target.value }))}
                        />
                        <span>Male</span>
                      </label>
                      <label className="inline-flex items-center gap-1">
                        <input
                          type="radio"
                          name="workspace-intake-sex"
                          value="Female"
                          checked={intake.sex === "Female"}
                          onChange={(event) => setIntake((current) => ({ ...current, sex: event.target.value }))}
                        />
                        <span>Female</span>
                      </label>
                    </div>
                  ) : field === "diagnosis" ? (
                    <div className="relative mt-1" ref={diagnosisMenuRef}>
                      <input
                        value={intake.diagnosis}
                        onChange={(event) => {
                          const value = event.target.value;
                          setIntake((current) => ({ ...current, diagnosis: value }));
                          setDiagnosisMenuOpen(true);
                        }}
                        className="calm-input w-full px-3 py-2 text-sm"
                        placeholder="Diagnosis (ICD-10)"
                        autoComplete="off"
                      />
                      {diagnosisMenuOpen && (diagnosisOptions.length > 0 || diagnosisLoading) ? (
                        <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-[var(--border)] bg-white p-1 shadow-lg">
                          {diagnosisLoading ? <div className="px-2 py-2 text-xs text-[#715a90]">Searching ICD...</div> : null}
                          {!diagnosisLoading
                            ? diagnosisOptions.map((option) => (
                                <button
                                  key={option.code}
                                  type="button"
                                  className="block w-full rounded-md px-2 py-2 text-left text-sm text-[#44295f] transition hover:bg-[#f8f3fd]"
                                  onClick={() => chooseDiagnosisOption(option)}
                                >
                                  {option.label}
                                </button>
                              ))
                            : null}
                        </div>
                      ) : null}
                    </div>
                  ) : field === "payerName" ? (
                    <div className="relative mt-1" ref={payerMenuRef}>
                      <input
                        value={intake.payerName}
                        onChange={(event) => {
                          const value = event.target.value;
                          setIntake((current) => ({ ...current, payerName: value }));
                          setPayerMenuOpen(true);
                        }}
                        className="calm-input w-full px-3 py-2 text-sm"
                        placeholder="Payer/Insurance"
                        autoComplete="off"
                      />
                      {payerMenuOpen && (payerOptions.length > 0 || payerLoading) ? (
                        <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-[var(--border)] bg-white p-1 shadow-lg">
                          {payerLoading ? <div className="px-2 py-2 text-xs text-[#715a90]">Searching payers...</div> : null}
                          {!payerLoading
                            ? payerOptions.map((option) => (
                                <button
                                  key={option.id}
                                  type="button"
                                  className="block w-full rounded-md px-2 py-2 text-left text-sm text-[#44295f] transition hover:bg-[#f8f3fd]"
                                  onClick={() => choosePayerOption(option)}
                                >
                                  {option.label}
                                </button>
                              ))
                            : null}
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <input
                      value={intake[field]}
                      onChange={(event) => setIntake((current) => ({ ...current, [field]: event.target.value }))}
                      className="calm-input mt-1 w-full px-3 py-2 text-sm"
                      placeholder={field === "planType" ? "ERISA / Medicare / Commercial" : ""}
                    />
                  )}
                </label>
              ))}
            </div>

          </div>
        )}
      </aside>
      </div>
    </main>
  );
}
