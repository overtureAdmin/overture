import type { WorkflowPolicy } from "./workflow-policy.ts";

type RequiredField = {
  key: string;
  label: string;
  complete: boolean;
  value: string | null;
};

const FIELD_LABELS: Record<string, string> = {
  patient_name: "Patient name",
  dob: "DOB",
  sex: "Sex",
  diagnosis: "Diagnosis",
  requested_treatment: "Requested/denied treatment",
  denial_reason: "Denial reason",
  payer_name: "Payer name",
  member_id: "Member ID",
};

const STRUCTURED_HINTS = [
  /patient name\s*:/i,
  /\bdob\s*:/i,
  /\bdiagnosis\s*:/i,
  /\bpayer(?:\/plan)?\s*:/i,
  /\bmember id\s*:/i,
];

const DIAGNOSIS_NORMALIZATION_RULES: Array<{ pattern: RegExp; code: string; label: string }> = [
  {
    pattern: /\bprostate\s+cancer\b|\bmalignant neoplasm of prostate\b/i,
    code: "C61",
    label: "Malignant neoplasm of prostate",
  },
];

type ExtractedValues = {
  patientName?: string;
  dob?: string;
  sex?: string;
  diagnosis?: string;
  requestedTreatment?: string;
  denialReason?: string;
  payerName?: string;
  memberId?: string;
};

function extractValue(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const value = match[1].trim();
      if (value.length > 0) {
        return value;
      }
    }
  }
  return null;
}

function inferFieldValues(context: string): Record<string, string | null> {
  const extracted = extractRequiredFieldValues(context);
  return {
    patient_name: extracted.patientName ?? null,
    dob: extracted.dob ?? null,
    sex: extracted.sex ?? null,
    diagnosis: extracted.diagnosis ?? null,
    requested_treatment: extracted.requestedTreatment ?? null,
    denial_reason: extracted.denialReason ?? null,
    payer_name: extracted.payerName ?? null,
    member_id: extracted.memberId ?? null,
  };
}

function normalizePatientName(value: string | null): string | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value
    .replace(/\b(patient|name|is|was|called|named)\b/gi, " ")
    .replace(/[,:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) {
    return undefined;
  }
  if (/^(name|unknown|n\/a|na|patient)$/i.test(normalized)) {
    return undefined;
  }
  return normalized
    .split(" ")
    .slice(0, 4)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeSex(value: string | null): string | undefined {
  if (!value) {
    return undefined;
  }
  if (/\bmale\b/i.test(value)) {
    return "Male";
  }
  if (/\bfemale\b/i.test(value)) {
    return "Female";
  }
  return undefined;
}

function normalizeDiagnosis(value: string | null): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.replace(/\.$/, "").trim();
  for (const rule of DIAGNOSIS_NORMALIZATION_RULES) {
    if (rule.pattern.test(trimmed)) {
      return `${rule.code} - ${rule.label}`;
    }
  }
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizePayer(value: string | null): string | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value
    .replace(/\bdue to\b.*$/i, " ")
    .replace(/\bfor\b.*$/i, " ")
    .replace(/\b(payer|plan|insurance|company|name)\b/gi, " ")
    .replace(/[,:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) {
    return undefined;
  }
  return normalized;
}

function normalizeDob(value: string | null): string | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.replace(/\b(dob|date of birth|is)\b/gi, " ").replace(/\s+/g, " ").trim();
  const dateMatch = normalized.match(/\b(?:\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}|\d{4}-\d{1,2}-\d{1,2})\b/);
  return dateMatch?.[0];
}

function normalizeSimple(value: string | null): string | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function extractRequiredFieldValues(context: string): ExtractedValues {
  const text = context.replace(/\r/g, "\n");
  const patientName = normalizePatientName(
    extractValue(text, [
      /\bpatient name\s*[:\-]?\s*([^\n.]+)/i,
      /\bname\s*[:\-]\s*([^\n.]+)/i,
      /\bpatient\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\b/i,
    ]),
  );
  const dob = normalizeDob(
    extractValue(text, [/\bdob(?:\s+is)?\s*[:\-]?\s*([^\n.]+)/i, /\bdate of birth(?:\s+is)?\s*[:\-]?\s*([^\n.]+)/i]),
  );
  const sex = normalizeSex(extractValue(text, [/\bsex\s*[:\-]?\s*([^\n.]+)/i, /\bgender\s*[:\-]?\s*([^\n.]+)/i]));
  const diagnosis = normalizeDiagnosis(extractValue(text, [/\bdiagnosis\s*[:\-]?\s*([^\n.]+)/i, /\bdiagnosed with\s*([^\n.]+)/i]));
  const requestedTreatment = normalizeSimple(
    extractValue(text, [
      /requested\/denied treatment\s*[:\-]?\s*([^\n.]+)/i,
      /requested treatment\s*[:\-]?\s*([^\n.]+)/i,
      /denied\s+([a-z0-9\-\/ ]+?)\s+(?:by|from)\b/i,
      /primary cpt code requested\s*[:\-]?\s*([^\n.]+)/i,
    ]),
  );
  const denialReason = normalizeSimple(
    extractValue(text, [
      /\bdenial reason\s*[:\-]?\s*([^\n.]+)/i,
      /\bdue to\s+([^\n.]+)/i,
    ]),
  );
  const payerName = normalizePayer(
    extractValue(text, [
      /\bpayer(?:\/plan)?\s*[:\-]?\s*([^\n.]+)/i,
      /\binsurance company\s*[:\-]?\s*([^\n.]+)/i,
      /\bdenied .* by\s+([A-Z][A-Z0-9&\-/ ]{2,})/i,
      /\bfrom\s+([A-Z][A-Z0-9&\-/ ]{2,})/i,
    ]),
  );
  const memberId = normalizeSimple(
    extractValue(text, [
      /\bmember(?:\s*id)?\s*[#:]?\s*([A-Za-z0-9-]{4,})/i,
      /\bsubscriber(?:\s*id)?\s*[:#]?\s*([A-Za-z0-9-]{4,})/i,
    ]),
  );

  return {
    patientName,
    dob,
    sex,
    diagnosis,
    requestedTreatment,
    denialReason,
    payerName,
    memberId,
  };
}

export function hasStructuredIntakeContext(text: string): boolean {
  const matches = STRUCTURED_HINTS.filter((pattern) => pattern.test(text)).length;
  return matches >= 2;
}

export function evaluateRequiredChecklist(args: {
  policy: WorkflowPolicy;
  checklistContext: string;
  hasStructuredContext: boolean;
}): {
  requiredFields: RequiredField[];
  missingRequired: string[];
} {
  const values = inferFieldValues(args.checklistContext ?? "");
  const requiredFields = args.policy.requiredFieldKeys.map((key) => {
    const value = values[key] ?? null;
    return {
      key,
      label: FIELD_LABELS[key] ?? key,
      complete: Boolean(value && value.trim().length > 0),
      value,
    };
  });
  const missingRequired = requiredFields.filter((field) => !field.complete).map((field) => field.label);
  return { requiredFields, missingRequired };
}
