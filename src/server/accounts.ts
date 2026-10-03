import { eq } from "drizzle-orm";
import { academicYears } from "@/lib/constants";
import { getDb } from "./db";
import { notifications, users, type User } from "./db/schema";
import { buildWorkspace, teaching } from "./services/courses";

/**
 * Makes an account live and creates its classes from the subjects and grades it registered with.
 * `emailProven` is true only when the address was actually demonstrated: a reset code, or a provider
 * that verified it (Google). A plain registration does not prove the address.
 */
export async function activateAccount(userId: string, emailProven: boolean): Promise<User> {
  const db = await getDb();
  const [user] = await db
    .update(users)
    .set({ status: "active", updatedAt: new Date(), ...(emailProven ? { emailVerifiedAt: new Date() } : {}) })
    .where(eq(users.id, userId))
    .returning();
  const t = await teaching(userId);
  await buildWorkspace(userId, t.subjects, t.grades, user.academicYear ?? academicYears()[1]);
  await db.insert(notifications).values({ userId, type: "welcome" });
  return user;
}

/** Accounts left waiting for an email code by an earlier version go live the next time they are seen. */
export async function settleLegacy(user: User): Promise<User> {
  return user.status === "pending_email" ? activateAccount(user.id, false) : user;
}
