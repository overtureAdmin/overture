import assert from "node:assert/strict";
import test from "node:test";
import { createDocumentExportHandler, type DocumentExportDeps } from "./document-export.ts";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function baseDeps(overrides: Partial<DocumentExportDeps> = {}): DocumentExportDeps {
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
    async parseJsonBody<T>() {
      return { format: "pdf" } as T;
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
    async insertAuditEvent() {},
    ...overrides,
  };
}

test("document export handler returns 401 when auth is missing", async () => {
  const handle = createDocumentExportHandler(
    baseDeps({
      async getAuthContext() {
        return null;
      },
    }),
  );

  const response = await handle(new Request("http://localhost/api/documents/id/export"), {
    params: Promise.resolve({ id: "33333333-3333-3333-3333-333333333333" }),
  });

  assert.equal(response.status, 401);
});

test("document export handler enforces tenant-boundary by returning 404 when document is not found", async () => {
  const client = {
    async query<T = unknown>(sql: string): Promise<{ rows: T[] }> {
      if (sql.includes("SELECT id, thread_id, kind, version") && sql.includes("FROM generated_document")) {
        return { rows: [] as T[] };
      }
      return { rows: [] as T[] };
    },
    release() {},
  };

  const handle = createDocumentExportHandler(
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

  const response = await handle(new Request("http://localhost/api/documents/id/export"), {
    params: Promise.resolve({ id: "33333333-3333-3333-3333-333333333333" }),
  });

  assert.equal(response.status, 404);
});

test("document export handler writes consistent audit metadata", async () => {
  let auditMetadata: Record<string, unknown> | undefined;
  const client = {
    async query<T = unknown>(sql: string): Promise<{ rows: T[] }> {
      if (sql.includes("SELECT id, thread_id, kind, version") && sql.includes("FROM generated_document")) {
        return {
          rows: [{ id: "doc-1", thread_id: "thread-1", kind: "lmn", version: 3 }] as T[],
        };
      }
      if (sql.includes("INSERT INTO generated_document_export") && sql.includes("RETURNING id, status, created_at")) {
        return { rows: [{ id: "exp-1", status: "queued", created_at: "2026-01-01T00:00:00Z" }] as T[] };
      }
      return { rows: [] as T[] };
    },
    release() {},
  };

  const handle = createDocumentExportHandler(
    baseDeps({
      getDbPool() {
        return {
          async connect() {
            return client;
          },
        };
      },
      async insertAuditEvent(_db, params) {
        auditMetadata = params.metadata;
      },
    }),
  );

  const response = await handle(new Request("http://localhost/api/documents/id/export"), {
    params: Promise.resolve({ id: "doc-1" }),
  });

  assert.equal(response.status, 201);
  assert.equal(auditMetadata?.outcome, "queued");
  assert.equal(auditMetadata?.threadId, "thread-1");
  assert.equal(auditMetadata?.documentId, "doc-1");
  assert.equal(auditMetadata?.modelId, null);
  assert.equal(auditMetadata?.phiProcessingEnabled, false);
});
