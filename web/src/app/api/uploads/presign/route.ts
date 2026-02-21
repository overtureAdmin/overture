import { jsonError, jsonOk, parseJsonBody } from "@/lib/http";

type PresignBody = {
  fileName: string;
  contentType: string;
  sizeBytes: number;
};

export async function POST(request: Request) {
  const body = await parseJsonBody<PresignBody>(request);
  if (!body || !body.fileName || !body.contentType || !body.sizeBytes) {
    return jsonError("Missing required fields: fileName, contentType, sizeBytes", 422);
  }

  const uploadId = `upl_${crypto.randomUUID()}`;
  return jsonOk({
    uploadId,
    uploadUrl: `https://example-upload.invalid/${uploadId}`,
    requiredHeaders: {
      "content-type": body.contentType,
    },
    expiresInSeconds: 900,
  });
}
