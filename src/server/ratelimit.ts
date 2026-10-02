import { sql } from "drizzle-orm";
import { getDb } from "./db";

/**
 * Fixed-window rate limiter backed by the database, so every instance of the app shares the same counters.
 * One statement both counts the attempt and reports the total: a window that has ended starts again at 1.
 */
export async function rateLimit(key: string, max: number, windowMs: number): Promise<{ ok: boolean; retryAfter: number }> {
  const db = await getDb();
  const resetAt = new Date(Date.now() + windowMs).toISOString();
  const result = await db.execute<{ count: number; reset_at: string | Date }>(sql`
    insert into rate_limits (key, count, reset_at) values (${key}, 1, ${resetAt}::timestamptz)
    on conflict (key) do update set
      count = case when rate_limits.reset_at <= now() then 1 else rate_limits.count + 1 end,
      reset_at = case when rate_limits.reset_at <= now() then excluded.reset_at else rate_limits.reset_at end
    returning count, reset_at
  `);
  const row = result.rows[0];
  const retryAfter = Math.max(1, Math.ceil((new Date(row.reset_at).getTime() - Date.now()) / 1000));
  return { ok: Number(row.count) <= max, retryAfter };
}
