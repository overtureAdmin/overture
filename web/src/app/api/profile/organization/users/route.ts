import {
  AdminCreateUserCommand,
  CognitoIdentityProviderClient,
  type UserType,
} from "@aws-sdk/client-cognito-identity-provider";
import { authRequiredResponse, getAuthContextOrDevFallback } from "@/lib/auth";
import { denyIfNoPermission } from "@/lib/access";
import { getDbPool } from "@/lib/db";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/http";
import { ensureTenantAndUser, insertAuditEvent } from "@/lib/tenant-context";

type InviteUserBody = {
  email?: string;
  role?: "org_owner" | "org_admin" | "case_contributor" | "reviewer" | "read_only";
};

function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function generateTemporaryPassword(): string {
  const suffix = `${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
  return `Uht!${suffix}9A`;
}

function getUserAttribute(user: UserType | undefined, name: string): string | null {
  const attributes = user?.Attributes ?? [];
  for (const attribute of attributes) {
    if (attribute.Name === name && attribute.Value) {
      return attribute.Value;
    }
  }
  return null;
}

function getCognitoClient(): CognitoIdentityProviderClient {
  const region = process.env.COGNITO_REGION ?? process.env.AWS_REGION ?? "us-east-1";
  return new CognitoIdentityProviderClient({ region });
}

export async function GET(request: Request) {
  const auth = await getAuthContextOrDevFallback(request);
  if (!auth) {
    return authRequiredResponse();
  }

  const db = getDbPool();
  try {
    const actor = await ensureTenantAndUser(db, auth);
    const deny = denyIfNoPermission(actor, "org:manage");
    if (deny) {
      return deny;
    }

    await db.query(
      `
        UPDATE organization_user_invite
        SET status = 'expired', updated_at = NOW()
        WHERE organization_id = $1::uuid
          AND status = 'pending'
          AND expires_at <= NOW()
      `,
      [actor.organizationId],
    );

    const [usersResult, invitesResult] = await Promise.all([
      db.query<{
        auth_subject: string;
        email: string | null;
        display_name: string | null;
        role: "org_owner" | "org_admin" | "case_contributor" | "reviewer" | "read_only";
        status: "active" | "invited" | "disabled";
        created_at: string;
      }>(
        `
          SELECT
            om.auth_subject,
            ui.email,
            ui.display_name,
            om.role,
            om.status,
            om.created_at
          FROM organization_membership om
          LEFT JOIN user_identity ui
            ON ui.auth_subject = om.auth_subject
          WHERE om.organization_id = $1::uuid
          ORDER BY
            CASE om.status WHEN 'active' THEN 0 WHEN 'invited' THEN 1 ELSE 2 END,
            om.created_at DESC
        `,
        [actor.organizationId],
      ),
      db.query<{
        id: string;
        email: string;
        role: "org_owner" | "org_admin" | "case_contributor" | "reviewer" | "read_only";
        status: "pending" | "accepted" | "canceled" | "expired" | "failed";
        sent_at: string | null;
        expires_at: string;
        created_at: string;
      }>(
        `
          SELECT id, email, role, status, sent_at, expires_at, created_at
          FROM organization_user_invite
          WHERE organization_id = $1::uuid
          ORDER BY created_at DESC
          LIMIT 50
        `,
        [actor.organizationId],
      ),
    ]);

    return jsonOk({
      users: usersResult.rows.map((row) => ({
        authSubject: row.auth_subject,
        email: row.email,
        displayName: row.display_name,
        role: row.role,
        status: row.status,
        createdAt: row.created_at,
      })),
      invites: invitesResult.rows.map((row) => ({
        id: row.id,
        email: row.email,
        role: row.role,
        status: row.status,
        sentAt: row.sent_at,
        expiresAt: row.expires_at,
        createdAt: row.created_at,
      })),
    });
  } catch (error) {
    console.error("GET /api/profile/organization/users failed", error);
    return jsonError("Failed to load users", 500);
  }
}

export async function POST(request: Request) {
  const auth = await getAuthContextOrDevFallback(request);
  if (!auth) {
    return authRequiredResponse();
  }

  const body = await parseJsonBody<InviteUserBody>(request);
  if (!body) {
    return jsonError("Invalid JSON body", 422);
  }

  const rawEmail = body.email?.trim() ?? "";
  if (!rawEmail || !isValidEmail(rawEmail)) {
    return jsonError("A valid email is required", 422);
  }
  const email = rawEmail;
  const normalizedEmail = normalizeEmail(rawEmail);
  const role = body.role ?? "case_contributor";
  const userPoolId = process.env.COGNITO_USER_POOL_ID;
  if (!userPoolId) {
    return jsonError("Cognito user pool is not configured", 500);
  }

  const db = getDbPool();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const actor = await ensureTenantAndUser(client, auth);
    const deny = denyIfNoPermission(actor, "org:manage");
    if (deny) {
      await client.query("ROLLBACK");
      return deny;
    }
    if (normalizeEmail(auth.email ?? "") === normalizedEmail) {
      await client.query("ROLLBACK");
      return jsonError("Use super-admin controls to change your own role/access.", 422);
    }

    const existingMembership = await client.query<{ auth_subject: string }>(
      `
        SELECT ui.auth_subject
        FROM organization_membership om
        INNER JOIN user_identity ui
          ON ui.auth_subject = om.auth_subject
        WHERE om.organization_id = $1::uuid
          AND LOWER(COALESCE(ui.email, '')) = $2
        LIMIT 1
      `,
      [actor.organizationId, normalizedEmail],
    );
    if (existingMembership.rows[0]?.auth_subject) {
      await client.query("ROLLBACK");
      return jsonError("That user already belongs to this organization.", 409);
    }

    const existingPendingInvite = await client.query<{ id: string }>(
      `
        SELECT id
        FROM organization_user_invite
        WHERE organization_id = $1::uuid
          AND normalized_email = $2
          AND status = 'pending'
          AND expires_at > NOW()
        LIMIT 1
      `,
      [actor.organizationId, normalizedEmail],
    );
    if (existingPendingInvite.rows[0]?.id) {
      await client.query("ROLLBACK");
      return jsonError("An active invite already exists for this email.", 409);
    }

    const inviteInsert = await client.query<{
      id: string;
      email: string;
      role: "org_owner" | "org_admin" | "case_contributor" | "reviewer" | "read_only";
      status: "pending";
      sent_at: string | null;
      expires_at: string;
      created_at: string;
    }>(
      `
        INSERT INTO organization_user_invite (
          organization_id,
          email,
          normalized_email,
          role,
          status,
          invited_by_subject,
          expires_at
        )
        VALUES ($1::uuid, $2, $3, $4, 'pending', $5, NOW() + interval '7 days')
        RETURNING id, email, role, status, sent_at, expires_at, created_at
      `,
      [actor.organizationId, email, normalizedEmail, role, auth.userSub],
    );
    const invite = inviteInsert.rows[0];

    await insertAuditEvent(client, {
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "org.user_invite_requested",
      entityType: "organization",
      entityId: actor.organizationId,
      metadata: {
        inviteId: invite.id,
        email,
        role,
      },
    });
    await client.query("COMMIT");

    let deliveryStatus: "sent" | "existing_user" | "failed" = "failed";
    let deliveryMessage = "Invite created, but email delivery failed. Ask user to use password reset if account already exists.";
    let cognitoSub: string | null = null;

    try {
      const cognitoClient = getCognitoClient();
      const createResult = await cognitoClient.send(
        new AdminCreateUserCommand({
          UserPoolId: userPoolId,
          Username: normalizedEmail,
          TemporaryPassword: generateTemporaryPassword(),
          DesiredDeliveryMediums: ["EMAIL"],
          UserAttributes: [
            { Name: "email", Value: normalizedEmail },
            { Name: "email_verified", Value: "true" },
          ],
        }),
      );
      cognitoSub = getUserAttribute(createResult.User, "sub");
      deliveryStatus = "sent";
      deliveryMessage = "Invite email sent. User can sign in, set password, and complete MFA.";
    } catch (error) {
      const errorName = (error as { name?: string } | null)?.name ?? "";
      if (errorName === "UsernameExistsException") {
        deliveryStatus = "existing_user";
        deliveryMessage = "User already exists in Cognito. Ask them to sign in or reset password, then they will be linked on login.";
      } else {
        console.error("POST /api/profile/organization/users cognito invite failed", error);
      }
    }

    const updatePayload = [
      invite.id,
      deliveryStatus === "sent" || deliveryStatus === "existing_user" ? "pending" : "failed",
      deliveryStatus === "sent" ? true : null,
      cognitoSub,
    ];
    await db.query(
      `
        UPDATE organization_user_invite
        SET
          status = $2,
          sent_at = CASE WHEN $3::boolean IS TRUE THEN NOW() ELSE sent_at END,
          cognito_username = COALESCE($4, cognito_username),
          updated_at = NOW()
        WHERE id = $1::uuid
      `,
      updatePayload,
    );

    return jsonOk({
      invite: {
        id: invite.id,
        email: invite.email,
        role: invite.role,
        status: deliveryStatus === "failed" ? "failed" : "pending",
        sentAt: deliveryStatus === "sent" ? new Date().toISOString() : null,
        expiresAt: invite.expires_at,
        createdAt: invite.created_at,
      },
      delivery: {
        status: deliveryStatus,
        message: deliveryMessage,
      },
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("POST /api/profile/organization/users failed", error);
    return jsonError("Failed to invite user", 500);
  } finally {
    client.release();
  }
}
