import { createHash } from "node:crypto";
import pg from "pg";

const { Client } = pg;

function parseArgs(argv) {
  const out = {
    orgs: 3,
    usersPerOrg: 3,
    patientsPerUser: 4,
    prefix: "synth",
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--orgs") {
      out.orgs = Number.parseInt(argv[++i] ?? "3", 10);
      continue;
    }
    if (arg === "--users-per-org") {
      out.usersPerOrg = Number.parseInt(argv[++i] ?? "3", 10);
      continue;
    }
    if (arg === "--patients-per-user") {
      out.patientsPerUser = Number.parseInt(argv[++i] ?? "4", 10);
      continue;
    }
    if (arg === "--prefix") {
      out.prefix = (argv[++i] ?? "synth").trim().toLowerCase();
      continue;
    }
  }

  if (!Number.isFinite(out.orgs) || out.orgs < 1) {
    throw new Error("Invalid --orgs value");
  }
  if (!Number.isFinite(out.usersPerOrg) || out.usersPerOrg < 1) {
    throw new Error("Invalid --users-per-org value");
  }
  if (!Number.isFinite(out.patientsPerUser) || out.patientsPerUser < 1) {
    throw new Error("Invalid --patients-per-user value");
  }
  if (!out.prefix) {
    throw new Error("Invalid --prefix value");
  }

  return out;
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function buildDatabaseUrl() {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }

  const host = requireEnv("DATABASE_HOST");
  const port = process.env.DATABASE_PORT ?? "5432";
  const database = requireEnv("DATABASE_NAME");
  const user = requireEnv("DATABASE_USER");
  const password = requireEnv("DATABASE_PASSWORD");
  return `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
}

function stableUuid(seed) {
  const hex = createHash("md5").update(seed).digest("hex");
  const part1 = hex.slice(0, 8);
  const part2 = hex.slice(8, 12);
  const part3 = `4${hex.slice(13, 16)}`;
  const variantNibble = (Number.parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8;
  const part4 = `${variantNibble.toString(16)}${hex.slice(17, 20)}`;
  const part5 = hex.slice(20, 32);
  return `${part1}-${part2}-${part3}-${part4}-${part5}`;
}

const roles = ["org_owner", "org_admin", "case_contributor", "reviewer", "read_only"];
const diagnosisPool = ["C61", "C00.0", "C50.911", "C34.90", "C71.9", "C22.0"];
const payerPool = ["UnitedHealthcare", "Aetna", "Cigna", "Blue Cross Blue Shield", "Humana", "Anthem"];

async function seed() {
  const args = parseArgs(process.argv);
  const dbUrl = buildDatabaseUrl();
  const client = new Client({
    connectionString: dbUrl,
    ssl: process.env.DATABASE_SSL === "require" ? { rejectUnauthorized: false } : undefined,
  });

  await client.connect();
  await client.query("BEGIN");

  let organizationsCreated = 0;
  let usersCreated = 0;
  let threadsCreated = 0;
  let casesCreated = 0;

  try {
    for (let orgIndex = 1; orgIndex <= args.orgs; orgIndex += 1) {
      const organizationSlug = `${args.prefix}-org-${orgIndex}`;
      const organizationName = `Synthetic Org ${orgIndex}`;
      const organizationId = stableUuid(`org:${organizationSlug}`);
      const accountType = orgIndex % 2 === 0 ? "enterprise" : "solo";
      const subscriptionStatus = orgIndex % 2 === 0 ? "active" : "trialing";

      const orgInsert = await client.query(
        `
          INSERT INTO organization (id, slug, name, account_type, status, created_by_subject)
          VALUES ($1::uuid, $2, $3, $4, 'verified', 'seed-script')
          ON CONFLICT (id)
          DO UPDATE SET
            slug = EXCLUDED.slug,
            name = EXCLUDED.name,
            account_type = EXCLUDED.account_type,
            status = 'verified',
            updated_at = NOW()
          RETURNING (xmax = 0) AS inserted
        `,
        [organizationId, organizationSlug, organizationName, accountType],
      );
      if (orgInsert.rows[0]?.inserted) {
        organizationsCreated += 1;
      }

      await client.query(
        `
          INSERT INTO tenant (id, slug, name, phi_enabled)
          VALUES ($1::uuid, $2, $3, FALSE)
          ON CONFLICT (id)
          DO UPDATE SET
            slug = EXCLUDED.slug,
            name = EXCLUDED.name,
            updated_at = NOW()
        `,
        [organizationId, organizationSlug, organizationName],
      );

      await client.query(
        `
          INSERT INTO org_subscription (organization_id, plan_code, status, provider)
          VALUES ($1::uuid, 'synthetic_test_plan', $2, 'manual')
          ON CONFLICT (organization_id)
          DO UPDATE SET
            status = EXCLUDED.status,
            updated_at = NOW()
        `,
        [organizationId, subscriptionStatus],
      );

      for (let userIndex = 1; userIndex <= args.usersPerOrg; userIndex += 1) {
        const authSubject = `${args.prefix}-org${orgIndex}-user${userIndex}`;
        const email = `${args.prefix}+org${orgIndex}user${userIndex}@unityappeals.local`;
        const displayName = `Synthetic User ${orgIndex}-${userIndex}`;
        const role = roles[(userIndex - 1) % roles.length];
        const appUserId = stableUuid(`app-user:${organizationId}:${authSubject}`);

        const userInsert = await client.query(
          `
            INSERT INTO user_identity (auth_subject, email, display_name, home_organization_id)
            VALUES ($1, $2, $3, $4::uuid)
            ON CONFLICT (auth_subject)
            DO UPDATE SET
              email = EXCLUDED.email,
              display_name = EXCLUDED.display_name,
              home_organization_id = EXCLUDED.home_organization_id,
              updated_at = NOW()
            RETURNING (xmax = 0) AS inserted
          `,
          [authSubject, email, displayName, organizationId],
        );
        if (userInsert.rows[0]?.inserted) {
          usersCreated += 1;
        }

        await client.query(
          `
            INSERT INTO organization_membership (organization_id, auth_subject, role, status)
            VALUES ($1::uuid, $2, $3, 'active')
            ON CONFLICT (organization_id, auth_subject)
            DO UPDATE SET
              role = EXCLUDED.role,
              status = 'active',
              updated_at = NOW()
          `,
          [organizationId, authSubject, role],
        );

        await client.query(
          `
            INSERT INTO onboarding_state (auth_subject, organization_id, legal_name, job_title, organization_name, phone, completed_at)
            VALUES ($1, $2::uuid, $3, 'Prior Authorization Specialist', $4, '555-0100', NOW())
            ON CONFLICT (auth_subject)
            DO UPDATE SET
              organization_id = EXCLUDED.organization_id,
              legal_name = EXCLUDED.legal_name,
              organization_name = EXCLUDED.organization_name,
              completed_at = COALESCE(onboarding_state.completed_at, EXCLUDED.completed_at),
              updated_at = NOW()
          `,
          [authSubject, organizationId, displayName, organizationName],
        );

        await client.query(
          `
            INSERT INTO user_profile (auth_subject, salutation, first_name, last_name, timezone)
            VALUES ($1, 'Mx.', $2, $3, 'America/New_York')
            ON CONFLICT (auth_subject)
            DO UPDATE SET
              first_name = EXCLUDED.first_name,
              last_name = EXCLUDED.last_name,
              timezone = EXCLUDED.timezone,
              updated_at = NOW()
          `,
          [authSubject, `User${orgIndex}`, `Seed${userIndex}`],
        );

        await client.query(
          `
            INSERT INTO baa_acceptance (organization_id, auth_subject, legal_name, signer_email, version, accepted_at, ip_address, user_agent)
            SELECT $1::uuid, $2, $3, $4, 'synthetic-v1', NOW(), '127.0.0.1', 'synthetic-seed-script'
            WHERE NOT EXISTS (
              SELECT 1
              FROM baa_acceptance
              WHERE organization_id = $1::uuid
                AND auth_subject = $2
                AND version = 'synthetic-v1'
            )
          `,
          [organizationId, authSubject, displayName, email],
        );

        await client.query(
          `
            INSERT INTO app_user (id, tenant_id, auth_subject, email, display_name, role)
            VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6)
            ON CONFLICT (tenant_id, auth_subject)
            DO UPDATE SET
              email = EXCLUDED.email,
              display_name = EXCLUDED.display_name,
              role = EXCLUDED.role,
              updated_at = NOW()
          `,
          [appUserId, organizationId, authSubject, email, displayName, role],
        );

        for (let patientIndex = 1; patientIndex <= args.patientsPerUser; patientIndex += 1) {
          const caseId = stableUuid(`case:${organizationId}:${authSubject}:${patientIndex}`);
          const threadId = stableUuid(`thread:${organizationId}:${authSubject}:${patientIndex}`);
          const userMessageId = stableUuid(`message:user:${threadId}`);
          const assistantMessageId = stableUuid(`message:assistant:${threadId}`);
          const documentId = stableUuid(`generated:${threadId}`);
          const diagnosis = diagnosisPool[(patientIndex - 1) % diagnosisPool.length];
          const payer = payerPool[(patientIndex - 1) % payerPool.length];
          const patientName = `Synthetic Patient ${orgIndex}-${userIndex}-${patientIndex}`;
          const caseTitle = `[SYNTH] ${patientName} - ${diagnosis} - ${payer}`;

          const caseInsert = await client.query(
            `
              INSERT INTO patient_case (id, tenant_id, title, patient_name, insurer_name, status, created_by_user_id)
              VALUES ($1::uuid, $2::uuid, $3, $4, $5, 'open', $6::uuid)
              ON CONFLICT (id)
              DO UPDATE SET
                title = EXCLUDED.title,
                patient_name = EXCLUDED.patient_name,
                insurer_name = EXCLUDED.insurer_name,
                created_by_user_id = EXCLUDED.created_by_user_id,
                updated_at = NOW()
              RETURNING (xmax = 0) AS inserted
            `,
            [caseId, organizationId, caseTitle, patientName, payer, appUserId],
          );
          if (caseInsert.rows[0]?.inserted) {
            casesCreated += 1;
          }

          const threadInsert = await client.query(
            `
              INSERT INTO thread (id, tenant_id, patient_case_id, title, created_by_user_id, updated_at)
              VALUES (
                $1::uuid,
                $2::uuid,
                $3::uuid,
                $4,
                $5::uuid,
                NOW() - (($6::int - 1) * INTERVAL '6 minutes')
              )
              ON CONFLICT (id)
              DO UPDATE SET
                patient_case_id = EXCLUDED.patient_case_id,
                title = EXCLUDED.title,
                created_by_user_id = EXCLUDED.created_by_user_id,
                updated_at = EXCLUDED.updated_at
              RETURNING (xmax = 0) AS inserted
            `,
            [threadId, organizationId, caseId, caseTitle, appUserId, patientIndex],
          );
          if (threadInsert.rows[0]?.inserted) {
            threadsCreated += 1;
          }

          await client.query(
            `
              INSERT INTO message (id, tenant_id, thread_id, user_id, role, content, citations)
              VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'user', $5, '[]'::jsonb)
              ON CONFLICT (id) DO NOTHING
            `,
            [
              userMessageId,
              organizationId,
              threadId,
              appUserId,
              `Please draft an appeal for ${patientName}. Diagnosis: ${diagnosis}. Payer: ${payer}.`,
            ],
          );

          await client.query(
            `
              INSERT INTO message (id, tenant_id, thread_id, user_id, role, content, citations)
              VALUES ($1::uuid, $2::uuid, $3::uuid, NULL, 'assistant', $4, '[]'::jsonb)
              ON CONFLICT (id) DO NOTHING
            `,
            [
              assistantMessageId,
              organizationId,
              threadId,
              `Draft outline prepared for ${patientName}. Include policy alignment and comparative evidence.`,
            ],
          );

          await client.query(
            `
              INSERT INTO generated_document (id, tenant_id, thread_id, kind, version, content, citations, created_by_user_id)
              VALUES ($1::uuid, $2::uuid, $3::uuid, 'appeal', 1, $4, '[]'::jsonb, $5::uuid)
              ON CONFLICT (id)
              DO UPDATE SET
                content = EXCLUDED.content,
                created_by_user_id = EXCLUDED.created_by_user_id
            `,
            [
              documentId,
              organizationId,
              threadId,
              `**Subject:** Synthetic appeal for ${patientName}\n\nDiagnosis: ${diagnosis}\nPayer: ${payer}\n\nThis is non-production synthetic data for UI validation only.`,
              appUserId,
            ],
          );
        }
      }
    }

    await client.query("COMMIT");

    console.log("synthetic seed complete");
    console.log(
      JSON.stringify(
        {
          prefix: args.prefix,
          organizationsTarget: args.orgs,
          usersPerOrg: args.usersPerOrg,
          patientsPerUser: args.patientsPerUser,
          organizationsCreated,
          usersCreated,
          casesCreated,
          threadsCreated,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

seed().catch((error) => {
  console.error("synthetic seed failed", error);
  process.exit(1);
});
