import type { ProcessExportResult } from "./export-jobs";

export type ProcessedExportSummary = {
  exportId: string;
  outcome: "completed" | "failed";
  storageKey?: string;
  reason?: string;
};

export async function processExportQueue(params: {
  limit: number;
  processOne: () => Promise<ProcessExportResult>;
}): Promise<{
  requestedLimit: number;
  processedCount: number;
  processed: ProcessedExportSummary[];
}> {
  const processed: ProcessedExportSummary[] = [];

  for (let i = 0; i < params.limit; i += 1) {
    const result = await params.processOne();
    if (result.outcome === "none") {
      break;
    }
    if (result.outcome === "completed") {
      processed.push({
        exportId: result.exportId,
        outcome: result.outcome,
        storageKey: result.storageKey,
      });
      continue;
    }
    processed.push({
      exportId: result.exportId,
      outcome: result.outcome,
      reason: result.reason,
    });
  }

  return {
    requestedLimit: params.limit,
    processedCount: processed.length,
    processed,
  };
}
