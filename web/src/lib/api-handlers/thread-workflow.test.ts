import assert from "node:assert/strict";
import test from "node:test";
import { createThreadWorkflowHandler, type ThreadWorkflowDeps } from "./thread-workflow.ts";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function baseDeps(overrides: Partial<ThreadWorkflowDeps> = {}): ThreadWorkflowDeps {
  const client = {
    async query<T = unknown>(): Promise<{ rows: T[] }> {
      return { rows: [] as T[] };
    },
    release() {},
  };
  const deps: ThreadWorkflowDeps = {
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
  return deps;
}

test("thread workflow handler returns 401 when auth is missing", async () => {
  const handle = createThreadWorkflowHandler(
    baseDeps({
      async getAuthContext() {
        return null;
      },
    }),
  );
  const response = await handle(new Request("http://localhost/api/workflow"), {
    params: Promise.resolve({ threadId: "22222222-2222-2222-2222-222222222222" }),
  });
  assert.equal(response.status, 401);
});

test("thread workflow handler enforces tenant boundary by returning 404 when thread is not found", async () => {
  const client = {
    async query<T = unknown>(sql: string): Promise<{ rows: T[] }> {
      if (sql.includes("SELECT id") && sql.includes("FROM thread")) {
        return { rows: [] as T[] };
      }
      return { rows: [] as T[] };
    },
    release() {},
  };
  const handle = createThreadWorkflowHandler(
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
  const response = await handle(new Request("http://localhost/api/workflow"), {
    params: Promise.resolve({ threadId: "22222222-2222-2222-2222-222222222222" }),
  });
  assert.equal(response.status, 404);
});

test("thread workflow handler returns ordered stages payload", async () => {
  const client = {
    async query<T = unknown>(sql: string): Promise<{ rows: T[] }> {
      if (sql.includes("SELECT id") && sql.includes("FROM thread")) {
        return { rows: [{ id: "thread" }] as T[] };
      }
      if (sql.includes("SELECT stage_key, status, summary, metadata, updated_at")) {
        return {
          rows: [
            {
              stage_key: "intake_review",
              status: "ready",
              summary: "Intake complete.",
              metadata: {},
              updated_at: "2026-03-02T00:00:00.000Z",
            },
            {
              stage_key: "draft_plan",
              status: "complete",
              summary: "Draft generated.",
              metadata: { version: 2 },
              updated_at: "2026-03-02T00:00:10.000Z",
            },
          ] as T[],
        };
      }
      return { rows: [] as T[] };
    },
    release() {},
  };
  const handle = createThreadWorkflowHandler(
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
  const response = await handle(new Request("http://localhost/api/workflow"), {
    params: Promise.resolve({ threadId: "22222222-2222-2222-2222-222222222222" }),
  });
  assert.equal(response.status, 200);
  const payload = (await response.json()) as { data: { stages: Array<{ stageKey: string; status: string }> } };
  assert.deepEqual(payload.data.stages.map((stage) => stage.stageKey), ["intake_review", "draft_plan"]);
  assert.deepEqual(payload.data.stages.map((stage) => stage.status), ["ready", "complete"]);
});
