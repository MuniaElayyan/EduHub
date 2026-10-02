import { randomUUID } from "node:crypto";
import { and, count, desc, eq, isNull, lt } from "drizzle-orm";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { after } from "next/server";
import { z } from "zod";
import { COLORS, FILE_TYPES, LOCALES, RESOURCE_TYPES, SECTION_ICONS, THEMES, academicYears } from "@/lib/constants";
import { asLocale } from "@/lib/i18n";
import { inspectLink } from "@/lib/links";
import {
  audit, checkCode, consumeResetTicket, createResetTicket, createSession, getPasswordHash, hashPassword, issueCode,
  nationalIdLast4, nationalIdTaken, parseNationalId, publicUser, readSession, revokeSessions, saveNationalId,
  SESSION_COOKIE, sessionCookieOptions, setPassword, verifyPassword, CODE_RESEND_SECONDS, type CodePurpose,
} from "./auth";
import { appUrl, googleConfigured, secureCookies, storageUsable } from "./config";
import { getDb } from "./db";
import {
  files, notifications, oauthAccounts, passwordResets, rateLimits, sessions, teacherGrades, teacherSubjects, userCredentials, users, verificationCodes,
  type Session, type User,
} from "./db/schema";
import { sendCodeEmail, sendNoticeEmail } from "./email";
import { googleProfile, googleStart, OAUTH_COOKIE, readOAuthCookie } from "./oauth";
import { rateLimit } from "./ratelimit";
import { AI_ACTIONS, aiAvailable, chatStream, withinDailyLimit } from "./services/ai";
import { suggest } from "./services/classify";
import {
  addUnit, archiveCourse, buildWorkspace, createCourse, createSection, deleteSection, deleteUnit, listCourses,
  listSections, listSemesters, listSubjects, listUnits, renameUnit, teaching, updateSection,
} from "./services/courses";
import {
  createResource, deleteForever, duplicateResource, getResource, listResources, markOpened, reorderResources,
  setFavorite, setTrashed, storageUsed, updateResource,
} from "./services/resources";
import { storage } from "./storage";

type Env = { Variables: { user: User; session: Session; ip: string } };

class ApiError extends Error {
  constructor(public status: number, public code: string, public extra?: Record<string, unknown>) {
    super(code);
  }
}

export const api = new Hono<Env>().basePath("/api/v1");

api.onError((err, c) => {
  if (err instanceof ApiError) return c.json({ error: { code: err.code, ...err.extra } }, err.status as 400);
  if (err instanceof z.ZodError) return c.json({ error: { code: "invalid_input", fields: err.issues.map((i) => i.path.join(".")) } }, 400);
  if (err instanceof SyntaxError) return c.json({ error: { code: "invalid_input" } }, 400);
  console.error(err);
  return c.json({ error: { code: "server_error" } }, 500);
});
api.notFound((c) => c.json({ error: { code: "not_found" } }, 404));

/* ── Cross-cutting ─────────────────────────────────────────────────── */

api.use("*", async (c, next) => {
  // X-Forwarded-For is a list the client can prepend to. Only the entries added by our own proxies are trusted:
  // with one proxy in front (the usual case) that is the last entry.
  const forwarded = (c.req.header("x-forwarded-for") ?? "").split(",").map((v) => v.trim()).filter(Boolean);
  c.set("ip", forwarded.at(-Math.max(1, Number(process.env.TRUSTED_PROXY_HOPS ?? 1))) ?? "unknown");
  // CSRF: a request that changes something must come from this site (cookies are SameSite=Lax as well).
  // One exception: the storage provider calls /uploads/blob itself when a direct upload finishes. That call has no
  // Origin; the SDK verifies its signature, and token requests on the same route check the session themselves.
  if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method) && !c.req.path.endsWith("/uploads/blob")) {
    const host = c.req.header("x-forwarded-host") ?? c.req.header("host");
    let originHost: string | null = null;
    try {
      originHost = new URL(c.req.header("origin") ?? "").host;
    } catch {
      /* missing or malformed origin */
    }
    if (!originHost || originHost !== host) throw new ApiError(403, "bad_origin");
  }
  await next();
  c.header("Cache-Control", c.res.headers.get("Cache-Control") ?? "no-store");
});

/** Requires a session. By default the account must be active (email confirmed, profile complete). */
const auth = (opts: { anyStatus?: boolean } = {}) =>
  createMiddleware<Env>(async (c, next) => {
    const found = await readSession(getCookie(c, SESSION_COOKIE), { rotate: true });
    if (!found) throw new ApiError(401, "unauthenticated");
    // Rotation: the browser must get the replacement token on this very response, whatever kind of response it is.
    // Set before the handler runs, it reaches JSON and error replies; streamed replies (file downloads, the
    // assistant) are built separately, so it is added to those again once the handler has produced them.
    const rotate = () => setCookie(c, SESSION_COOKIE, found.newToken!, sessionCookieOptions(found.session.remember));
    if (found.newToken) rotate();
    if (found.user.status === "suspended") throw new ApiError(403, "account_suspended");
    if (!opts.anyStatus && found.user.status !== "active") throw new ApiError(403, found.user.status === "pending_email" ? "email_not_verified" : "profile_incomplete");
    c.set("user", found.user);
    c.set("session", found.session);
    await next();
    if (found.newToken && !c.res.headers.getSetCookie().some((v) => v.startsWith(`${SESSION_COOKIE}=`))) rotate();
  });

const limit = async (key: string, max: number, windowMs: number) => {
  if (!(await rateLimit(key, max, windowMs)).ok) throw new ApiError(429, "too_many_requests");
};

/**
 * Work that should not delay the reply (notice emails, housekeeping). On serverless hosts a function can be
 * frozen the moment it answers, so the work is handed to the platform to finish instead of being left floating.
 */
const background = (work: () => Promise<unknown>) => after(() => work().catch((e) => console.error(e)));

const MIN = 60_000;
const uuid = z.uuid();
const trimmed = (min: number, max: number) => z.string().trim().min(min).max(max);
const optionalText = (max: number) => z.string().trim().max(max).nullish().transform((v) => v || null);
const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));
const passwordSchema = z.string().min(8).max(200);
const codeSchema = z.string().trim().regex(/^\d{6}$/);
const yearSchema = z.string().regex(/^\d{4}\/\d{4}$/);
const gradesSchema = z.array(z.number().int().min(1).max(12)).min(1).max(12).transform((v) => [...new Set(v)].sort((a, b) => a - b));

/** The teacher's profile: everything asked at registration except the credentials. */
const profileSchema = z.object({
  firstName: trimmed(1, 60), secondName: trimmed(1, 60), thirdName: trimmed(1, 60), lastName: trimmed(1, 60),
  gender: z.enum(["male", "female"]),
  nationalId: z.string().max(40),
  schoolName: trimmed(2, 150),
  subjects: z.array(z.string().max(60)).min(1).max(40).transform((v) => [...new Set(v)]),
  grades: gradesSchema,
  academicYear: yearSchema,
  locale: z.enum(LOCALES).default("ar"),
  theme: z.enum(THEMES).default("system"),
});

async function checkedProfile<P extends z.infer<typeof profileSchema>>(input: P) {
  const known = new Set((await listSubjects()).map((s) => s.code));
  if (!input.subjects.every((s) => known.has(s))) throw new ApiError(400, "invalid_input", { fields: ["subjects"] });
  const nationalId = parseNationalId(input.nationalId);
  if (!nationalId) throw new ApiError(400, "invalid_national_id");
  return { ...input, nationalId };
}

async function startSession(c: Parameters<typeof setCookie>[0], userId: string, remember: boolean) {
  const token = await createSession(userId, { remember, userAgent: c.req.header("user-agent"), ip: c.get("ip") });
  setCookie(c, SESSION_COOKIE, token, sessionCookieOptions(remember));
}

/** Creates a code and emails it. Delivery problems surface as an error the screen can explain. */
async function sendCode(user: Pick<User, "id" | "locale">, purpose: CodePurpose, to: string) {
  const issued = await issueCode(user.id, purpose, to);
  if (!issued.ok) throw new ApiError(429, issued.reason === "cooldown" ? "code_cooldown" : "code_limit", { retryAfter: issued.retryAfter });
  try {
    await sendCodeEmail(to, purpose, issued.code, asLocale(user.locale));
  } catch (err) {
    console.error(err);
    throw new ApiError(502, "email_failed");
  }
}

/** Email confirmed and profile complete: the account goes live and its classes are created. */
async function activate(userId: string) {
  const db = await getDb();
  const [user] = await db.update(users).set({ status: "active", emailVerifiedAt: new Date(), updatedAt: new Date() }).where(eq(users.id, userId)).returning();
  const t = await teaching(userId);
  await buildWorkspace(userId, t.subjects, t.grades, user.academicYear ?? academicYears()[1]);
  await db.insert(notifications).values({ userId, type: "welcome" });
  return user;
}

/**
 * Housekeeping, run now and then from the sign-in paths: registrations that never confirmed their email are removed
 * after a week (with their national ID), and dead sessions, codes and reset tickets are cleared.
 */
let lastSweep = 0;
async function sweep() {
  if (Date.now() - lastSweep < 60 * MIN) return;
  lastSweep = Date.now();
  const db = await getDb();
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);
  await db.delete(users).where(and(eq(users.status, "pending_email"), lt(users.createdAt, weekAgo)));
  await db.delete(sessions).where(lt(sessions.expiresAt, weekAgo));
  await db.delete(verificationCodes).where(lt(verificationCodes.expiresAt, weekAgo));
  await db.delete(passwordResets).where(lt(passwordResets.expiresAt, weekAgo));
  await db.delete(rateLimits).where(lt(rateLimits.resetAt, weekAgo));
}

api.get("/health", async (c) => {
  await listSubjects();
  return c.json({ ok: true });
});

/** What the registration screen needs before anyone is signed in. */
api.get("/reference", async (c) => c.json({ subjects: await listSubjects(), academicYears: academicYears(), google: googleConfigured() }));

/* ── Registration and email confirmation ───────────────────────────── */

api.post("/auth/register", async (c) => {
  await limit(`register:${c.get("ip")}`, 10, 60 * MIN);
  background(sweep);
  const body = await checkedProfile(profileSchema.extend({ email: emailSchema, password: passwordSchema }).parse(await c.req.json()));
  const db = await getDb();

  const [existing] = await db.select().from(users).where(eq(users.email, body.email));
  if (existing?.emailVerifiedAt) throw new ApiError(409, "email_taken");
  // An address that was never confirmed does not belong to anyone yet: the new registration replaces it.
  if (existing) await db.delete(users).where(eq(users.id, existing.id));
  if (await nationalIdTaken(body.nationalId)) throw new ApiError(409, "national_id_taken");

  const { email, password, nationalId, subjects: subjectCodes, grades, ...profile } = body;
  const [user] = await db
    .insert(users)
    .values({ email, ...profile, status: "pending_email", storageQuotaBytes: Number(process.env.DEFAULT_QUOTA_GB ?? 2) * 1024 ** 3 })
    .returning();
  await setPassword(user.id, password);
  await saveNationalId(user.id, nationalId);
  await db.insert(teacherSubjects).values(subjectCodes.map((subjectCode) => ({ userId: user.id, subjectCode })));
  await db.insert(teacherGrades).values(grades.map((grade) => ({ userId: user.id, grade })));

  await startSession(c, user.id, false);
  await audit({ userId: user.id, action: "auth.register", ip: c.get("ip") });
  await sendCode(user, "verify_email", user.email);
  return c.json({ user: publicUser(user), resendIn: CODE_RESEND_SECONDS }, 201);
});

api.post("/auth/verify-email", auth({ anyStatus: true }), async (c) => {
  const user = c.get("user");
  await limit(`verify:${user.id}`, 20, 15 * MIN);
  const { code } = z.object({ code: codeSchema }).parse(await c.req.json());
  if (user.status !== "pending_email") return c.json({ user: publicUser(user) });
  const result = await checkCode(user.id, "verify_email", code);
  if (!result.ok) throw new ApiError(400, result.reason === "expired" ? "code_expired" : "invalid_code");
  const active = await activate(user.id);
  await audit({ userId: user.id, action: "auth.email_verified", ip: c.get("ip") });
  return c.json({ user: publicUser(active) });
});

api.post("/auth/resend-code", auth({ anyStatus: true }), async (c) => {
  const user = c.get("user");
  if (user.status !== "pending_email") return c.json({ ok: true });
  await sendCode(user, "verify_email", user.email);
  return c.json({ ok: true, resendIn: CODE_RESEND_SECONDS });
});

/* ── Sign in, sign out ─────────────────────────────────────────────── */

const DUMMY_HASH = hashPassword("not-a-real-password");

api.post("/auth/login", async (c) => {
  const body = z.object({ email: emailSchema, password: z.string().min(1).max(200), remember: z.boolean().default(false) }).parse(await c.req.json());
  await limit(`login:${c.get("ip")}:${body.email}`, 10, 15 * MIN);
  background(sweep);
  const db = await getDb();
  const [user] = await db.select().from(users).where(eq(users.email, body.email));
  const stored = user ? await getPasswordHash(user.id) : null;
  // Hash even when there is nothing to compare with, so timing does not reveal which addresses have accounts.
  const ok = await verifyPassword(body.password, stored ?? (await DUMMY_HASH));
  if (!user || !stored || !ok) {
    await audit({ userId: user?.id, action: "auth.login_failed", ip: c.get("ip") });
    throw new ApiError(401, "invalid_credentials");
  }
  if (user.status === "suspended") throw new ApiError(403, "account_suspended");
  await startSession(c, user.id, body.remember);
  await audit({ userId: user.id, action: "auth.login", meta: { remember: body.remember }, ip: c.get("ip") });
  return c.json({ user: publicUser(user) });
});

api.post("/auth/logout", async (c) => {
  const found = await readSession(getCookie(c, SESSION_COOKIE));
  if (found) await revokeSessions(found.user.id, { onlyId: found.session.id });
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

/* ── Forgotten password: email → code → new password ───────────────── */

api.post("/auth/forgot-password", async (c) => {
  await limit(`forgot:${c.get("ip")}`, 8, 15 * MIN);
  const { email } = z.object({ email: emailSchema }).parse(await c.req.json());
  const db = await getDb();
  const [user] = await db.select().from(users).where(eq(users.email, email));
  // Sent in the background and answered the same way either way, so the reply does not say whether the address has an account.
  if (user && user.status !== "suspended") {
    const ip = c.get("ip");
    background(async () => {
      await sendCode(user, "reset_password", user.email);
      await audit({ userId: user.id, action: "auth.reset_requested", ip });
    });
  }
  return c.json({ ok: true, resendIn: CODE_RESEND_SECONDS });
});

api.post("/auth/reset/verify-code", async (c) => {
  const { email, code } = z.object({ email: emailSchema, code: codeSchema }).parse(await c.req.json());
  await limit(`reset-code:${c.get("ip")}:${email}`, 10, 15 * MIN);
  const db = await getDb();
  const [user] = await db.select().from(users).where(eq(users.email, email));
  const result = user ? await checkCode(user.id, "reset_password", code) : ({ ok: false, reason: "invalid" } as const);
  if (!user || !result.ok) throw new ApiError(400, result.ok || result.reason === "invalid" ? "invalid_code" : "code_expired");
  return c.json({ ticket: await createResetTicket(user.id) });
});

api.post("/auth/reset/complete", async (c) => {
  await limit(`reset:${c.get("ip")}`, 10, 15 * MIN);
  const body = z.object({ ticket: trimmed(20, 200), password: passwordSchema }).parse(await c.req.json());
  const userId = await consumeResetTicket(body.ticket);
  if (!userId) throw new ApiError(400, "code_expired");
  await setPassword(userId, body.password);
  // Every device is signed out: whoever knew the old password, or held a session, is out.
  await revokeSessions(userId);
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  const db = await getDb();
  let [user] = await db.select().from(users).where(eq(users.id, userId));
  // The reset code proved the address, so an account that was still waiting for confirmation is confirmed.
  if (user.status === "pending_email") user = await activate(userId);
  await audit({ userId, action: "auth.password_reset", ip: c.get("ip") });
  background(() => sendNoticeEmail(user.email, "password_changed", asLocale(user.locale)));
  return c.json({ ok: true });
});

/* ── Google sign-in ────────────────────────────────────────────────── */

const oauthCookieOptions = () => ({ httpOnly: true, secure: secureCookies(), sameSite: "Lax" as const, path: "/api/v1/auth/oauth", maxAge: 600 });

api.get("/auth/oauth/google/start", (c) => {
  if (!googleConfigured()) throw new ApiError(404, "not_found");
  const { url, cookie } = googleStart(c.req.query("remember") === "1");
  setCookie(c, OAUTH_COOKIE, cookie, oauthCookieOptions());
  return c.redirect(url);
});

api.get("/auth/oauth/google/callback", async (c) => {
  const failed = () => c.redirect(`${appUrl()}/login?error=oauth`);
  if (!googleConfigured()) return failed();
  const saved = readOAuthCookie(getCookie(c, OAUTH_COOKIE));
  deleteCookie(c, OAUTH_COOKIE, { path: "/api/v1/auth/oauth" });
  const code = c.req.query("code");
  if (!saved || !code || c.req.query("state") !== saved.state) return failed();
  const profile = await googleProfile(code, saved.verifier, saved.nonce).catch(() => null);
  if (!profile) return failed();

  const db = await getDb();
  const [linked] = await db
    .select({ user: users })
    .from(oauthAccounts).innerJoin(users, eq(users.id, oauthAccounts.userId))
    .where(and(eq(oauthAccounts.provider, profile.provider), eq(oauthAccounts.providerUserId, profile.providerUserId)));
  let user = linked?.user;

  if (!user) {
    const [byEmail] = await db.select().from(users).where(eq(users.email, profile.email));
    if (byEmail) {
      // Same address, so the same person: link instead of creating a second account.
      user = byEmail;
      if (!byEmail.emailVerifiedAt) {
        // The address was registered but never confirmed. Whoever typed that password did not prove the address
        // is theirs, so the password and any sessions go before the Google owner is let in.
        await db.delete(userCredentials).where(eq(userCredentials.userId, byEmail.id));
        await revokeSessions(byEmail.id);
        user = await activate(byEmail.id);
      }
    } else {
      [user] = await db
        .insert(users)
        .values({
          email: profile.email, emailVerifiedAt: new Date(), status: "pending_profile",
          firstName: profile.firstName, lastName: profile.lastName,
          storageQuotaBytes: Number(process.env.DEFAULT_QUOTA_GB ?? 2) * 1024 ** 3,
        })
        .returning();
    }
    await db.insert(oauthAccounts).values({ userId: user.id, provider: profile.provider, providerUserId: profile.providerUserId });
  }
  if (user.status === "suspended") return failed();
  await startSession(c, user.id, saved.remember);
  await audit({ userId: user.id, action: "auth.login_google", ip: c.get("ip") });
  return c.redirect(`${appUrl()}${user.status === "active" ? "/app" : "/complete-profile"}`);
});

/** After a first Google sign-in: the teaching details Google cannot know. The email is not asked again. */
api.post("/auth/complete-profile", auth({ anyStatus: true }), async (c) => {
  const user = c.get("user");
  if (user.status !== "pending_profile") throw new ApiError(409, "already_complete");
  const body = await checkedProfile(profileSchema.parse(await c.req.json()));
  const { nationalId, subjects: subjectCodes, grades, ...profile } = body;
  if (!(await saveNationalId(user.id, nationalId))) throw new ApiError(409, "national_id_taken");
  const db = await getDb();
  await db.update(users).set({ ...profile, updatedAt: new Date() }).where(eq(users.id, user.id));
  await db.delete(teacherSubjects).where(eq(teacherSubjects.userId, user.id));
  await db.delete(teacherGrades).where(eq(teacherGrades.userId, user.id));
  await db.insert(teacherSubjects).values(subjectCodes.map((subjectCode) => ({ userId: user.id, subjectCode })));
  await db.insert(teacherGrades).values(grades.map((grade) => ({ userId: user.id, grade })));
  return c.json({ user: publicUser(await activate(user.id)) });
});

/* ── My account ────────────────────────────────────────────────────── */

api.get("/me", auth({ anyStatus: true }), async (c) => {
  const user = c.get("user");
  const db = await getDb();
  const providers = await db.select({ provider: oauthAccounts.provider }).from(oauthAccounts).where(eq(oauthAccounts.userId, user.id));
  return c.json({
    user: publicUser(user),
    hasPassword: !!(await getPasswordHash(user.id)),
    nationalIdLast4: await nationalIdLast4(user.id),
    providers: providers.map((p) => p.provider),
    teaching: await teaching(user.id),
    storage: { used: await storageUsed(user.id), quota: user.storageQuotaBytes },
  });
});

api.patch("/me", auth({ anyStatus: true }), async (c) => {
  const body = z
    .object({
      firstName: trimmed(1, 60), secondName: trimmed(1, 60), thirdName: trimmed(1, 60), lastName: trimmed(1, 60),
      gender: z.enum(["male", "female"]), schoolName: trimmed(2, 150), academicYear: yearSchema,
      locale: z.enum(LOCALES), theme: z.enum(THEMES), avatarFileId: uuid.nullable(),
    })
    .partial()
    .parse(await c.req.json());
  const db = await getDb();
  const [user] = await db.update(users).set({ ...body, updatedAt: new Date() }).where(eq(users.id, c.get("user").id)).returning();
  return c.json({ user: publicUser(user) });
});

api.post("/me/password", auth(), async (c) => {
  const user = c.get("user");
  await limit(`password:${user.id}`, 10, 15 * MIN);
  const body = z.object({ currentPassword: z.string().min(1).max(200), newPassword: passwordSchema }).parse(await c.req.json());
  const stored = await getPasswordHash(user.id);
  if (!stored) throw new ApiError(409, "no_password");
  if (!(await verifyPassword(body.currentPassword, stored))) throw new ApiError(403, "wrong_password");
  await setPassword(user.id, body.newPassword);
  await revokeSessions(user.id, { exceptId: c.get("session").id });
  await audit({ userId: user.id, action: "auth.password_changed", ip: c.get("ip") });
  background(() => sendNoticeEmail(user.email, "password_changed", asLocale(user.locale)));
  return c.json({ ok: true });
});

/** Changing the email: confirm the password, then prove the new address with a code. The old one stays until then. */
api.post("/me/email", auth(), async (c) => {
  const user = c.get("user");
  await limit(`email-change:${user.id}`, 10, 60 * MIN);
  const body = z.object({ password: z.string().min(1).max(200), newEmail: emailSchema }).parse(await c.req.json());
  const stored = await getPasswordHash(user.id);
  if (!stored) throw new ApiError(409, "no_password");
  if (!(await verifyPassword(body.password, stored))) throw new ApiError(403, "wrong_password");
  const db = await getDb();
  const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.email, body.newEmail));
  if (taken) throw new ApiError(409, "email_taken");
  await sendCode(user, "change_email", body.newEmail);
  return c.json({ ok: true, resendIn: CODE_RESEND_SECONDS });
});

api.post("/me/email/verify", auth(), async (c) => {
  const user = c.get("user");
  await limit(`email-verify:${user.id}`, 20, 15 * MIN);
  const { code } = z.object({ code: codeSchema }).parse(await c.req.json());
  const result = await checkCode(user.id, "change_email", code);
  if (!result.ok) throw new ApiError(400, result.reason === "expired" ? "code_expired" : "invalid_code");
  const db = await getDb();
  const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.email, result.targetEmail));
  if (taken) throw new ApiError(409, "email_taken");
  const [updated] = await db.update(users).set({ email: result.targetEmail, emailVerifiedAt: new Date(), updatedAt: new Date() }).where(eq(users.id, user.id)).returning();
  await audit({ userId: user.id, action: "auth.email_changed", ip: c.get("ip") });
  background(() => sendNoticeEmail(user.email, "email_changed", asLocale(user.locale)));
  return c.json({ user: publicUser(updated) });
});

api.get("/me/sessions", auth({ anyStatus: true }), async (c) => {
  const db = await getDb();
  const rows = await db
    .select().from(sessions)
    .where(and(eq(sessions.userId, c.get("user").id), isNull(sessions.revokedAt)))
    .orderBy(desc(sessions.lastUsedAt));
  const now = Date.now();
  return c.json({
    sessions: rows.filter((s) => s.expiresAt.getTime() > now).map((s) => ({
      id: s.id, userAgent: s.userAgent, remember: s.remember, createdAt: s.createdAt, lastUsedAt: s.lastUsedAt, current: s.id === c.get("session").id,
    })),
  });
});

api.delete("/me/sessions/:id", auth({ anyStatus: true }), async (c) => {
  await revokeSessions(c.get("user").id, { onlyId: uuid.parse(c.req.param("id")) });
  return c.json({ ok: true });
});

api.delete("/me/sessions", auth({ anyStatus: true }), async (c) => {
  return c.json({ revoked: await revokeSessions(c.get("user").id, { exceptId: c.get("session").id }) });
});

/* ── Classes, semesters, units, sections ───────────────────────────── */

api.get("/courses", auth(), async (c) => c.json({ courses: await listCourses(c.get("user").id) }));

api.post("/courses", auth(), async (c) => {
  const user = c.get("user");
  const body = z.object({ subjectCode: z.string().max(60), grade: z.number().int().min(1).max(12), color: z.enum(COLORS).optional() }).parse(await c.req.json());
  if (!(await listSubjects()).some((s) => s.code === body.subjectCode)) throw new ApiError(400, "invalid_input");
  const course = await createCourse(user.id, { ...body, academicYear: user.academicYear ?? academicYears()[1] });
  if (!course) throw new ApiError(409, "course_exists");
  return c.json({ course }, 201);
});

api.delete("/courses/:id", auth(), async (c) => {
  if (!(await archiveCourse(c.get("user").id, uuid.parse(c.req.param("id"))))) throw new ApiError(404, "not_found");
  return c.json({ ok: true });
});

api.get("/courses/:id/semesters", auth(), async (c) => c.json({ semesters: await listSemesters(c.get("user").id, uuid.parse(c.req.param("id"))) }));
api.get("/semesters/:id/units", auth(), async (c) => c.json({ units: await listUnits(c.get("user").id, uuid.parse(c.req.param("id"))) }));

api.post("/semesters/:id/units", auth(), async (c) => {
  const { title } = z.object({ title: optionalText(80) }).parse(await c.req.json());
  const unit = await addUnit(c.get("user").id, uuid.parse(c.req.param("id")), title);
  if (!unit) throw new ApiError(404, "not_found");
  return c.json({ unit }, 201);
});

api.patch("/units/:id", auth(), async (c) => {
  const { title } = z.object({ title: optionalText(80) }).parse(await c.req.json());
  const unit = await renameUnit(c.get("user").id, uuid.parse(c.req.param("id")), title);
  if (!unit) throw new ApiError(404, "not_found");
  return c.json({ unit });
});

api.delete("/units/:id", auth(), async (c) => {
  const result = await deleteUnit(c.get("user").id, uuid.parse(c.req.param("id")));
  if (result === "not_found") throw new ApiError(404, "not_found");
  if (result === "not_empty") throw new ApiError(409, "not_empty");
  return c.json({ ok: true });
});

api.get("/units/:id/sections", auth(), async (c) => c.json({ sections: await listSections(c.get("user").id, uuid.parse(c.req.param("id"))) }));

const sectionSchema = z.object({
  name: trimmed(1, 60), description: optionalText(300), icon: z.enum(SECTION_ICONS).default("folder"), color: z.enum(COLORS).default("green"),
});

api.post("/units/:id/sections", auth(), async (c) => {
  const section = await createSection(c.get("user").id, uuid.parse(c.req.param("id")), sectionSchema.parse(await c.req.json()));
  if (!section) throw new ApiError(404, "not_found");
  return c.json({ section }, 201);
});

api.patch("/sections/:id", auth(), async (c) => {
  const section = await updateSection(c.get("user").id, uuid.parse(c.req.param("id")), sectionSchema.partial().parse(await c.req.json()));
  if (!section) throw new ApiError(404, "not_found");
  return c.json({ section });
});

api.delete("/sections/:id", auth(), async (c) => {
  const result = await deleteSection(c.get("user").id, uuid.parse(c.req.param("id")));
  if (result === "not_found") throw new ApiError(404, "not_found");
  if (result === "not_empty") throw new ApiError(409, "not_empty");
  return c.json({ ok: true });
});

api.post("/sections/:id/reorder", auth(), async (c) => {
  const { ids } = z.object({ ids: z.array(uuid).max(500) }).parse(await c.req.json());
  if (!(await reorderResources(c.get("user").id, uuid.parse(c.req.param("id")), ids))) throw new ApiError(404, "not_found");
  return c.json({ ok: true });
});

/* ── Files ─────────────────────────────────────────────────────────── */

const at = (buf: Buffer, offset: number, ascii: string) => buf.subarray(offset, offset + ascii.length).toString("latin1") === ascii;
const isZip = (b: Buffer) => at(b, 0, "PK\x03\x04");
const isOle = (b: Buffer) => b.subarray(0, 4).toString("hex") === "d0cf11e0";
const isIsoMedia = (b: Buffer) => ["ftyp", "moov", "mdat", "wide", "free"].some((box) => at(b, 4, box));

/** The first bytes must match the extension, so a renamed file cannot pose as another type. */
const SIGNATURES: Record<string, (b: Buffer) => boolean> = {
  pdf: (b) => at(b, 0, "%PDF"),
  png: (b) => at(b, 1, "PNG"),
  jpg: (b) => b[0] === 0xff && b[1] === 0xd8,
  jpeg: (b) => b[0] === 0xff && b[1] === 0xd8,
  webp: (b) => at(b, 0, "RIFF") && at(b, 8, "WEBP"),
  docx: isZip, pptx: isZip, xlsx: isZip,
  doc: isOle, ppt: isOle, xls: isOle,
  mp4: isIsoMedia, mov: isIsoMedia,
};

const maxUploadBytes = () => Number(process.env.MAX_UPLOAD_MB ?? 100) * 1024 * 1024;
const IMAGE_MAX = 5 * 1024 * 1024;
const purposeSchema = z.enum(["resource", "image"]).default("resource");

/** Checks every upload has to pass before any byte is stored: a working store, an allowed type, size and quota. */
async function admit(user: User, name: string, size: number, purpose: "resource" | "image") {
  if (!storageUsable()) throw new ApiError(503, "storage_not_configured");
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const spec = FILE_TYPES[ext];
  if (!spec || (purpose === "image" && spec.type !== "image")) throw new ApiError(415, "unsupported_file_type");
  if (size <= 0) throw new ApiError(400, "invalid_input");
  if (size > (purpose === "image" ? IMAGE_MAX : maxUploadBytes())) throw new ApiError(413, "file_too_large");
  if ((await storageUsed(user.id)) + size > user.storageQuotaBytes) throw new ApiError(413, "quota_exceeded");
  return { ext, spec };
}

async function recordFile(user: User, key: string, name: string, ext: string, size: number) {
  const db = await getDb();
  const spec = FILE_TYPES[ext];
  const [row] = await db
    .insert(files)
    .values({ ownerId: user.id, storageKey: key, originalName: name.slice(0, 255), mime: spec.mimes[0], ext, sizeBytes: size })
    .returning();
  return { id: row.id, name: row.originalName, ext, mime: row.mime, size: row.sizeBytes, type: spec.type };
}

/** First step of every upload: is this file acceptable, and which way do its bytes travel? */
api.post("/uploads/start", auth(), async (c) => {
  const user = c.get("user");
  await limit(`upload:${user.id}`, 120, 10 * MIN);
  const body = z.object({ name: trimmed(1, 255), size: z.number().int().positive(), purpose: purposeSchema }).parse(await c.req.json());
  const { ext } = await admit(user, body.name, body.size, body.purpose);
  // Direct: the browser sends the file straight to the store under a name only this teacher may write to.
  if (storage().direct) return c.json({ mode: "direct", pathname: `${user.id}/${randomUUID()}.${ext}` });
  return c.json({ mode: "form" });
});

/** Upload through this server, for stores that take files from us (the local disk). */
api.post("/uploads", auth(), async (c) => {
  const user = c.get("user");
  if (storage().direct) throw new ApiError(400, "invalid_input");
  await limit(`upload:${user.id}`, 120, 10 * MIN);
  if (Number(c.req.header("content-length") ?? 0) > maxUploadBytes() + 1024 * 1024) throw new ApiError(413, "file_too_large");
  const form = await c.req.parseBody();
  const file = form.file;
  const purpose = purposeSchema.parse(form.purpose);
  if (!(file instanceof File)) throw new ApiError(400, "invalid_input");
  const { ext } = await admit(user, file.name, file.size, purpose);
  const data = Buffer.from(await file.arrayBuffer());
  if (!SIGNATURES[ext](data)) throw new ApiError(415, "unsupported_file_type");
  const key = `${user.id}/${randomUUID()}.${ext}`;
  await storage().put(key, data);
  return c.json({ file: await recordFile(user, key, file.name, ext, data.length) }, 201);
});

/**
 * Direct uploads, part one: hands the browser a short-lived token for exactly one file name inside the
 * teacher's own folder. The same address receives the store's "upload finished" call, which the SDK verifies.
 */
api.post("/uploads/blob", async (c) => {
  const body = await c.req.json();
  const signedIn = body?.type === "blob.generate-client-token" ? await readSession(getCookie(c, SESSION_COOKIE)) : null;
  if (body?.type === "blob.generate-client-token" && (!signedIn || signedIn.user.status !== "active")) throw new ApiError(401, "unauthenticated");
  if (!storage().direct) throw new ApiError(404, "not_found");
  const { handleUpload } = await import("@vercel/blob/client");
  try {
    const result = await handleUpload({
      body,
      request: c.req.raw,
      onBeforeGenerateToken: async (pathname) => {
        // Only the exact shape issued by /uploads/start: <this teacher's id>/<uuid>.<allowed extension>
        const match = pathname.match(/^([0-9a-f-]{36})\/[0-9a-f-]{36}\.([a-z0-9]{2,5})$/);
        if (!match || match[1] !== signedIn!.user.id || !FILE_TYPES[match[2]]) throw new Error("This file name is not allowed");
        return { maximumSizeInBytes: maxUploadBytes(), addRandomSuffix: false, validUntil: Date.now() + 30 * MIN };
      },
      // The file is recorded when the browser calls /uploads/complete, after its content has been checked.
      onUploadCompleted: async () => {},
    });
    return c.json(result);
  } catch (err) {
    console.error(err);
    throw new ApiError(400, "upload_failed");
  }
});

/** Direct uploads, part two: the file is in the store. Check what actually arrived, then record it. */
api.post("/uploads/complete", auth(), async (c) => {
  const user = c.get("user");
  const body = z.object({ pathname: z.string().max(120), name: trimmed(1, 255), purpose: purposeSchema }).parse(await c.req.json());
  const shape = body.pathname.match(/^([0-9a-f-]{36})\/[0-9a-f-]{36}\.([a-z0-9]{2,5})$/);
  if (!storage().direct || !shape || shape[1] !== user.id) throw new ApiError(400, "invalid_input");
  const db = await getDb();
  const [known] = await db.select({ id: files.id }).from(files).where(eq(files.storageKey, body.pathname));
  if (known) throw new ApiError(409, "invalid_input");
  const stored = await storage().head(body.pathname, 16);
  if (!stored) throw new ApiError(404, "not_found");
  const ext = body.pathname.split(".").pop()!;
  try {
    // The same checks as before the upload, now against the real size and the real first bytes.
    await admit(user, `file.${ext}`, stored.size, body.purpose);
    if (!SIGNATURES[ext](stored.start)) throw new ApiError(415, "unsupported_file_type");
  } catch (err) {
    await storage().delete(body.pathname).catch(() => {});
    throw err;
  }
  return c.json({ file: await recordFile(user, body.pathname, body.name, ext, stored.size) }, 201);
});

api.get("/files/:id", auth(), async (c) => {
  const db = await getDb();
  const [f] = await db.select().from(files).where(and(eq(files.id, uuid.parse(c.req.param("id"))), eq(files.ownerId, c.get("user").id)));
  if (!f) throw new ApiError(404, "not_found");

  const headers: Record<string, string> = {
    "Content-Type": f.mime,
    "Content-Disposition": `${c.req.query("download") ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(f.originalName)}`,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, max-age=3600",
    "Accept-Ranges": "bytes",
  };
  // Byte ranges let browsers seek inside videos.
  const range = c.req.header("range")?.match(/^bytes=(\d*)-(\d*)$/);
  if (range && (range[1] || range[2])) {
    const size = f.sizeBytes;
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start > end || start >= size) return c.body(null, 416, { "Content-Range": `bytes */${size}` });
    const part = await storage().open(f.storageKey, { start, end });
    if (!part) throw new ApiError(404, "not_found");
    if (part.partial) {
      return new Response(part.body, {
        status: 206,
        headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
      });
    }
    return new Response(part.body, { headers: { ...headers, "Content-Length": String(size) } });
  }
  const whole = await storage().open(f.storageKey);
  if (!whole) throw new ApiError(404, "not_found");
  return new Response(whole.body, { headers: { ...headers, "Content-Length": String(f.sizeBytes) } });
});

/* ── Resources ─────────────────────────────────────────────────────── */

const tagsSchema = z.array(trimmed(1, 40)).max(12).transform((v) => [...new Set(v)]);

api.get("/resources", auth(), async (c) => {
  const q = z
    .object({
      view: z.enum(["all", "favorites", "recent", "trash"]).optional(),
      courseId: uuid.optional(), semesterId: uuid.optional(), unitId: uuid.optional(), sectionId: uuid.optional(),
      type: z.enum(RESOURCE_TYPES).optional(), tag: z.string().max(40).optional(), q: z.string().max(120).optional(),
      sort: z.enum(["newest", "oldest", "az", "recent", "manual"]).optional(),
    })
    .parse(c.req.query());
  return c.json({ resources: await listResources(c.get("user").id, q) });
});

/** Reads a file name or link and proposes where it belongs. Nothing is saved here. */
api.post("/resources/suggest", auth(), async (c) => {
  const user = c.get("user");
  const body = z
    .object({ name: z.string().max(255).optional(), url: z.string().max(2000).optional(), courseId: uuid.optional(), semesterId: uuid.optional(), unitId: uuid.optional() })
    .parse(await c.req.json());
  const s = suggest(body);
  const all = await listCourses(user.id);
  const here = all.find((x) => x.id === body.courseId);
  // A grade in the name picks the class; the place the teacher is standing in breaks ties and fills the gaps.
  const course = s.grade === null ? here : here?.grade === s.grade ? here : all.find((x) => x.grade === s.grade) ?? here;
  let semesterId: string | null = null;
  let unitId: string | null = null;
  let sectionId: string | null = null;
  if (course) {
    const sems = await listSemesters(user.id, course.id);
    const semester = sems.find((x) => x.id === body.semesterId) ?? sems[0];
    semesterId = semester?.id ?? null;
    if (semester) {
      const unitList = await listUnits(user.id, semester.id);
      const unit = (s.unit && unitList.find((u) => String(u.number) === s.unit)) || unitList.find((u) => u.id === body.unitId) || null;
      unitId = unit?.id ?? null;
      if (unit) sectionId = (await listSections(user.id, unit.id)).find((x) => x.typeKey === s.sectionKey)?.id ?? null;
    }
  }
  return c.json({ suggestion: { ...s, courseId: course?.id ?? null, semesterId, unitId, sectionId } });
});

api.post("/resources", auth(), async (c) => {
  const body = z
    .object({
      sectionId: uuid, kind: z.enum(["file", "link", "note"]), title: trimmed(1, 200), description: optionalText(2000),
      fileId: uuid.optional(), url: z.string().trim().max(2000).optional(), type: z.enum(RESOURCE_TYPES).optional(),
      content: z.string().max(200_000).optional(), topic: optionalText(80), tags: tagsSchema.optional(),
    })
    .parse(await c.req.json());
  const user = c.get("user");
  const common = { sectionId: body.sectionId, title: body.title, description: body.description, topic: body.topic, tags: body.tags };

  let created;
  if (body.kind === "file") {
    if (!body.fileId) throw new ApiError(400, "invalid_input");
    const db = await getDb();
    const [f] = await db.select().from(files).where(and(eq(files.id, body.fileId), eq(files.ownerId, user.id)));
    if (!f) throw new ApiError(404, "not_found");
    created = await createResource(user.id, { ...common, kind: "file", type: FILE_TYPES[f.ext].type, fileId: f.id });
  } else if (body.kind === "link") {
    const info = body.url ? inspectLink(body.url) : null;
    if (!info) throw new ApiError(400, "invalid_url");
    // Known services decide the type; for any other site the teacher's choice is kept.
    const type = info.provider === "other" && body.type && body.type !== "note" ? body.type : info.type;
    created = await createResource(user.id, { ...common, kind: "link", type, url: body.url!.trim(), provider: info.provider, thumbnailUrl: info.thumbnailUrl });
  } else {
    created = await createResource(user.id, { ...common, kind: "note", type: "note", content: body.content ?? "" });
  }
  if (!created) throw new ApiError(404, "not_found");
  return c.json({ resource: created }, 201);
});

api.get("/resources/:id", auth(), async (c) => {
  const r = await getResource(c.get("user").id, uuid.parse(c.req.param("id")));
  if (!r) throw new ApiError(404, "not_found");
  return c.json({ resource: r });
});

api.patch("/resources/:id", auth(), async (c) => {
  const body = z
    .object({ title: trimmed(1, 200), description: optionalText(2000), topic: optionalText(80), tags: tagsSchema, content: z.string().max(200_000), sectionId: uuid })
    .partial()
    .parse(await c.req.json());
  const r = await updateResource(c.get("user").id, uuid.parse(c.req.param("id")), body);
  if (!r) throw new ApiError(404, "not_found");
  return c.json({ resource: r });
});

api.post("/resources/:id/duplicate", auth(), async (c) => {
  const r = await duplicateResource(c.get("user").id, uuid.parse(c.req.param("id")));
  if (!r) throw new ApiError(404, "not_found");
  return c.json({ resource: r }, 201);
});

api.post("/resources/:id/favorite", auth(), async (c) => {
  const { value } = z.object({ value: z.boolean() }).parse(await c.req.json());
  if (!(await setFavorite(c.get("user").id, uuid.parse(c.req.param("id")), value))) throw new ApiError(404, "not_found");
  return c.json({ ok: true });
});

api.post("/resources/:id/open", auth(), async (c) => {
  if (!(await markOpened(c.get("user").id, uuid.parse(c.req.param("id"))))) throw new ApiError(404, "not_found");
  return c.json({ ok: true });
});

api.delete("/resources/:id", auth(), async (c) => {
  if (!(await setTrashed(c.get("user").id, uuid.parse(c.req.param("id")), true))) throw new ApiError(404, "not_found");
  return c.json({ ok: true });
});

api.post("/resources/:id/restore", auth(), async (c) => {
  if (!(await setTrashed(c.get("user").id, uuid.parse(c.req.param("id")), false))) throw new ApiError(404, "not_found");
  return c.json({ ok: true });
});

api.delete("/resources/:id/permanent", auth(), async (c) => {
  const user = c.get("user");
  const id = uuid.parse(c.req.param("id"));
  if ((await deleteForever(user.id, [id])) === 0) throw new ApiError(404, "not_found");
  await audit({ userId: user.id, action: "resource.deleted_forever", meta: { id }, ip: c.get("ip") });
  return c.json({ ok: true });
});

api.delete("/trash", auth(), async (c) => {
  const user = c.get("user");
  const removed = await deleteForever(user.id, "all");
  await audit({ userId: user.id, action: "trash.emptied", meta: { removed }, ip: c.get("ip") });
  return c.json({ removed });
});

/* ── Notifications ─────────────────────────────────────────────────── */

api.get("/notifications", auth(), async (c) => {
  const db = await getDb();
  const userId = c.get("user").id;
  const items = await db.select().from(notifications).where(eq(notifications.userId, userId)).orderBy(desc(notifications.createdAt)).limit(20);
  const [{ n }] = await db.select({ n: count() }).from(notifications).where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return c.json({ notifications: items, unread: Number(n) });
});

api.post("/notifications/read", auth(), async (c) => {
  const db = await getDb();
  await db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.userId, c.get("user").id), isNull(notifications.readAt)));
  return c.json({ ok: true });
});

/* ── AI assistant ──────────────────────────────────────────────────── */

api.post("/ai/chat", auth(), async (c) => {
  const user = c.get("user");
  await limit(`ai:${user.id}`, 20, MIN);
  const body = z
    .object({
      messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(30_000) })).min(1).max(40),
      context: z.object({ courseId: uuid.optional(), unitId: uuid.optional(), sectionId: uuid.optional(), resourceId: uuid.optional(), useResources: z.boolean().optional() }).default({}),
      action: z.enum(AI_ACTIONS).optional(),
    })
    .refine((v) => v.messages[v.messages.length - 1].role === "user")
    .parse(await c.req.json());
  if (!aiAvailable()) throw new ApiError(503, "ai_not_configured");
  if (!(await withinDailyLimit(user.id))) throw new ApiError(429, "ai_daily_limit");

  let stream: ReadableStream<Uint8Array>;
  try {
    stream = await chatStream(user, { ...body, locale: asLocale(user.locale) });
  } catch (err) {
    console.error(err);
    throw new ApiError(502, "ai_unavailable");
  }
  return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
});

