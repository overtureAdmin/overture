import assert from "node:assert/strict";
import test from "node:test";
import { createChatMessageHandler, type ChatMessageDeps } from "./chat-message.ts";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function baseDeps(overrides: Partial<ChatMessageDeps> = {}): ChatMessageDeps {
  const queryLog: string[] = [];
  const client = {
    async query<T = unknown>(sql: string): Promise<{ rows: T[] }> {
      queryLog.push(sql);
      return { rows: [] as T[] };
    },
    release() {},
  };
  const deps: ChatMessageDeps = {
    async getAuthContext() {
      return { tenantId: "00000000-0000-0000-0000-000000000001", userSub: "u1", email: null };
    },
    authRequiredResponse() {
      return jsonResponse({ error: "Unauthorized: missing or invalid bearer token" }, 401);
    },
    async parseJsonBody<T>() {
      return { role: "user", content: "Hello" } as T;
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
      return "Assistant response";
    },
    getBedrockModelId() {
      return "model";
    },
    isBedrockGuardrailError() {
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

test("chat handler returns 401 when auth is missing", async () => {
  const handle = createChatMessageHandler(
    baseDeps({
      async getAuthContext() {
        return null;
      },
    }),
  );
  const response = await handle(new Request("http://localhost/api/chat"), {
    params: Promise.resolve({ threadId: "22222222-2222-2222-2222-222222222222" }),
  });
  assert.equal(response.status, 401);
});

test("chat handler returns 422 for PHI-like input before DB access", async () => {
  let connectCalled = false;
  const handle = createChatMessageHandler(
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
  const response = await handle(new Request("http://localhost/api/chat"), {
    params: Promise.resolve({ threadId: "22222222-2222-2222-2222-222222222222" }),
  });
  assert.equal(response.status, 422);
  assert.equal(connectCalled, false);
});

test("chat handler enforces tenant-boundary by returning 404 when thread is not found", async () => {
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
  const handle = createChatMessageHandler(
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
  const response = await handle(new Request("http://localhost/api/chat"), {
    params: Promise.resolve({ threadId: "22222222-2222-2222-2222-222222222222" }),
  });
  assert.equal(response.status, 404);
});
