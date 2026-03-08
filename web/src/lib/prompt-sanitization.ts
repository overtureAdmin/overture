export type SanitizedPrompt = {
  originalText: string;
  sanitizedText: string;
  removedDirectIdentifiers: boolean;
  ageDerivation: {
    ageYears: number | null;
    ageBand: string | null;
  };
};

const PATTERNS: Array<[RegExp, string]> = [
  [/\b\d{3}-\d{2}-\d{4}\b/g, "[REDACTED_SSN]"],
  [/\b(?:mrn|member id|memberid)\s*[:#-]?\s*[a-z0-9-]+\b/gi, "member id: [REDACTED_MEMBER_ID]"],
];

export function deidentifyPromptText(input: string): SanitizedPrompt {
  let sanitized = input;
  let removedDirectIdentifiers = false;
  for (const [pattern, replacement] of PATTERNS) {
    const next = sanitized.replace(pattern, replacement);
    if (next !== sanitized) {
      removedDirectIdentifiers = true;
    }
    sanitized = next;
  }

  const dobMatch = input.match(/\b(?:dob|date of birth)\s*[:\-]?\s*(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})\b/i);
  let ageYears: number | null = null;
  let ageBand: string | null = null;
  if (dobMatch?.[1]) {
    const raw = dobMatch[1].replace(/-/g, "/");
    const [monthText, dayText, yearText] = raw.split("/");
    const month = Number(monthText);
    const day = Number(dayText);
    const year = Number(yearText.length === 2 ? `19${yearText}` : yearText);
    if (Number.isFinite(month) && Number.isFinite(day) && Number.isFinite(year)) {
      const now = new Date();
      const dob = new Date(Date.UTC(year, month - 1, day));
      if (!Number.isNaN(dob.getTime())) {
        let years = now.getUTCFullYear() - dob.getUTCFullYear();
        const notHadBirthday =
          now.getUTCMonth() < dob.getUTCMonth() ||
          (now.getUTCMonth() === dob.getUTCMonth() && now.getUTCDate() < dob.getUTCDate());
        if (notHadBirthday) {
          years -= 1;
        }
        if (years >= 0 && years < 130) {
          ageYears = years;
          if (years < 18) {
            ageBand = "pediatric";
          } else if (years < 40) {
            ageBand = "adult_18_39";
          } else if (years < 65) {
            ageBand = "adult_40_64";
          } else {
            ageBand = "adult_65_plus";
          }
        }
      }
    }
    sanitized = sanitized.replace(dobMatch[1], "[REDACTED_DOB]");
    removedDirectIdentifiers = true;
  }
  return {
    originalText: input,
    sanitizedText: sanitized,
    removedDirectIdentifiers,
    ageDerivation: {
      ageYears,
      ageBand,
    },
  };
}
