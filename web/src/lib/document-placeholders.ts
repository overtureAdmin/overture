type PhiContext = Record<string, string>;

const CANONICAL_PLACEHOLDERS: Array<{ token: string; aliases: string[] }> = [
  { token: "{{PATIENT_NAME}}", aliases: ["[patient name]", "[name]", "[redacted_name]"] },
  { token: "{{DOB}}", aliases: ["[dob]", "[date of birth]"] },
  { token: "{{SEX}}", aliases: ["[sex]"] },
  { token: "{{PAYER_NAME}}", aliases: ["[payer]", "[payer/plan]", "[payer/plan name]", "[insurance company name]"] },
  { token: "{{MEMBER_ID}}", aliases: ["[member id]", "[policy id]"] },
  { token: "{{DIAGNOSIS}}", aliases: ["[diagnosis]", "[diagnosis icd-10]"] },
];

export function placeholderInstructionBlock(): string {
  return [
    "Return draft text using placeholders for patient-identifying fields.",
    "Use canonical placeholders such as {{PATIENT_NAME}}, {{DOB}}, {{SEX}}, {{PAYER_NAME}}, {{MEMBER_ID}}, {{DIAGNOSIS}}.",
  ].join("\n");
}

export function normalizeToCanonicalPlaceholders(text: string): string {
  let out = text;
  for (const entry of CANONICAL_PLACEHOLDERS) {
    for (const alias of entry.aliases) {
      const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      out = out.replace(new RegExp(escaped, "gi"), entry.token);
    }
  }
  return out;
}

export function collectDraftPhiContext(text: string): PhiContext {
  const out: PhiContext = {};
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const value = line.split(":").slice(1).join(":").trim();
    if (!value) continue;
    if (/^patient name\s*:/i.test(line) || /^name\s*:/i.test(line)) out.patientName = value;
    if (/^dob\s*:/i.test(line) || /^date of birth\s*:/i.test(line)) out.dob = value;
    if (/^sex\s*:/i.test(line)) out.sex = value;
    if (/^payer(\/plan)?\s*:/i.test(line) || /^insurance company\s*:/i.test(line)) out.payerName = value;
    if (/^member id\s*:/i.test(line)) out.memberId = value;
    if (/^diagnosis\s*:/i.test(line)) out.diagnosis = value;
  }
  return out;
}

export function mergeDraftPhiContext(...contexts: Array<PhiContext | null | undefined>): PhiContext {
  const merged: PhiContext = {};
  for (const context of contexts) {
    if (!context) continue;
    for (const [key, value] of Object.entries(context)) {
      if (value && value.trim()) {
        merged[key] = value.trim();
      }
    }
  }
  return merged;
}

export function hydrateDraftPlaceholders(text: string, context: PhiContext): string {
  let out = normalizeToCanonicalPlaceholders(text);
  const effective = {
    PATIENT_NAME: context.PATIENT_NAME ?? context.patientName ?? "",
    DOB: context.DOB ?? context.dob ?? "",
    SEX: context.SEX ?? context.sex ?? "",
    PAYER_NAME: context.PAYER_NAME ?? context.payerName ?? "",
    MEMBER_ID: context.MEMBER_ID ?? context.memberId ?? "",
    DIAGNOSIS: context.DIAGNOSIS ?? context.diagnosis ?? "",
  };
  for (const [key, value] of Object.entries(effective)) {
    if (!value) continue;
    out = out.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
  }
  return out;
}
