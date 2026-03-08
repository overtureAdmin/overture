import { authRequiredResponse, getAuthContextOrDevFallback } from "@/lib/auth";
import { getDbPool } from "@/lib/db";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/http";
import { buildProfilePolicy } from "@/lib/profile-policy";
import { ensureTenantAndUser, insertAuditEvent } from "@/lib/tenant-context";

type ProfileMePatchBody = {
  salutation?: string;
  firstName?: string;
  lastName?: string;
  displayName?: string;
  jobTitle?: string;
  phone?: string;
  legalName?: string;
};

function sanitizeNullable(input: unknown, maxLength: number): string | null {
  if (typeof input !== "string") {
    return null;
  }
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.slice(0, maxLength);
}

function isValidE164Phone(input: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(input);
}

export async function GET(request: Request) {
  const auth = await getAuthContextOrDevFallback(request);
  if (!auth) {
    return authRequiredResponse();
  }

  const db = getDbPool();
  try {
    const actor = await ensureTenantAndUser(db, auth);
    const policy = buildProfilePolicy(actor);
    const profileResult = await db.query<{
      email: string | null;
      display_name: string | null;
      salutation: string | null;
      first_name: string | null;
      last_name: string | null;
      legal_name: string | null;
      job_title: string | null;
      phone: string | null;
    }>(
      `
        SELECT
          ui.email,
          ui.display_name,
          up.salutation,
          up.first_name,
          up.last_name,
          onb.legal_name,
          onb.job_title,
          onb.phone
        FROM user_identity ui
        LEFT JOIN user_profile up
          ON up.auth_subject = ui.auth_subject
        LEFT JOIN onboarding_state onb
          ON onb.auth_subject = ui.auth_subject
        WHERE ui.auth_subject = $1
        LIMIT 1
      `,
      [auth.userSub],
    );

    const row = profileResult.rows[0] ?? {
      email: auth.email,
      display_name: null,
      salutation: null,
      first_name: null,
      last_name: null,
      legal_name: null,
      job_title: null,
      phone: null,
    };

    return jsonOk({
      actor: {
        role: actor.role,
        organizationId: actor.organizationId,
        organizationName: actor.organizationName,
        organizationType: actor.organizationType,
        organizationStatus: actor.organizationStatus,
        subscriptionStatus: actor.subscriptionStatus,
      },
      profile: {
        salutation: row.salutation,
        firstName: row.first_name,
        lastName: row.last_name,
        displayName: row.display_name,
        email: row.email ?? auth.email,
        legalName: row.legal_name,
        jobTitle: row.job_title,
        phone: row.phone,
      },
      policy,
    });
  } catch (error) {
    console.error("GET /api/profile/me failed", error);
    return jsonError("Failed to load profile", 500);
  }
}

export async function PATCH(request: Request) {
  const auth = await getAuthContextOrDevFallback(request);
  if (!auth) {
    return authRequiredResponse();
  }

  const body = await parseJsonBody<ProfileMePatchBody>(request);
  if (!body) {
    return jsonError("Invalid JSON body", 422);
  }

  const db = getDbPool();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const actor = await ensureTenantAndUser(client, auth);
    const policy = buildProfilePolicy(actor);

    const payload = {
      salutation: sanitizeNullable(body.salutation, 32),
      firstName: sanitizeNullable(body.firstName, 128),
      lastName: sanitizeNullable(body.lastName, 128),
      displayName: sanitizeNullable(body.displayName, 256),
      jobTitle: sanitizeNullable(body.jobTitle, 256),
      phone: sanitizeNullable(body.phone, 64),
      legalName: sanitizeNullable(body.legalName, 256),
    };

    if ("phone" in body && payload.phone && !isValidE164Phone(payload.phone)) {
      await client.query("ROLLBACK");
      return jsonError("Phone must be in international format (example: +14155552671)", 422);
    }

    const checks: Array<keyof typeof payload> = [
      "salutation",
      "firstName",
      "lastName",
      "displayName",
      "jobTitle",
      "phone",
      "legalName",
    ];

    for (const key of checks) {
      if (key in body) {
        const fieldPolicy = policy.fields[key];
        if (!fieldPolicy.editable) {
          await client.query("ROLLBACK");
          return jsonError(fieldPolicy.reason ?? "Field is locked by policy", 403);
        }
      }
    }

    await client.query(
      `
        INSERT INTO user_profile (auth_subject, salutation, first_name, last_name, updated_at)
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (auth_subject)
        DO UPDATE SET
          salutation = COALESCE(EXCLUDED.salutation, user_profile.salutation),
          first_name = COALESCE(EXCLUDED.first_name, user_profile.first_name),
          last_name = COALESCE(EXCLUDED.last_name, user_profile.last_name),
          updated_at = NOW()
      `,
      [auth.userSub, payload.salutation, payload.firstName, payload.lastName],
    );

    if ("displayName" in body) {
      await client.query(
        `
          UPDATE user_identity
          SET display_name = $2, updated_at = NOW()
          WHERE auth_subject = $1
        `,
        [auth.userSub, payload.displayName],
      );
    }

    if ("legalName" in body || "jobTitle" in body || "phone" in body) {
      await client.query(
        `
          INSERT INTO onboarding_state (auth_subject, organization_id, legal_name, job_title, phone, updated_at)
          VALUES ($1, $2::uuid, $3, $4, $5, NOW())
          ON CONFLICT (auth_subject)
          DO UPDATE SET
            legal_name = COALESCE(EXCLUDED.legal_name, onboarding_state.legal_name),
            job_title = COALESCE(EXCLUDED.job_title, onboarding_state.job_title),
            phone = COALESCE(EXCLUDED.phone, onboarding_state.phone),
            updated_at = NOW()
        `,
        [auth.userSub, actor.organizationId, payload.legalName, payload.jobTitle, payload.phone],
      );
    }

    await insertAuditEvent(client, {
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "profile.updated",
      entityType: "organization",
      entityId: actor.organizationId,
      metadata: {
        updatedKeys: Object.keys(body),
      },
    });

    await client.query("COMMIT");
    return jsonOk({ updated: true });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("PATCH /api/profile/me failed", error);
    return jsonError("Failed to update profile", 500);
  } finally {
    client.release();
  }
}
