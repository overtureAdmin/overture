import pg from "pg";

const { Client } = pg;

const requiredRoleVars = [
  "APP_DB_USER",
  "APP_DB_PASSWORD",
  "MIGRATOR_DB_USER",
  "MIGRATOR_DB_PASSWORD",
];

for (const key of requiredRoleVars) {
  if (!process.env[key]) {
    console.error(`Missing required env var: ${key}`);
    process.exit(1);
  }
}

const hasAdminUrl = Boolean(process.env.ADMIN_DATABASE_URL);
const requiredAdminParts = ["DATABASE_HOST", "DATABASE_PORT", "DATABASE_NAME", "DATABASE_USER", "DATABASE_PASSWORD"];
if (!hasAdminUrl) {
  for (const key of requiredAdminParts) {
    if (!process.env[key]) {
      console.error(`Missing required env var: ${key} (or provide ADMIN_DATABASE_URL).`);
      process.exit(1);
    }
  }
}

function quoteIdent(value) {
  return `"${value.replace(/"/g, '""')}"`;
}

function quoteLiteral(value) {
  return `'${value.replace(/'/g, "''")}'`;
}

const dbName = process.env.DATABASE_NAME ?? process.env.APP_DATABASE_NAME ?? "unity_appeals";
const appDbUser = process.env.APP_DB_USER;
const appDbPassword = process.env.APP_DB_PASSWORD;
const migratorDbUser = process.env.MIGRATOR_DB_USER;
const migratorDbPassword = process.env.MIGRATOR_DB_PASSWORD;

const client = new Client({
  connectionString: process.env.ADMIN_DATABASE_URL,
  host: process.env.ADMIN_DATABASE_URL ? undefined : process.env.DATABASE_HOST,
  port: process.env.ADMIN_DATABASE_URL ? undefined : Number(process.env.DATABASE_PORT),
  database: process.env.ADMIN_DATABASE_URL ? undefined : dbName,
  user: process.env.ADMIN_DATABASE_URL ? undefined : process.env.DATABASE_USER,
  password: process.env.ADMIN_DATABASE_URL ? undefined : process.env.DATABASE_PASSWORD,
  ssl: process.env.DATABASE_SSL === "require" ? { rejectUnauthorized: false } : undefined,
});

await client.connect();

try {
  async function safeQuery(sql, label) {
    try {
      await client.query(sql);
    } catch (error) {
      const code = error?.code;
      if (code === "42501") {
        console.warn(`Skipping ${label}: insufficient privilege (${code}).`);
        return;
      }
      throw error;
    }
  }

  await client.query(`
    DO $$
    DECLARE
      app_user text := ${quoteLiteral(appDbUser)};
      app_pass text := ${quoteLiteral(appDbPassword)};
      migrator_user text := ${quoteLiteral(migratorDbUser)};
      migrator_pass text := ${quoteLiteral(migratorDbPassword)};
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = app_user) THEN
        EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L', app_user, app_pass);
      ELSE
        EXECUTE format('ALTER ROLE %I WITH LOGIN PASSWORD %L', app_user, app_pass);
      END IF;

      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = migrator_user) THEN
        EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L', migrator_user, migrator_pass);
      ELSE
        EXECUTE format('ALTER ROLE %I WITH LOGIN PASSWORD %L', migrator_user, migrator_pass);
      END IF;
    END
    $$;
  `);

  await client.query(`GRANT CONNECT ON DATABASE ${quoteIdent(dbName)} TO ${quoteIdent(appDbUser)};`);
  await client.query(`GRANT CONNECT ON DATABASE ${quoteIdent(dbName)} TO ${quoteIdent(migratorDbUser)};`);

  await client.query(`GRANT USAGE ON SCHEMA public TO ${quoteIdent(appDbUser)};`);
  await client.query(`GRANT USAGE, CREATE ON SCHEMA public TO ${quoteIdent(migratorDbUser)};`);
  await client.query(`ALTER SCHEMA public OWNER TO ${quoteIdent(migratorDbUser)};`);

  await client.query(`
    DO $$
    DECLARE
      obj record;
      migrator_user text := ${quoteLiteral(migratorDbUser)};
    BEGIN
      FOR obj IN
        SELECT tablename
        FROM pg_tables
        WHERE schemaname = 'public'
      LOOP
        EXECUTE format('ALTER TABLE public.%I OWNER TO %I', obj.tablename, migrator_user);
      END LOOP;
    END
    $$;
  `);

  await client.query(`
    DO $$
    DECLARE
      obj record;
      migrator_user text := ${quoteLiteral(migratorDbUser)};
    BEGIN
      FOR obj IN
        SELECT sequencename
        FROM pg_sequences
        WHERE schemaname = 'public'
      LOOP
        EXECUTE format('ALTER SEQUENCE public.%I OWNER TO %I', obj.sequencename, migrator_user);
      END LOOP;
    END
    $$;
  `);

  await client.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${quoteIdent(appDbUser)};`,
  );
  await client.query(
    `GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO ${quoteIdent(appDbUser)};`,
  );

  await safeQuery(
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${quoteIdent(migratorDbUser)} IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${quoteIdent(appDbUser)};`,
    "default table privileges grant",
  );
  await safeQuery(
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${quoteIdent(migratorDbUser)} IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO ${quoteIdent(appDbUser)};`,
    "default sequence privileges grant",
  );

  console.log(`Provisioned DB roles app=${appDbUser} migrator=${migratorDbUser}.`);
} finally {
  await client.end();
}
