import assert from "node:assert/strict";
import test from "node:test";
import {
  createDocumentExportStatusHandler,
  type DocumentExportStatusDeps,
} from "./document-export-status.ts";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function baseDeps(overrides: Partial<DocumentExportStatusDeps> = {}): DocumentExportStatusDeps {
  const client = {
    async query<T = unknown>(): Promise<{ rows: T[] }> {
      return { rows: [] as T[] };
    },
    release() {},
  };

  return {
    async getAuthContext() {
      return { tenantId: "00000000-0000-0000-0000-000000000001", userSub: "u1", email: null };
    },
    authRequiredResponse() {
      return jsonResponse({ error: "Unauthorized: missing or invalid bearer token" }, 401);
    },
    jsonError(message, status = 400) {
      return jsonResponse({ error: message }, status);
    },
    jsonOk(payload, status = 200) {
      return jsonResponse({ data: payload }, status);
    },
    getDbPool() {
      return {
        async connect() {
          return client;
        },
      };
    },
    async ensureTenantAndUser() {
      return { tenantId: "00000000-0000-0000-0000-000000000001", userId: "11111111-1111-1111-1111-111111111111" };
    },
    async buildExportStatusPayload(record) {
      return {
        exportId: record.id,
        documentId: record.generated_document_id,
        status: record.status,
      };
    },
    async createDownloadUrl() {
      return "https://example.invalid/download";
    },
    ...overrides,
  };
}

test("document export status handler returns 401 when auth is missing", async () => {
  const handle = createDocumentExportStatusHandler(
    baseDeps({
      async getAuthContext() {
        return null;
      },
    }),
  );

  const response = await handle(new Request("http://localhost/api/documents/id/export/exp"), {
    params: Promise.resolve({ id: "doc-1", exportId: "exp-1" }),
  });

  assert.equal(response.status, 401);
});

test("document export status handler enforces tenant-boundary by returning 404 when export is not found", async () => {
  const client = {
    async query<T = unknown>(sql: string): Promise<{ rows: T[] }> {
      if (sql.includes("FROM generated_document_export")) {
        return { rows: [] as T[] };
      }
      return { rows: [] as T[] };
    },
    release() {},
  };

  const handle = createDocumentExportStatusHandler(
    baseDeps({
      getDbPool() {
        return {
          async connect() {
            return client;
          },
        };
      },
    }),
  );

  const response = await handle(new Request("http://localhost/api/documents/id/export/exp"), {
    params: Promise.resolve({ id: "doc-1", exportId: "exp-1" }),
  });

  assert.equal(response.status, 404);
});
