import assert from "node:assert/strict";
import test from "node:test";
import { createDocumentDetailHandler, type DocumentDetailDeps } from "./document-detail.ts";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function baseDeps(overrides: Partial<DocumentDetailDeps> = {}): DocumentDetailDeps {
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
    ...overrides,
  };
}

test("document detail handler returns 401 when auth is missing", async () => {
  const handle = createDocumentDetailHandler(
    baseDeps({
      async getAuthContext() {
        return null;
      },
    }),
  );

  const response = await handle(new Request("http://localhost/api/documents/d1"), {
    params: Promise.resolve({ id: "doc-1" }),
  });

  assert.equal(response.status, 401);
});

test("document detail handler enforces tenant boundary by returning 404 when document is not found", async () => {
  const client = {
    async query<T = unknown>(): Promise<{ rows: T[] }> {
      return { rows: [] as T[] };
    },
    release() {},
  };

  const handle = createDocumentDetailHandler(
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

  const response = await handle(new Request("http://localhost/api/documents/d1"), {
    params: Promise.resolve({ id: "doc-1" }),
  });

  assert.equal(response.status, 404);
});

test("document detail handler returns mapped payload", async () => {
  const client = {
    async query<T = unknown>(): Promise<{ rows: T[] }> {
      return {
        rows: [
          {
            id: "doc-1",
            thread_id: "thread-1",
            kind: "appeal",
            version: 3,
            content: "Generated content",
            created_at: "2026-02-22T00:00:00.000Z",
          },
        ] as T[],
      };
    },
    release() {},
  };

  const handle = createDocumentDetailHandler(
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

  const response = await handle(new Request("http://localhost/api/documents/d1"), {
    params: Promise.resolve({ id: "doc-1" }),
  });

  assert.equal(response.status, 200);
  const body = (await response.json()) as { data: { document: { id: string; threadId: string; content: string } } };
  assert.equal(body.data.document.id, "doc-1");
  assert.equal(body.data.document.threadId, "thread-1");
  assert.equal(body.data.document.content, "Generated content");
});
