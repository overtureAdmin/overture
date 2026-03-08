import payerIndex from "@/data/payers-availity.json";
import { jsonOk } from "@/lib/http";

type PayerEntry = {
  id: string;
  label: string;
  source: "availity";
};

type PayerSearchItem = {
  id: string;
  label: string;
  source: "availity";
};

type SearchablePayerEntry = PayerEntry & {
  normalizedLabel: string;
};

function normalizeQuery(value: string): string {
  return value.trim().toLowerCase();
}

const searchablePayers: SearchablePayerEntry[] = (payerIndex as PayerEntry[]).map((entry) => ({
  ...entry,
  normalizedLabel: normalizeQuery(entry.label),
}));

function searchPayers(query: string, limit: number): PayerSearchItem[] {
  const normalizedQuery = normalizeQuery(query);
  if (normalizedQuery.length < 2) {
    return [];
  }

  const startsWith: PayerSearchItem[] = [];
  const contains: PayerSearchItem[] = [];

  for (const entry of searchablePayers) {
    if (startsWith.length + contains.length >= limit) {
      break;
    }
    if (entry.normalizedLabel.startsWith(normalizedQuery)) {
      startsWith.push({ id: entry.id, label: entry.label, source: "availity" });
      continue;
    }
    if (entry.normalizedLabel.includes(normalizedQuery)) {
      contains.push({ id: entry.id, label: entry.label, source: "availity" });
    }
  }

  return [...startsWith, ...contains].slice(0, limit);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim();
  const limitParam = Number(url.searchParams.get("limit") ?? "10");
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 25) : 10;
  const payers = searchPayers(query, limit);
  return jsonOk({ payers });
}
