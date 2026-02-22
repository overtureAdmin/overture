import { execFileSync, spawnSync } from "node:child_process";

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    const current = argv[i];
    if (current === "--secret-id") {
      out.secretId = argv[i + 1];
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
const secretId = requireArg("--secret-id", args.secretId);
const secret = readSecretJson(secretId, args.region);

const env = {
  ...process.env,
  DATABASE_HOST: requireField(secret, "host", secretId),
  DATABASE_PORT: String(secret.port ?? "5432"),
  DATABASE_NAME: requireField(secret, "dbname", secretId),
  DATABASE_USER: requireField(secret, "username", secretId),
  DATABASE_PASSWORD: requireField(secret, "password", secretId),
  DATABASE_SSL: args.ssl ?? process.env.DATABASE_SSL ?? "require",
};

const result = spawnSync("node", ["scripts/run-migrations.mjs"], {
  env,
  stdio: "inherit",
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
