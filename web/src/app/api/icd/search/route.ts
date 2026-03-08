import { jsonError, jsonOk } from "@/lib/http";
import icd10Index from "@/data/icd10-fy2026.json";

type Icd10Entry = {
  code: string;
  title: string;
};

type SearchableIcd10Entry = Icd10Entry & {
  label: string;
  normalizedCode: string;
  normalizedTitle: string;
};

type IcdSearchItem = {
  code: string;
  title: string;
  label: string;
};

function normalizeQuery(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeCodeForSearch(value: string): string {
  return value.replace(/\./g, "").toLowerCase();
}

const searchableIcd10Index: SearchableIcd10Entry[] = (icd10Index as Icd10Entry[]).map((entry) => ({
  ...entry,
  label: `${entry.code} - ${entry.title}`,
  normalizedCode: normalizeCodeForSearch(entry.code),
  normalizedTitle: normalizeQuery(entry.title),
}));

function searchIcd10(query: string, limit: number): IcdSearchItem[] {
  const normalizedQuery = normalizeQuery(query);
  if (normalizedQuery.length < 2) {
    return [];
  }

  const normalizedCodeQuery = normalizeCodeForSearch(normalizedQuery);
  const startsWith: IcdSearchItem[] = [];
  const contains: IcdSearchItem[] = [];

  for (const entry of searchableIcd10Index) {
    if (startsWith.length + contains.length >= limit) {
      break;
    }
    const matchesCodePrefix = entry.normalizedCode.startsWith(normalizedCodeQuery);
    const matchesText = entry.normalizedTitle.includes(normalizedQuery);
    if (!matchesCodePrefix && !matchesText) {
      continue;
    }
    const item: IcdSearchItem = { code: entry.code, title: entry.title, label: entry.label };
    if (matchesCodePrefix) {
      startsWith.push(item);
    } else {
      contains.push(item);
    }
  }

  return [...startsWith, ...contains].slice(0, limit);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim();
  const limitParam = Number(url.searchParams.get("limit") ?? "12");
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 25) : 12;

  if (query.length < 2) {
    return jsonOk({ diagnoses: [] as IcdSearchItem[] });
  }

  try {
    const diagnoses = searchIcd10(query, limit);
    return jsonOk({ diagnoses });
  } catch (error) {
    const message = error instanceof Error ? error.message : "ICD-10 search failed.";
    return jsonError(message, 502);
  }
}
