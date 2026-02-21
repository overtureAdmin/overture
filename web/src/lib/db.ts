import { Pool } from "pg";
import { optionalEnv, requireEnv } from "@/lib/env";

declare global {
  // eslint-disable-next-line no-var
  var __unityAppealsDbPool: Pool | undefined;
}

export function getDbPool(): Pool {
  if (!global.__unityAppealsDbPool) {
    const sslMode = optionalEnv("DATABASE_SSL");
    global.__unityAppealsDbPool = new Pool({
      connectionString: requireEnv("DATABASE_URL"),
      ssl: sslMode === "require" ? { rejectUnauthorized: false } : undefined,
      max: 5,
    });
  }
  return global.__unityAppealsDbPool;
}
