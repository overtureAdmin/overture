import { optionalEnv } from "@/lib/env";

const PROCESSOR_TOKEN_HEADER = "x-export-processor-token";

export function isValidExportProcessorToken(request: Request): boolean {
  const expected = optionalEnv("EXPORT_PROCESSOR_SHARED_SECRET");
  if (!expected) {
    return false;
  }
  const provided = request.headers.get(PROCESSOR_TOKEN_HEADER);
  return typeof provided === "string" && provided.length > 0 && provided === expected;
}
