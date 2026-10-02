// Applies pending migrations (schema, then reference data) to PostgreSQL. Runs before every production build.
// Uses the direct, unpooled address when the host provides one: migrations should not go through PgBouncer.
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const env = process.env;
const url = env.DATABASE_URL_UNPOOLED || env.POSTGRES_URL_NON_POOLING || env.DATABASE_URL || env.POSTGRES_URL;

if (!url) {
  // A preview build without a database can still build; a production build cannot go live without one.
  if (env.VERCEL && env.VERCEL_ENV !== "production") {
    console.warn("No DATABASE_URL for this environment: skipping migrations.");
    process.exit(0);
  }
  console.error("DATABASE_URL is not set. Add it to the project's environment variables (Production), then redeploy.");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: url, max: 1 });
try {
  await migrate(drizzle(pool), { migrationsFolder: path.join(process.cwd(), "drizzle") });
  const { rows } = await pool.query("select (select count(*) from subjects) as subjects, (select count(*) from section_types) as section_types");
  console.log(`Migrations applied. Reference data: ${rows[0].subjects} subjects, ${rows[0].section_types} section types.`);
} finally {
  await pool.end();
}
