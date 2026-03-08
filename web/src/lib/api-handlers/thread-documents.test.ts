import assert from "node:assert/strict";
import test from "node:test";
import { createThreadDocumentsHandler, type ThreadDocumentsDeps } from "./thread-documents.ts";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function baseDeps(overrides: Partial<ThreadDocumentsDeps> = {}): ThreadDocumentsDeps {
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

test("thread documents handler returns 401 when auth is missing", async () => {
  const handle = createThreadDocumentsHandler(
    baseDeps({
      async getAuthContext() {
        return null;
      },
    }),
  );

  const response = await handle(new Request("http://localhost/api/threads/t1/documents"), {
    params: Promise.resolve({ threadId: "thread-1" }),
  });

  assert.equal(response.status, 401);
});

test("thread documents handler enforces tenant boundary by returning 404 when thread is not found", async () => {
  const client = {
    async query<T = unknown>(sql: string): Promise<{ rows: T[] }> {
      if (sql.includes("FROM thread")) {
        return { rows: [] as T[] };
      }
      return { rows: [] as T[] };
    },
    release() {},
  };

  const handle = createThreadDocumentsHandler(
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

  const response = await handle(new Request("http://localhost/api/threads/t1/documents"), {
    params: Promise.resolve({ threadId: "thread-1" }),
  });

  assert.equal(response.status, 404);
});

test("thread documents handler returns mapped document summaries", async () => {
  const client = {
    async query<T = unknown>(sql: string): Promise<{ rows: T[] }> {
      if (sql.includes("FROM thread")) {
        return { rows: [{ id: "thread-1" }] as T[] };
      }
      if (sql.includes("FROM generated_document")) {
        return {
          rows: [
            {
              id: "d1",
              thread_id: "thread-1",
              kind: "appeal",
              version: 2,
              created_at: "2026-02-22T00:00:00.000Z",
            },
          ] as T[],
        };
      }
      return { rows: [] as T[] };
    },
    release() {},
  };

  const handle = createThreadDocumentsHandler(
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

  const response = await handle(new Request("http://localhost/api/threads/t1/documents"), {
    params: Promise.resolve({ threadId: "thread-1" }),
  });

  assert.equal(response.status, 200);
  const body = (await response.json()) as { data: { documents: Array<{ id: string; threadId: string; kind: string }> } };
  assert.equal(body.data.documents.length, 1);
  assert.equal(body.data.documents[0].id, "d1");
  assert.equal(body.data.documents[0].threadId, "thread-1");
  assert.equal(body.data.documents[0].kind, "appeal");
});
