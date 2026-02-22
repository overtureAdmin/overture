import { execFileSync, spawnSync } from "node:child_process";

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    const current = argv[i];
    if (current === "--admin-secret-id") {
      out.adminSecretId = argv[i + 1];
      i += 1;
      continue;
    }
    if (current === "--app-secret-id") {
      out.appSecretId = argv[i + 1];
      i += 1;
      continue;
    }
    if (current === "--migrator-secret-id") {
      out.migratorSecretId = argv[i + 1];
      i += 1;
      continue;
    }
    if (current === "--region") {
      out.region = argv[i + 1];
      i += 1;
      continue;
    }
    if (current === "--ssl") {
      out.ssl = argv[i + 1];
      i += 1;
      continue;
    }
  }
  return out;
}

function requireArg(name, value) {
  if (!value) {
    console.error(`Missing required argument: ${name}`);
    process.exit(1);
  }
  return value;
}

function readSecretJson(secretId, region) {
  const args = ["secretsmanager", "get-secret-value", "--secret-id", secretId, "--query", "SecretString", "--output", "text"];
  if (region) {
    args.push("--region", region);
  }
  const raw = execFileSync("aws", args, { encoding: "utf8" }).trim();
  return JSON.parse(raw);
}

function requireField(secret, name, label) {
  const value = secret[name];
  if (!value || typeof value !== "string") {
    console.error(`Secret ${label} is missing required field "${name}".`);
    process.exit(1);
  }
  return value;
}

const args = parseArgs(process.argv);
const adminSecretId = requireArg("--admin-secret-id", args.adminSecretId);
const appSecretId = requireArg("--app-secret-id", args.appSecretId);
const migratorSecretId = requireArg("--migrator-secret-id", args.migratorSecretId);

const adminSecret = readSecretJson(adminSecretId, args.region);
const appSecret = readSecretJson(appSecretId, args.region);
const migratorSecret = readSecretJson(migratorSecretId, args.region);

const host = requireField(adminSecret, "host", adminSecretId);
const dbName = requireField(adminSecret, "dbname", adminSecretId);
const port = String(adminSecret.port ?? "5432");

const env = {
  ...process.env,
  DATABASE_HOST: host,
  DATABASE_PORT: port,
  DATABASE_NAME: dbName,
  DATABASE_USER: requireField(adminSecret, "username", adminSecretId),
  DATABASE_PASSWORD: requireField(adminSecret, "password", adminSecretId),
  DATABASE_SSL: args.ssl ?? process.env.DATABASE_SSL ?? "require",
  APP_DB_USER: requireField(appSecret, "username", appSecretId),
  APP_DB_PASSWORD: requireField(appSecret, "password", appSecretId),
  MIGRATOR_DB_USER: requireField(migratorSecret, "username", migratorSecretId),
  MIGRATOR_DB_PASSWORD: requireField(migratorSecret, "password", migratorSecretId),
};

const result = spawnSync("node", ["scripts/provision-db-roles.mjs"], {
  env,
  stdio: "inherit",
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
