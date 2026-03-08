import assert from "node:assert/strict";
import test from "node:test";
import { createThreadMessagesHandler, type ThreadMessagesDeps } from "./thread-messages.ts";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function baseDeps(overrides: Partial<ThreadMessagesDeps> = {}): ThreadMessagesDeps {
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

test("thread messages handler returns 401 when auth is missing", async () => {
  const handle = createThreadMessagesHandler(
    baseDeps({
      async getAuthContext() {
        return null;
      },
    }),
  );

  const response = await handle(new Request("http://localhost/api/threads/t1/messages"), {
    params: Promise.resolve({ threadId: "thread-1" }),
  });

  assert.equal(response.status, 401);
});

test("thread messages handler enforces tenant boundary by returning 404 when thread is not found", async () => {
  const client = {
    async query<T = unknown>(sql: string): Promise<{ rows: T[] }> {
      if (sql.includes("FROM thread")) {
        return { rows: [] as T[] };
      }
      return { rows: [] as T[] };
    },
    release() {},
  };

  const handle = createThreadMessagesHandler(
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

  const response = await handle(new Request("http://localhost/api/threads/t1/messages"), {
    params: Promise.resolve({ threadId: "thread-1" }),
  });

  assert.equal(response.status, 404);
});

test("thread messages handler returns ordered messages payload", async () => {
  const client = {
    async query<T = unknown>(sql: string): Promise<{ rows: T[] }> {
      if (sql.includes("FROM thread")) {
        return { rows: [{ id: "thread-1" }] as T[] };
      }
      if (sql.includes("FROM message")) {
        return {
          rows: [
            { id: "m1", role: "user", content: "hello", created_at: "2026-02-22T00:00:00.000Z" },
            { id: "m2", role: "assistant", content: "hi", created_at: "2026-02-22T00:01:00.000Z" },
          ] as T[],
        };
      }
      return { rows: [] as T[] };
    },
    release() {},
  };

  const handle = createThreadMessagesHandler(
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

  const response = await handle(new Request("http://localhost/api/threads/t1/messages"), {
    params: Promise.resolve({ threadId: "thread-1" }),
  });

  assert.equal(response.status, 200);
  const body = (await response.json()) as { data: { messages: Array<{ id: string; createdAt: string }> } };
  assert.equal(body.data.messages.length, 2);
  assert.equal(body.data.messages[0].id, "m1");
  assert.equal(body.data.messages[1].id, "m2");
});
