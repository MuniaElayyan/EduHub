import fs from "node:fs";
import path from "node:path";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { databaseUrl, strict, validateConfig } from "../config";
import * as schema from "./schema";

export type DB = NodePgDatabase<typeof schema>;

const g = globalThis as unknown as { __eduhubDb?: Promise<DB> };

async function init(): Promise<DB> {
  validateConfig();
  if (databaseUrl()) {
    const { Pool } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    // On serverless hosts every running instance has its own pool, so each one stays small and lets idle
    // connections go quickly. Use the provider's pooled address (PgBouncer) as DATABASE_URL there.
    const serverless = !!process.env.VERCEL;
    const pool = new Pool({
      connectionString: databaseUrl(),
      max: Number(process.env.DATABASE_POOL_MAX ?? (serverless ? 3 : 10)),
      idleTimeoutMillis: serverless ? 10_000 : 30_000,
      connectionTimeoutMillis: 10_000,
    });
    pool.on("error", (err) => console.error("database pool error", err.message));
    return drizzle(pool, { schema });
  }

  if (strict) throw new Error("DATABASE_URL is required in production.");

  // Development: embedded Postgres, no install needed. Migrations are applied on start.
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const dir = path.join(process.cwd(), ".data", "pg");
  fs.mkdirSync(dir, { recursive: true });
  const db = drizzle(new PGlite(dir), { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  return db as unknown as DB;
}

export function getDb(): Promise<DB> {
  return (g.__eduhubDb ??= init());
}

export { schema };
