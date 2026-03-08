type Actor = {
  tenantId: string;
  userId: string;
};

type SqlClient = {
  query: <T = unknown>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
  release: () => void;
};

type SqlPool = {
  connect: () => Promise<SqlClient>;
};

export type ThreadWorkflowDeps = {
  getAuthContext: (request: Request) => Promise<{ tokenTenantId?: string | null; tenantId?: string; userSub: string; email: string | null } | null>;
  authRequiredResponse: () => Response;
  jsonError: (message: string, status?: number) => Response;
  jsonOk: (payload: unknown, status?: number) => Response;
  getDbPool: () => SqlPool;
  ensureTenantAndUser: (
    db: SqlClient,
    auth: { tokenTenantId?: string | null; tenantId?: string; userSub: string; email: string | null },
  ) => Promise<Actor>;
};

export type ThreadWorkflowRouteParams = {
  params: Promise<{ threadId: string }>;
};

export function createThreadWorkflowHandler(deps: ThreadWorkflowDeps) {
  return async function handleThreadWorkflow(request: Request, { params }: ThreadWorkflowRouteParams) {
    const auth = await deps.getAuthContext(request);
    if (!auth) {
      return deps.authRequiredResponse();
    }

    const { threadId } = await params;
    const db = deps.getDbPool();
    const client = await db.connect();

    try {
      const actor = await deps.ensureTenantAndUser(client, auth);
      const threadResult = await client.query<{ id: string }>(
        `
          SELECT id
          FROM thread
          WHERE id = $1::uuid
            AND tenant_id = $2::uuid
          LIMIT 1
        `,
        [threadId, actor.tenantId],
      );

      if (!threadResult.rows[0]) {
        return deps.jsonError("Thread not found", 404);
      }

      const stagesResult = await client.query<{
        stage_key: "intake_review" | "evidence_plan" | "draft_plan";
        status: "pending" | "blocked" | "ready" | "complete";
        summary: string;
        metadata: Record<string, unknown>;
        updated_at: string;
      }>(
        `
          SELECT stage_key, status, summary, metadata, updated_at
          FROM thread_workflow_stage
          WHERE tenant_id = $1::uuid
            AND thread_id = $2::uuid
          ORDER BY
            CASE stage_key
              WHEN 'intake_review' THEN 1
              WHEN 'evidence_plan' THEN 2
              WHEN 'draft_plan' THEN 3
              ELSE 99
            END ASC
        `,
        [actor.tenantId, threadId],
      );

      return deps.jsonOk({
        stages: stagesResult.rows.map((row) => ({
          stageKey: row.stage_key,
          status: row.status,
          summary: row.summary,
          metadata: row.metadata ?? {},
          updatedAt: row.updated_at,
        })),
      });
    } catch (_error) {
      return deps.jsonError("Failed to load workflow", 500);
    } finally {
      client.release();
    }
  };
}
