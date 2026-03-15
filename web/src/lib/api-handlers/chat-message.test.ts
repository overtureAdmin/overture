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

test("chat handler stores context_only message without Bedrock call", async () => {
  let bedrockCalled = false;
  const client = {
    async query<T = unknown>(sql: string): Promise<{ rows: T[] }> {
      if (sql.includes("SELECT id") && sql.includes("FROM thread")) {
        return { rows: [{ id: "thread" }] as T[] };
      }
      if (sql.includes("INSERT INTO message") && sql.includes("RETURNING id")) {
        return { rows: [{ id: "u1" }] as T[] };
      }
      return { rows: [] as T[] };
    },
    release() {},
  };
  const handle = createChatMessageHandler(
    baseDeps({
      async parseJsonBody<T>() {
        return {
          role: "user",
          mode: "context_only",
          content:
            "Context for this case:\nPatient name: Ben Frank\nDOB: 1989-04-23\nSex: Male\nDiagnosis: C61\nRequested treatment: proton therapy\nDenial reason: not medically necessary\nPayer/plan: ACCESS COMMUNITY HEALTH NETWORK\nMember ID: 123456",
        } as T;
      },
      findPhiFindings() {
        return ["name"];
      },
      getDbPool() {
        return {
          async connect() {
            return client;
          },
        };
      },
      async generateTextWithBedrock() {
        bedrockCalled = true;
        return "should not run";
      },
    }),
  );

  const response = await handle(new Request("http://localhost/api/chat"), {
    params: Promise.resolve({ threadId: "22222222-2222-2222-2222-222222222222" }),
  });
  assert.equal(response.status, 201);
  const payload = (await response.json()) as { data: { assistantMessageId: string | null; assistantReply: string | null } };
  assert.equal(payload.data.assistantMessageId, null);
  assert.equal(payload.data.assistantReply, null);
  assert.equal(bedrockCalled, false);
});

test("chat handler emits checklist guidance for incomplete context_only intake", async () => {
  let bedrockCalled = false;
  const insertedMessages: string[] = [];
  const client = {
    async query<T = unknown>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> {
      if (sql.includes("SELECT id") && sql.includes("FROM thread")) {
        return { rows: [{ id: "thread" }] as T[] };
      }
      if (sql.includes("INSERT INTO message") && sql.includes("'user'")) {
        return { rows: [{ id: "u1" }] as T[] };
      }
      if (sql.includes("INSERT INTO message") && sql.includes("'assistant'")) {
        insertedMessages.push(String(params?.[2] ?? ""));
        return { rows: [{ id: "a1" }] as T[] };
      }
      if (sql.includes("SELECT policy") && sql.includes("FROM admin_workflow_policy")) {
        return { rows: [] as T[] };
      }
      return { rows: [] as T[] };
    },
    release() {},
  };
  const handle = createChatMessageHandler(
    baseDeps({
      async parseJsonBody<T>() {
        return {
          role: "user",
          mode: "context_only",
          content: "Context for this case:\nPatient name: Jane Doe\nDOB: 1989-04-23",
        } as T;
      },
      getDbPool() {
        return {
          async connect() {
            return client;
          },
        };
      },
      async generateTextWithBedrock() {
        bedrockCalled = true;
        return "should not run";
      },
    }),
  );
  const response = await handle(new Request("http://localhost/api/chat"), {
    params: Promise.resolve({ threadId: "22222222-2222-2222-2222-222222222222" }),
  });
  assert.equal(response.status, 201);
  const payload = (await response.json()) as { data: { assistantMessageId: string | null; assistantReply: string | null } };
  assert.equal(payload.data.assistantMessageId, "a1");
  assert.ok(payload.data.assistantReply?.includes("[[CHECKLIST_BLOCKED|"));
  assert.equal(insertedMessages.length, 1);
  assert.equal(bedrockCalled, false);
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

test("chat handler returns 422 when Bedrock guardrail blocks output", async () => {
  const guardrailError = { code: "PHI_DETECTED", findings: ["email"] };
  let auditAction: string | null = null;
  const client = {
    async query<T = unknown>(sql: string): Promise<{ rows: T[] }> {
      if (sql.includes("SELECT id") && sql.includes("FROM thread")) {
        return { rows: [{ id: "thread" }] as T[] };
      }
      if (sql.includes("INSERT INTO message") && sql.includes("RETURNING id")) {
        return { rows: [{ id: "m1" }] as T[] };
      }
      if (sql.includes("SELECT role, content")) {
        return { rows: [{ role: "user", content: "hello" }] as T[] };
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
      async generateTextWithBedrock() {
        throw guardrailError;
      },
      isBedrockGuardrailError(error): error is { code: string; findings: string[] } {
        return error === guardrailError;
      },
      async insertAuditEvent(_db, params) {
        auditAction = params.action;
      },
    }),
  );
  const response = await handle(new Request("http://localhost/api/chat"), {
    params: Promise.resolve({ threadId: "22222222-2222-2222-2222-222222222222" }),
  });
  assert.equal(response.status, 422);
  assert.equal(auditAction, "message.create.blocked");
});

test("chat handler returns 500 for non-guardrail Bedrock errors", async () => {
  const client = {
    async query<T = unknown>(sql: string): Promise<{ rows: T[] }> {
      if (sql.includes("SELECT id") && sql.includes("FROM thread")) {
        return { rows: [{ id: "thread" }] as T[] };
      }
      if (sql.includes("INSERT INTO message") && sql.includes("RETURNING id")) {
        return { rows: [{ id: "m1" }] as T[] };
      }
      if (sql.includes("SELECT role, content")) {
        return { rows: [{ role: "user", content: "hello" }] as T[] };
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
      async generateTextWithBedrock() {
        throw new Error("bedrock down");
      },
    }),
  );
  const response = await handle(new Request("http://localhost/api/chat"), {
    params: Promise.resolve({ threadId: "22222222-2222-2222-2222-222222222222" }),
  });
  assert.equal(response.status, 500);
});
