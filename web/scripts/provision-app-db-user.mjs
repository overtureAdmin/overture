import pg from "pg";

const { Client } = pg;

const required = [
  "DATABASE_HOST",
  "DATABASE_PORT",
  "DATABASE_NAME",
  "DATABASE_USER",
  "DATABASE_PASSWORD",
  "APP_DB_USER",
  "APP_DB_PASSWORD",
];

for (const key of required) {
  if (!process.env[key]) {
    console.error(`Missing required env var: ${key}`);
    process.exit(1);
  }
}

function quoteIdent(value) {
  return `"${value.replace(/"/g, '""')}"`;
}

function quoteLiteral(value) {
  return `'${value.replace(/'/g, "''")}'`;
}

const dbName = process.env.DATABASE_NAME;
const appDbUser = process.env.APP_DB_USER;
const appDbPassword = process.env.APP_DB_PASSWORD;

const client = new Client({
  host: process.env.DATABASE_HOST,
  port: Number(process.env.DATABASE_PORT),
  database: dbName,
  user: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
  ssl: process.env.DATABASE_SSL === "require" ? { rejectUnauthorized: false } : undefined,
});

await client.connect();

try {
  await client.query(`
    DO $$
    DECLARE
      app_user text := ${quoteLiteral(appDbUser)};
      app_pass text := ${quoteLiteral(appDbPassword)};
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = app_user) THEN
        EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L', app_user, app_pass);
      ELSE
        EXECUTE format('ALTER ROLE %I WITH LOGIN PASSWORD %L', app_user, app_pass);
      END IF;
    END
    $$;
  `);

  await client.query(`GRANT CONNECT ON DATABASE ${quoteIdent(dbName)} TO ${quoteIdent(appDbUser)};`);
  await client.query(`GRANT USAGE ON SCHEMA public TO ${quoteIdent(appDbUser)};`);
  await client.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${quoteIdent(appDbUser)};`
  );
  await client.query(
    `GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO ${quoteIdent(appDbUser)};`
  );
  await client.query(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${quoteIdent(appDbUser)};`
  );
  await client.query(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO ${quoteIdent(appDbUser)};`
  );

  console.log(`Provisioned least-privilege role ${appDbUser}.`);
} finally {
  await client.end();
}
