import assert from "node:assert/strict";
import test from "node:test";
import { createDocumentGenerateHandler, type DocumentGenerateDeps } from "./document-generate.ts";

const COMPLETE_CONTEXT = [
  "Patient name: Jane Doe",
  "DOB: 01/02/1980",
  "Sex: Female",
  "Diagnosis: C61 - Malignant neoplasm of prostate",
  "Requested treatment: Proton therapy",
  "Denial reason: Not medically necessary",
  "Payer/plan: Example Health Plan",
  "Member ID: ABC12345",
].join("\n");

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function baseDeps(overrides: Partial<DocumentGenerateDeps> = {}): DocumentGenerateDeps {
  const client = {
    async query<T = unknown>(): Promise<{ rows: T[] }> {
      return { rows: [] as T[] };
    },
    release() {},
  };
  const deps: DocumentGenerateDeps = {
    async getAuthContext() {
      return { tenantId: "00000000-0000-0000-0000-000000000001", userSub: "u1", email: null };
    },
    authRequiredResponse() {
      return jsonResponse({ error: "Unauthorized: missing or invalid bearer token" }, 401);
    },
    async parseJsonBody<T>() {
      return { kind: "appeal", instructions: "draft it" } as T;
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
      return "Draft";
    },
    getBedrockModelId() {
      return "model";
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
  return deps;
}

test("document generate handler returns 401 when auth is missing", async () => {
  const handle = createDocumentGenerateHandler(
    baseDeps({
      async getAuthContext() {
        return null;
      },
    }),
  );
  const response = await handle(new Request("http://localhost/api/documents/id/generate"), {
    params: Promise.resolve({ id: "33333333-3333-3333-3333-333333333333" }),
  });
  assert.equal(response.status, 401);
});

test("document generate handler returns 422 for PHI-like instruction before DB access", async () => {
  let connectCalled = false;
  const handle = createDocumentGenerateHandler(
    baseDeps({
      findPhiFindings(content) {
        if (content.includes("name")) {
          return ["name"];
        }
        return [];
      },
      async parseJsonBody<T>() {
        return { kind: "lmn", instructions: "include patient name" } as T;
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
  const response = await handle(new Request("http://localhost/api/documents/id/generate"), {
    params: Promise.resolve({ id: "33333333-3333-3333-3333-333333333333" }),
  });
  assert.equal(response.status, 422);
  assert.equal(connectCalled, false);
});

test("document generate handler enforces tenant-boundary by returning 404 when thread is not found", async () => {
  const client = {
    async query<T = unknown>(sql: string): Promise<{ rows: T[] }> {
      if (sql.includes("SELECT id") && sql.includes("FROM thread")) {
        return { rows: [] as T[] };
      }
      if (sql.includes("SELECT id") && sql.includes("FROM app_user")) {
        return { rows: [{ id: "11111111-1111-1111-1111-111111111111" }] as T[] };
      }
      return { rows: [] as T[] };
    },
    release() {},
  };
  const handle = createDocumentGenerateHandler(
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
  const response = await handle(new Request("http://localhost/api/documents/id/generate"), {
    params: Promise.resolve({ id: "33333333-3333-3333-3333-333333333333" }),
  });
  assert.equal(response.status, 404);
});

test("document generate handler returns 422 when Bedrock guardrail blocks output", async () => {
  const guardrailError = { code: "PHI_DETECTED", findings: ["phone"] };
  let auditAction: string | null = null;
  let auditMetadata: Record<string, unknown> | undefined;
  const client = {
    async query<T = unknown>(sql: string): Promise<{ rows: T[] }> {
      if (sql.includes("SELECT id") && sql.includes("FROM thread")) {
        return { rows: [{ id: "thread" }] as T[] };
      }
      if (sql.includes("SELECT content") && sql.includes("FROM message")) {
        return { rows: [{ content: COMPLETE_CONTEXT }] as T[] };
      }
      if (sql.includes("SELECT MAX(version)")) {
        return { rows: [{ max_version: 1 }] as T[] };
      }
      return { rows: [] as T[] };
    },
    release() {},
  };
  const handle = createDocumentGenerateHandler(
    baseDeps({
      getDbPool() {
        return {
          async connect() {
            return client;
          },
        };
      },
      async generateTextWithBedrock() {
        throw guardrailError;
      },
      isBedrockGuardrailError(error): error is { code: string; findings: string[] } {
        return error === guardrailError;
      },
      async insertAuditEvent(_db, params) {
        auditAction = params.action;
        auditMetadata = params.metadata;
      },
    }),
  );
  const response = await handle(new Request("http://localhost/api/documents/id/generate"), {
    params: Promise.resolve({ id: "33333333-3333-3333-3333-333333333333" }),
  });
  assert.equal(response.status, 422);
  assert.equal(auditAction, "document.generate.blocked");
  assert.equal(auditMetadata?.outcome, "blocked");
  assert.equal(auditMetadata?.modelId, "model");
  assert.equal(auditMetadata?.phiProcessingEnabled, false);
});

test("document generate handler returns 500 for non-guardrail Bedrock errors", async () => {
  const client = {
    async query<T = unknown>(sql: string): Promise<{ rows: T[] }> {
      if (sql.includes("SELECT id") && sql.includes("FROM thread")) {
        return { rows: [{ id: "thread" }] as T[] };
      }
      if (sql.includes("SELECT content") && sql.includes("FROM message")) {
        return { rows: [{ content: COMPLETE_CONTEXT }] as T[] };
      }
      if (sql.includes("SELECT MAX(version)")) {
        return { rows: [{ max_version: 1 }] as T[] };
      }
      return { rows: [] as T[] };
    },
    release() {},
  };
  const handle = createDocumentGenerateHandler(
    baseDeps({
      getDbPool() {
        return {
          async connect() {
            return client;
          },
        };
      },
      async generateTextWithBedrock() {
        throw new Error("bedrock timeout");
      },
    }),
  );
  const response = await handle(new Request("http://localhost/api/documents/id/generate"), {
    params: Promise.resolve({ id: "33333333-3333-3333-3333-333333333333" }),
  });
  assert.equal(response.status, 500);
});

test("document generate handler writes consistent audit metadata on success", async () => {
  let auditMetadata: Record<string, unknown> | undefined;
  const client = {
    async query<T = unknown>(sql: string): Promise<{ rows: T[] }> {
      if (sql.includes("SELECT id") && sql.includes("FROM thread")) {
        return { rows: [{ id: "thread" }] as T[] };
      }
      if (sql.includes("SELECT content") && sql.includes("FROM message")) {
        return { rows: [{ content: COMPLETE_CONTEXT }] as T[] };
      }
      if (sql.includes("SELECT MAX(version)")) {
        return { rows: [{ max_version: 1 }] as T[] };
      }
      if (sql.includes("INSERT INTO generated_document") && sql.includes("RETURNING id, created_at")) {
        return { rows: [{ id: "doc-2", created_at: "2026-01-01T00:00:00Z" }] as T[] };
      }
      return { rows: [] as T[] };
    },
    release() {},
  };
  const handle = createDocumentGenerateHandler(
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
  const response = await handle(new Request("http://localhost/api/documents/id/generate"), {
    params: Promise.resolve({ id: "33333333-3333-3333-3333-333333333333" }),
  });
  assert.equal(response.status, 201);
  assert.equal(auditMetadata?.outcome, "success");
  assert.equal(auditMetadata?.documentId, "doc-2");
  assert.equal(auditMetadata?.modelId, "model");
  assert.equal(auditMetadata?.phiProcessingEnabled, false);
});

test("document generate checklist evaluation uses recent thread context not only latest message", async () => {
  const client = {
    async query<T = unknown>(sql: string): Promise<{ rows: T[] }> {
      if (sql.includes("SELECT id") && sql.includes("FROM thread")) {
        return { rows: [{ id: "thread" }] as T[] };
      }
      if (sql.includes("SELECT content") && sql.includes("FROM message")) {
        return {
          rows: [
            { content: "please create the draft now" },
            { content: `Context for this case:\n${COMPLETE_CONTEXT}` },
          ] as T[],
        };
      }
      if (sql.includes("SELECT MAX(version)")) {
        return { rows: [{ max_version: 0 }] as T[] };
      }
      if (sql.includes("INSERT INTO generated_document") && sql.includes("RETURNING id, created_at")) {
        return { rows: [{ id: "doc-ctx", created_at: "2026-01-01T00:00:00Z" }] as T[] };
      }
      return { rows: [] as T[] };
    },
    release() {},
  };
  const handle = createDocumentGenerateHandler(
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
  const response = await handle(new Request("http://localhost/api/documents/id/generate"), {
    params: Promise.resolve({ id: "33333333-3333-3333-3333-333333333333" }),
  });
  assert.equal(response.status, 201);
});
