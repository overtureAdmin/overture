import assert from "node:assert/strict";
import test from "node:test";
import { createDocumentReviseHandler, type DocumentReviseDeps } from "./document-revise.ts";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function baseDeps(overrides: Partial<DocumentReviseDeps> = {}): DocumentReviseDeps {
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
      return { revisionPrompt: "tighten tone" } as T;
    },
    jsonError(message, status = 400) {
      return jsonResponse({ error: message }, status);
    },
    jsonOk(payload, status = 200) {
      return jsonResponse({ data: payload }, status);
    },
    findPhiFindings() {
      return [];
    },
    async generateTextWithBedrock() {
      return "Revised draft";
    },
    getBedrockModelId() {
      return "model-123";
    },
    isBedrockGuardrailError(error: unknown): error is { code: string; findings: string[] } {
      return false;
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

test("document revise handler returns 401 when auth is missing", async () => {
  const handle = createDocumentReviseHandler(
    baseDeps({
      async getAuthContext() {
        return null;
      },
    }),
  );

  const response = await handle(new Request("http://localhost/api/documents/id/revise"), {
    params: Promise.resolve({ id: "33333333-3333-3333-3333-333333333333" }),
  });

  assert.equal(response.status, 401);
});

test("document revise handler returns 422 for PHI-like prompt before DB access", async () => {
  let connectCalled = false;
  const handle = createDocumentReviseHandler(
    baseDeps({
      findPhiFindings() {
        return ["email"];
      },
      getDbPool() {
        return {
          async connect() {
            connectCalled = true;
            throw new Error("should not connect");
          },
        };
      },
    }),
  );

  const response = await handle(new Request("http://localhost/api/documents/id/revise"), {
    params: Promise.resolve({ id: "33333333-3333-3333-3333-333333333333" }),
  });

  assert.equal(response.status, 422);
  assert.equal(connectCalled, false);
});

test("document revise handler enforces tenant-boundary by returning 404 when base document is not found", async () => {
  const client = {
    async query<T = unknown>(sql: string): Promise<{ rows: T[] }> {
      if (sql.includes("SELECT id, thread_id, kind, version, content") && sql.includes("FROM generated_document")) {
        return { rows: [] as T[] };
      }
      return { rows: [] as T[] };
    },
    release() {},
  };

  const handle = createDocumentReviseHandler(
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

  const response = await handle(new Request("http://localhost/api/documents/id/revise"), {
    params: Promise.resolve({ id: "33333333-3333-3333-3333-333333333333" }),
  });

  assert.equal(response.status, 404);
});

test("document revise handler writes consistent audit metadata on success", async () => {
  let auditMetadata: Record<string, unknown> | undefined;
  const client = {
    async query<T = unknown>(sql: string): Promise<{ rows: T[] }> {
      if (sql.includes("SELECT id, thread_id, kind, version, content") && sql.includes("FROM generated_document")) {
        return {
          rows: [
            {
              id: "doc-base",
              thread_id: "thread-1",
              kind: "appeal",
              version: 2,
              content: "Base",
            },
          ] as T[],
        };
      }
      if (sql.includes("INSERT INTO generated_document") && sql.includes("RETURNING id, created_at")) {
        return { rows: [{ id: "doc-new", created_at: "2026-01-01T00:00:00Z" }] as T[] };
      }
      return { rows: [] as T[] };
    },
    release() {},
  };

  const handle = createDocumentReviseHandler(
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

  const response = await handle(new Request("http://localhost/api/documents/id/revise"), {
    params: Promise.resolve({ id: "doc-base" }),
  });

  assert.equal(response.status, 201);
  assert.equal(auditMetadata?.outcome, "success");
  assert.equal(auditMetadata?.threadId, "thread-1");
  assert.equal(auditMetadata?.documentId, "doc-new");
  assert.equal(auditMetadata?.modelId, "model-123");
  assert.equal(auditMetadata?.phiProcessingEnabled, false);
});
