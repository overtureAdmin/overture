import { Pool } from "pg";
import { optionalEnv, requireEnv } from "@/lib/env";

declare global {
  // eslint-disable-next-line no-var
  var __unityAppealsDbPool: Pool | undefined;
}

export function getDbPool(): Pool {
  if (!global.__unityAppealsDbPool) {
    const sslMode = optionalEnv("DATABASE_SSL");
    const connectionString = optionalEnv("DATABASE_URL");

    const useConnectionString = connectionString && connectionString.length > 0;
    global.__unityAppealsDbPool = new Pool({
      connectionString: useConnectionString ? connectionString : undefined,
      host: useConnectionString ? undefined : requireEnv("DATABASE_HOST"),
      port: useConnectionString ? undefined : Number(optionalEnv("DATABASE_PORT") ?? "5432"),
      database: useConnectionString ? undefined : requireEnv("DATABASE_NAME"),
      user: useConnectionString ? undefined : requireEnv("DATABASE_USER"),
      password: useConnectionString ? undefined : requireEnv("DATABASE_PASSWORD"),
      ssl: sslMode === "require" ? { rejectUnauthorized: false } : undefined,
      max: 5,
    });
  }
  return global.__unityAppealsDbPool;
}
