import assert from "node:assert/strict";
import test from "node:test";
import { buildExportStatusPayload, exportDownloadFileName } from "./export-status.ts";

test("exportDownloadFileName uses document id and extension", () => {
  assert.equal(
    exportDownloadFileName({
      generated_document_id: "doc-123",
      format: "pdf",
    }),
    "unity-appeals-doc-123.pdf",
  );
});

test("buildExportStatusPayload includes download url only when completed with storage key", async () => {
  let createCalls = 0;
  const completed = await buildExportStatusPayload(
    {
      id: "exp-1",
      generated_document_id: "doc-1",
      format: "docx",
      status: "completed",
      storage_key: "exports/t/doc-1/exp-1.docx",
      error_message: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:01Z",
    },
    async ({ key, fileName, expiresInSeconds }) => {
      createCalls += 1;
      assert.equal(key, "exports/t/doc-1/exp-1.docx");
      assert.equal(fileName, "unity-appeals-doc-1.docx");
      assert.equal(expiresInSeconds, 900);
      return "https://example.invalid/download";
    },
  );

  assert.equal(createCalls, 1);
  assert.equal(completed.downloadUrl, "https://example.invalid/download");

  const queued = await buildExportStatusPayload(
    {
      id: "exp-2",
      generated_document_id: "doc-2",
      format: "pdf",
      status: "queued",
      storage_key: null,
      error_message: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:01Z",
    },
    async () => {
      throw new Error("should not be called");
    },
  );

  assert.equal(queued.downloadUrl, null);
});
