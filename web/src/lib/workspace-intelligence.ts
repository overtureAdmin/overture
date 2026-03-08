import { extractRequiredFieldValues } from "./workflow-checklist.ts";

export type IntakeFieldKey =
  | "patientName"
  | "dob"
  | "sex"
  | "diagnosis"
  | "requestedTreatment"
  | "denialReason"
  | "payerName"
  | "memberId"
  | "planType"
  | "jurisdiction"
  | "appealDates";

export type IntakeModel = Record<IntakeFieldKey, string>;

export type ChecklistItem = {
  id: string;
  label: string;
  status: "complete" | "missing";
  required: boolean;
  reason: string;
};

export type ProgressStage = {
  id: string;
  label: string;
  status: "complete" | "active" | "upcoming";
  detail: string;
};

export type CitationIssue = {
  id: string;
  severity: "warning" | "info";
  message: string;
};

export type WorkspaceIntelligenceInput = {
  intake: IntakeModel;
  combinedContext: string;
  documentContent: string;
};

export type WorkspaceIntelligence = {
  requiredChecklist: ChecklistItem[];
  recommendedChecklist: ChecklistItem[];
  missingRequired: string[];
  missingRecommended: string[];
  progress: ProgressStage[];
  comparativePlanRecommended: boolean;
  citationIssues: CitationIssue[];
  legalRelevant: boolean;
};

export const REQUIRED_INTAKE_FIELDS: Array<{ key: IntakeFieldKey; label: string }> = [
  { key: "patientName", label: "Patient name" },
  { key: "dob", label: "DOB" },
  { key: "sex", label: "Sex" },
  { key: "diagnosis", label: "Diagnosis" },
  { key: "requestedTreatment", label: "Requested/denied treatment" },
  { key: "denialReason", label: "Denial reason" },
  { key: "payerName", label: "Payer name" },
  { key: "memberId", label: "Member ID" },
];

const OPTIONAL_INTAKE_FIELDS: Array<{ key: IntakeFieldKey; label: string }> = [
  { key: "planType", label: "Plan type (ERISA/other)" },
  { key: "jurisdiction", label: "Jurisdiction/state" },
  { key: "appealDates", label: "Appeal-level dates" },
];

export function emptyIntakeModel(): IntakeModel {
  return {
    patientName: "",
    dob: "",
    sex: "",
    diagnosis: "",
    requestedTreatment: "",
    denialReason: "",
    payerName: "",
    memberId: "",
    planType: "",
    jurisdiction: "",
    appealDates: "",
  };
}

function clean(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function extractLineValue(context: string, patterns: RegExp[]): string {
  for (const pattern of patterns) {
    const match = context.match(pattern);
    if (match?.[1]) {
      return clean(match[1]);
    }
  }
  return "";
}

export function inferIntakeFromText(context: string): Partial<IntakeModel> {
  const normalized = context.replace(/\r/g, "\n");
  const requiredValues = extractRequiredFieldValues(normalized);

  const planType = /\berisa\b/i.test(normalized)
    ? "ERISA"
    : /\bmedicare\b|\bmedicaid\b|commercial/i.test(normalized)
      ? extractLineValue(normalized, [/\b(medicare|medicaid|commercial)\b/i])
      : "";

  const jurisdiction = extractLineValue(normalized, [
    /(?:jurisdiction|state)\s*[:\-]\s*([^\n]+)/i,
    /\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\b/,
  ]);

  const appealDates = extractLineValue(normalized, [
    /(?:appeal date|deadline|level\s*1|level\s*2|external review)\s*[:\-]\s*([^\n]+)/i,
  ]);

  return {
    patientName: requiredValues.patientName ?? "",
    dob: requiredValues.dob ?? "",
    sex: requiredValues.sex ?? "",
    diagnosis: requiredValues.diagnosis ?? "",
    requestedTreatment: requiredValues.requestedTreatment ?? "",
    denialReason: requiredValues.denialReason ?? "",
    payerName: requiredValues.payerName ?? "",
    memberId: requiredValues.memberId ?? "",
    planType,
    jurisdiction,
    appealDates,
  };
}

export function mergeIntakeWithInference(current: IntakeModel, inferred: Partial<IntakeModel>): IntakeModel {
  const next = { ...current };
  for (const key of Object.keys(next) as IntakeFieldKey[]) {
    if (!next[key] && inferred[key]) {
      next[key] = clean(inferred[key]);
    }
  }
  return next;
}

function hasSection(content: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(content));
}

function referencesPresent(content: string): boolean {
  return /\breferences?\b|\bbibliography\b|\bworks cited\b/i.test(content);
}

function hasComparativeNeedSignal(context: string): boolean {
  return /(head\s*and\s*neck|glioblastoma|complex|step therapy|fail(?:ed|ure) first|non-?formulary|medical necessity)/i.test(
    context,
  );
}

function hasComparativeSection(content: string): boolean {
  return /(comparative treatment plan|alternative treatment|comparison|versus standard care)/i.test(content);
}

export function analyzeCitationIssues(content: string): CitationIssue[] {
  const issues: CitationIssue[] = [];
  if (!content.trim()) {
    return issues;
  }

  const lower = content.toLowerCase();
  const bannedSourceSignals = ["news", "blog", "medium.com", "substack", "wikipedia"];
  if (bannedSourceSignals.some((token) => lower.includes(token))) {
    issues.push({
      id: "banned-source",
      severity: "warning",
      message: "Draft references potentially untrusted sources (news/blog). Use PubMed, major journals, or payer policy pages only.",
    });
  }

  const hasCitationMarkers = /\[[0-9]+\]|\(\d{4}\)/.test(content);
  if (hasCitationMarkers && !referencesPresent(content)) {
    issues.push({
      id: "missing-references",
      severity: "warning",
      message: "Citation markers detected without a references section.",
    });
  }

  const trustedSignals = /(pubmed|doi\b|nejm|jama|lancet|asco|payer policy|medical policy)/i;
  if (referencesPresent(content) && !trustedSignals.test(content)) {
    issues.push({
      id: "unverified-references",
      severity: "info",
      message: "References section lacks obvious trusted-source markers; verify each citation is real peer-reviewed research.",
    });
  }

  return issues;
}

export function buildWorkspaceIntelligence(input: WorkspaceIntelligenceInput): WorkspaceIntelligence {
  const { intake, combinedContext, documentContent } = input;

  const requiredChecklist: ChecklistItem[] = REQUIRED_INTAKE_FIELDS.map((field) => ({
    id: `required-${field.key}`,
    label: field.label,
    required: true,
    status: intake[field.key] ? "complete" : "missing",
    reason: intake[field.key] ? "Present" : "Needed for core letter completeness",
  }));

  const legalRelevant = /erisa|external review|state law|regulation|department of insurance|appeal level/i.test(combinedContext);
  const comparativePlanRecommended = hasComparativeNeedSignal(combinedContext) || /head\s*and\s*neck/i.test(intake.diagnosis);

  const policyFound = /medical policy|coverage policy|payer policy|policy number/i.test(combinedContext);

  const recommendedChecklist: ChecklistItem[] = [
    ...OPTIONAL_INTAKE_FIELDS.map<ChecklistItem>((field) => ({
      id: `recommended-${field.key}`,
      label: field.label,
      required: false,
      status: intake[field.key] ? "complete" : "missing",
      reason: "Improves policy/legal precision without blocking generation",
    })),
    {
      id: "recommended-policy-source",
      label: "Payer policy source attached or identified",
      required: false,
      status: policyFound ? "complete" : "missing",
      reason: policyFound
        ? "Policy context detected"
        : "If unavailable, ask user to upload policy or proceed with generic critique approval",
    },
    {
      id: "recommended-comparative-plan",
      label: "Comparative treatment plan section",
      required: false,
      status: !comparativePlanRecommended || hasComparativeSection(documentContent) ? "complete" : "missing",
      reason: comparativePlanRecommended
        ? "Context suggests comparative planning likely improves payer acceptance"
        : "Optional unless clinical/payer context suggests value",
    },
  ];

  const missingRequired = requiredChecklist.filter((item) => item.status === "missing").map((item) => item.label);
  const missingRecommended = recommendedChecklist
    .filter((item) => item.status === "missing")
    .map((item) => item.label);

  const hasCoreStructure =
    hasSection(documentContent, [/\bintroduction\b/i]) &&
    hasSection(documentContent, [/\bclinical summary\b/i]) &&
    hasSection(documentContent, [/\bclinical justification\b|medical necessity/i]) &&
    hasSection(documentContent, [/\brequested determination\b|\bclosing\b/i]);

  const hasEvidence = hasSection(documentContent, [/supporting research|evidence|study|trial|reference/i]);
  const hasPolicyCritique = hasSection(documentContent, [/policy critique|medical policy|coverage criteria|denial rationale/i]);
  const legalSectionReady = !legalRelevant || hasSection(documentContent, [/legal|regulatory|erisa|state law/i]);

  const stageDone = {
    intake: missingRequired.length === 0,
    draft: hasCoreStructure,
    evidencePolicy: hasEvidence && (hasPolicyCritique || !policyFound),
    legal: legalSectionReady,
  };

  const progress: ProgressStage[] = [
    {
      id: "intake",
      label: "Intake captured",
      status: stageDone.intake ? "complete" : "active",
      detail:
        missingRequired.length === 0
          ? "Required case fields are complete."
          : `Missing ${missingRequired.length} required field(s).`,
    },
    {
      id: "draft",
      label: "Core draft structure",
      status: stageDone.intake && stageDone.draft ? "complete" : stageDone.intake ? "active" : "upcoming",
      detail: stageDone.draft
        ? "Core sections detected."
        : "Ensure intro, clinical summary, justification, and closing sections are present.",
    },
    {
      id: "evidence-policy",
      label: "Evidence and policy reasoning",
      status:
        stageDone.intake && stageDone.draft && stageDone.evidencePolicy
          ? "complete"
          : stageDone.intake && stageDone.draft
            ? "active"
            : "upcoming",
      detail: stageDone.evidencePolicy
        ? "Evidence/policy context looks sufficient."
        : "Add trusted evidence and payer-policy critique context.",
    },
    {
      id: "legal",
      label: "Legal/regulatory coverage",
      status:
        stageDone.intake && stageDone.draft && stageDone.evidencePolicy && stageDone.legal
          ? "complete"
          : stageDone.intake && stageDone.draft && stageDone.evidencePolicy
            ? "active"
            : "upcoming",
      detail: legalRelevant
        ? stageDone.legal
          ? "Legal/regulatory section detected."
          : "Legal signals detected; include legal/regulatory considerations."
        : "No strong legal trigger detected yet.",
    },
    {
      id: "ready",
      label: "Ready for export",
      status:
        stageDone.intake && stageDone.draft && stageDone.evidencePolicy && stageDone.legal
          ? "complete"
          : "upcoming",
      detail:
        stageDone.intake && stageDone.draft && stageDone.evidencePolicy && stageDone.legal
          ? "Draft appears export-ready (download remains non-blocking)."
          : "Continue iterating; export remains available at any time.",
    },
  ];

  return {
    requiredChecklist,
    recommendedChecklist,
    missingRequired,
    missingRecommended,
    progress,
    comparativePlanRecommended,
    citationIssues: analyzeCitationIssues(documentContent),
    legalRelevant,
  };
}

export type SmartAction = "generate" | "revise" | "chat";

export function chooseSmartAction(args: { hasDocument: boolean; prompt: string }): SmartAction {
  const normalizedPrompt = args.prompt.trim().toLowerCase();

  if (!normalizedPrompt) {
    return args.hasDocument ? "revise" : "generate";
  }

  if (/\b(question|why|what|how|clarify|explain)\b/.test(normalizedPrompt)) {
    return "chat";
  }

  if (/\b(generate|draft|create|new letter|start letter)\b/.test(normalizedPrompt)) {
    return "generate";
  }

  if (/\b(revise|edit|update|tighten|improve|rewrite|shorten|expand)\b/.test(normalizedPrompt)) {
    return args.hasDocument ? "revise" : "generate";
  }

  return args.hasDocument ? "revise" : "generate";
}

export function buildSmartPromptAddendum(intelligence: WorkspaceIntelligence): string {
  const lines: string[] = [
    "[Overture Drafting Rules]",
    "- PHI processing remains disabled. Do not include identifying patient details.",
    "- Use only trusted references (PubMed, major journals, payer policy pages).",
    "- If a source cannot be verified as real peer-reviewed research, omit it.",
  ];

  if (intelligence.missingRequired.length > 0) {
    lines.push(`- Missing required intake fields: ${intelligence.missingRequired.join(", ")}. Ask focused follow-up questions as needed.`);
  }

  if (intelligence.missingRecommended.length > 0) {
    lines.push(
      `- Recommended follow-ups: ${intelligence.missingRecommended.join(", ")} (non-blocking).`,
    );
  }

  if (intelligence.comparativePlanRecommended) {
    lines.push("- Include a comparative treatment plan section unless user explicitly declines.");
  }

  if (intelligence.legalRelevant) {
    lines.push("- Legal/regulatory context appears relevant; include a concise, non-advisory legal considerations section.");
    lines.push("- Add explicit note: This content is informational and not legal advice.");
  }

  return lines.join("\n");
}
