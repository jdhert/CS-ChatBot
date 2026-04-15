import { Pool } from "pg";

let pool: Pool | undefined;

function parsePort(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

export function getVectorPool(): Pool {
  if (pool) {
    return pool;
  }

  const dbPassword = process.env.VECTOR_DB_PASSWORD;
  if (!dbPassword) {
    throw new Error("VECTOR_DB_PASSWORD environment variable is required but not set.");
  }

  pool = new Pool({
    host: process.env.VECTOR_DB_HOST ?? "localhost",
    port: parsePort(process.env.VECTOR_DB_PORT, 5432),
    database: process.env.VECTOR_DB_NAME ?? "ai2",
    user: process.env.VECTOR_DB_USER,
    password: dbPassword,
    ssl: process.env.VECTOR_DB_SSL === "true"
  });

  return pool;
}

export async function closeVectorPool(): Promise<void> {
  if (!pool) {
    return;
  }

  const currentPool = pool;
  pool = undefined;
  await currentPool.end();
}

