import { getAuthContextOrDevFallback, authRequiredResponse } from "@/lib/auth";
import { getDbPool } from "@/lib/db";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/http";
import { ensureTenantAndUser, insertAuditEvent } from "@/lib/tenant-context";

type AcceptTermsBody = {
  legalName?: string;
};

const TERMS_VERSION = "unity-terms-v1-2026-02-28";

export async function POST(request: Request) {
  const auth = await getAuthContextOrDevFallback(request);
  if (!auth) {
    return authRequiredResponse();
  }

  const body = await parseJsonBody<AcceptTermsBody>(request);
  const db = getDbPool();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const actor = await ensureTenantAndUser(client, auth);
    const legalNameCandidate = body?.legalName?.trim() ?? "";
    let fallback:
      | {
          legal_name: string | null;
          display_name: string | null;
          first_name: string | null;
          last_name: string | null;
        }
      | undefined;
    try {
      const fallbackResult = await client.query<{
        legal_name: string | null;
        display_name: string | null;
        first_name: string | null;
        last_name: string | null;
      }>(
        `
          SELECT
            onb.legal_name,
            ui.display_name,
            up.first_name,
            up.last_name
          FROM user_identity ui
          LEFT JOIN onboarding_state onb ON onb.auth_subject = ui.auth_subject
          LEFT JOIN user_profile up ON up.auth_subject = ui.auth_subject
          WHERE ui.auth_subject = $1
          LIMIT 1
        `,
        [auth.userSub],
      );
      fallback = fallbackResult.rows[0];
    } catch (error) {
      const code = (error as { code?: string } | null)?.code;
      if (code !== "42703" && code !== "42P01") {
        throw error;
      }
      const fallbackMinimalResult = await client.query<{ legal_name: string | null; display_name: string | null }>(
        `
          SELECT
            onb.legal_name,
            ui.display_name
          FROM user_identity ui
          LEFT JOIN onboarding_state onb ON onb.auth_subject = ui.auth_subject
          WHERE ui.auth_subject = $1
          LIMIT 1
        `,
        [auth.userSub],
      );
      const minimal = fallbackMinimalResult.rows[0];
      fallback = {
        legal_name: minimal?.legal_name ?? null,
        display_name: minimal?.display_name ?? null,
        first_name: null,
        last_name: null,
      };
    }
    const synthesizedName = [fallback?.first_name ?? "", fallback?.last_name ?? ""].join(" ").trim();
    const legalName =
      legalNameCandidate ||
      fallback?.legal_name?.trim() ||
      fallback?.display_name?.trim() ||
      synthesizedName ||
      auth.email ||
      auth.userSub;

    await client.query(
      `
        INSERT INTO terms_of_use_acceptance (organization_id, auth_subject, legal_name, signer_email, version, ip_address, user_agent)
        VALUES ($1::uuid, $2, $3, $4, $5, $6, $7)
      `,
      [
        actor.organizationId,
        auth.userSub,
        legalName,
        auth.email ?? `${auth.userSub}@local.invalid`,
        TERMS_VERSION,
        request.headers.get("x-forwarded-for"),
        request.headers.get("user-agent"),
      ],
    );
    await insertAuditEvent(client, {
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "terms.accepted",
      entityType: "organization",
      entityId: actor.organizationId,
      metadata: {
        version: TERMS_VERSION,
        legalName,
      },
    });
    await client.query("COMMIT");
    return jsonOk({ accepted: true, version: TERMS_VERSION }, 201);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("POST /api/profile/accept-terms failed", error);
    return jsonError("Failed to record terms acceptance", 500);
  } finally {
    client.release();
  }
}
