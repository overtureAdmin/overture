import { getAuthContextOrDevFallback, authRequiredResponse } from "@/lib/auth";
import { getDbPool } from "@/lib/db";
import { jsonError, jsonOk } from "@/lib/http";
import { getPrimaryAccessGate, gateToPath } from "@/lib/access";
import { ensureTenantAndUser } from "@/lib/tenant-context";

export async function GET(request: Request) {
  const auth = await getAuthContextOrDevFallback(request);
  if (!auth) {
    return authRequiredResponse();
  }

  const db = getDbPool();
  try {
    const actor = await ensureTenantAndUser(db, auth);
    const gate = getPrimaryAccessGate(actor);
    return jsonOk({
      actor: {
        tenantId: actor.tenantId,
        role: actor.role,
        organizationId: actor.organizationId,
        organizationName: actor.organizationName,
        organizationStatus: actor.organizationStatus,
        organizationType: actor.organizationType,
      },
      access: {
        gate,
        redirectPath: gateToPath(gate),
        organizationConfirmed: actor.organizationConfirmed,
        pendingJoinApproval: actor.pendingJoinApproval,
        termsAccepted: actor.termsAccepted,
        baaAccepted: actor.baaAccepted,
        onboardingCompleted: actor.onboardingCompleted,
        subscriptionStatus: actor.subscriptionStatus,
      },
    });
  } catch (error) {
    console.error("GET /api/profile/status failed", error);
    return jsonError("Failed to load profile status", 500);
  }
}
