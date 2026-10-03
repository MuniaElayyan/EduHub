import { createCipheriv, createHash, createHmac, randomBytes, randomInt, scrypt, timingSafeEqual } from "node:crypto";
import { and, count, desc, eq, gt, isNull, or } from "drizzle-orm";
import { secureCookies, subkey } from "./config";
import { getDb } from "./db";
import {
  auditLogs, identityDocuments, passwordResets, sessions, userCredentials, users, verificationCodes, type Session, type User,
} from "./db/schema";

const MIN = 60_000;
const DAY = 86_400_000;
const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");
const newToken = () => randomBytes(32).toString("base64url");

/* ── Passwords: scrypt with a salt per password. The hash cannot be turned back into the password. ── */

const SCRYPT = { N: 2 ** 15, r: 8, p: 3, keylen: 64, maxmem: 128 * 1024 * 1024 };

function derive(password: string, salt: Buffer, N: number, r: number, p: number, keylen: number) {
  return new Promise<Buffer>((resolve, reject) =>
    scrypt(password.normalize("NFKC"), salt, keylen, { N, r, p, maxmem: SCRYPT.maxmem }, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const key = await derive(password, salt, SCRYPT.N, SCRYPT.r, SCRYPT.p, SCRYPT.keylen);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [scheme, N, r, p, salt, hash] = stored.split("$");
  if (scheme !== "scrypt") return false;
  const expected = Buffer.from(hash, "base64");
  const actual = await derive(password, Buffer.from(salt, "base64"), +N, +r, +p, expected.length);
  return timingSafeEqual(actual, expected);
}

export async function setPassword(userId: string, password: string) {
  const db = await getDb();
  const passwordHash = await hashPassword(password);
  await db
    .insert(userCredentials)
    .values({ userId, passwordHash })
    .onConflictDoUpdate({ target: userCredentials.userId, set: { passwordHash, updatedAt: new Date() } });
}

export async function getPasswordHash(userId: string) {
  const db = await getDb();
  const [row] = await db.select({ h: userCredentials.passwordHash }).from(userCredentials).where(eq(userCredentials.userId, userId));
  return row?.h ?? null;
}

/* ── Sessions ───────────────────────────────────────────────────────────
   One row per device. The browser holds a random token in an HttpOnly cookie; the database holds its hash.
   "Remember me" keeps the session up to 180 days; without it the cookie dies with the browser.
   The token is replaced once a day. A replaced token that shows up again later means it was copied,
   and that session is closed. A changing IP address or network never ends a session. */

export const SESSION_COOKIE = "eduhub_session";
const REMEMBER_MS = 180 * DAY;
const SHORT_MS = DAY;
// How often the token is replaced, and how long the replaced one stays valid for requests already on their way.
const ROTATE_AFTER_MS = Number(process.env.SESSION_ROTATE_SECONDS ?? 86_400) * 1000;
const ROTATION_GRACE_MS = Number(process.env.SESSION_ROTATION_GRACE_SECONDS ?? 60) * 1000;

export const sessionCookieOptions = (remember: boolean) => ({
  httpOnly: true,
  secure: secureCookies(),
  sameSite: "Lax" as const,
  path: "/",
  ...(remember ? { maxAge: REMEMBER_MS / 1000 } : {}),
});

export async function createSession(userId: string, meta: { remember: boolean; userAgent?: string; ip?: string }) {
  const db = await getDb();
  const token = newToken();
  await db.insert(sessions).values({
    userId,
    tokenHash: sha256(token),
    remember: meta.remember,
    userAgent: meta.userAgent?.slice(0, 300),
    ip: meta.ip,
    expiresAt: new Date(Date.now() + (meta.remember ? REMEMBER_MS : SHORT_MS)),
  });
  return token;
}

export type SessionRead = { user: User; session: Session; newToken?: string };

/**
 * Resolves the cookie token to a session. With `rotate`, an old enough token is swapped for a new one,
 * which the caller must send back as the cookie (only API responses can do that).
 */
export async function readSession(token: string | undefined, opts: { rotate?: boolean } = {}): Promise<SessionRead | null> {
  if (!token) return null;
  const db = await getDb();
  const hash = sha256(token);
  const [row] = await db
    .select({ user: users, session: sessions })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(or(eq(sessions.tokenHash, hash), eq(sessions.prevTokenHash, hash)), isNull(sessions.revokedAt)))
    .limit(1);
  if (!row) return null;
  const { session } = row;
  const now = Date.now();
  if (session.expiresAt.getTime() <= now) return null;

  if (session.tokenHash !== hash) {
    // The previous token: fine for a moment after rotation (requests already in flight), theft after that.
    if (now - session.rotatedAt.getTime() <= ROTATION_GRACE_MS) return row;
    await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, session.id));
    await audit({ userId: session.userId, action: "session.reuse_detected", meta: { sessionId: session.id } });
    return null;
  }

  if (opts.rotate && now - session.rotatedAt.getTime() > ROTATE_AFTER_MS) {
    const next = newToken();
    const [rotated] = await db
      .update(sessions)
      .set({ tokenHash: sha256(next), prevTokenHash: hash, rotatedAt: new Date(), lastUsedAt: new Date() })
      .where(and(eq(sessions.id, session.id), eq(sessions.tokenHash, hash)))
      .returning();
    if (rotated) return { user: row.user, session: rotated, newToken: next };
  }

  if (now - session.lastUsedAt.getTime() > 5 * MIN) {
    await db
      .update(sessions)
      .set({ lastUsedAt: new Date(), ...(session.remember ? {} : { expiresAt: new Date(now + SHORT_MS) }) })
      .where(eq(sessions.id, session.id));
  }
  return row;
}

export async function revokeSessions(userId: string, opts: { exceptId?: string; onlyId?: string } = {}) {
  const db = await getDb();
  const rows = await db.select({ id: sessions.id }).from(sessions).where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
  const ids = rows.map((r) => r.id).filter((id) => (opts.onlyId ? id === opts.onlyId : id !== opts.exceptId));
  for (const id of ids) await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, id));
  return ids.length;
}

/* ── Email codes ────────────────────────────────────────────────────────
   One service for every step that needs proof of an email address.
   Six random digits, valid ten minutes, five wrong tries, used once; a new code cancels the old one. */

const CODE_TTL_MS = 10 * MIN;
const CODE_MAX_ATTEMPTS = 5;
export const CODE_RESEND_SECONDS = 60;
const CODE_MAX_PER_HOUR = 5;
export type CodePurpose = "verify_email" | "reset_password" | "change_email";

const codeHash = (userId: string, purpose: CodePurpose, code: string) =>
  createHmac("sha256", subkey("codes")).update(`${purpose}:${userId}:${code}`).digest("hex");

export async function issueCode(
  userId: string,
  purpose: CodePurpose,
  targetEmail: string,
): Promise<{ ok: true; code: string } | { ok: false; reason: "cooldown" | "limit"; retryAfter: number }> {
  const db = await getDb();
  const recent = await db
    .select({ createdAt: verificationCodes.createdAt })
    .from(verificationCodes)
    .where(and(eq(verificationCodes.userId, userId), eq(verificationCodes.purpose, purpose), gt(verificationCodes.createdAt, new Date(Date.now() - 60 * MIN))))
    .orderBy(desc(verificationCodes.createdAt));
  const sinceLast = recent[0] ? (Date.now() - recent[0].createdAt.getTime()) / 1000 : Infinity;
  if (sinceLast < CODE_RESEND_SECONDS) return { ok: false, reason: "cooldown", retryAfter: Math.ceil(CODE_RESEND_SECONDS - sinceLast) };
  if (recent.length >= CODE_MAX_PER_HOUR) return { ok: false, reason: "limit", retryAfter: 3600 };

  await db
    .update(verificationCodes)
    .set({ consumedAt: new Date() })
    .where(and(eq(verificationCodes.userId, userId), eq(verificationCodes.purpose, purpose), isNull(verificationCodes.consumedAt)));
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await db.insert(verificationCodes).values({
    userId, purpose, targetEmail, codeHash: codeHash(userId, purpose, code), expiresAt: new Date(Date.now() + CODE_TTL_MS),
  });
  return { ok: true, code };
}

export async function checkCode(
  userId: string,
  purpose: CodePurpose,
  code: string,
): Promise<{ ok: true; targetEmail: string } | { ok: false; reason: "expired" | "invalid" }> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(verificationCodes)
    .where(and(eq(verificationCodes.userId, userId), eq(verificationCodes.purpose, purpose), isNull(verificationCodes.consumedAt)))
    .orderBy(desc(verificationCodes.createdAt))
    .limit(1);
  if (!row || row.expiresAt.getTime() <= Date.now()) return { ok: false, reason: "expired" };

  const expected = Buffer.from(row.codeHash, "hex");
  const given = Buffer.from(codeHash(userId, purpose, code), "hex");
  if (!timingSafeEqual(expected, given)) {
    const attempts = row.attempts + 1;
    // The fifth wrong try uses the code up; a new one has to be requested.
    await db
      .update(verificationCodes)
      .set({ attempts, ...(attempts >= CODE_MAX_ATTEMPTS ? { consumedAt: new Date() } : {}) })
      .where(eq(verificationCodes.id, row.id));
    return { ok: false, reason: attempts >= CODE_MAX_ATTEMPTS ? "expired" : "invalid" };
  }
  await db.update(verificationCodes).set({ consumedAt: new Date() }).where(eq(verificationCodes.id, row.id));
  return { ok: true, targetEmail: row.targetEmail };
}

/* ── Password reset ticket: handed out after a correct reset code, good for one password change ── */

export async function createResetTicket(userId: string) {
  const db = await getDb();
  const token = newToken();
  await db.insert(passwordResets).values({ userId, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 10 * MIN) });
  return token;
}

export async function consumeResetTicket(token: string) {
  const db = await getDb();
  const [row] = await db
    .update(passwordResets)
    .set({ usedAt: new Date() })
    .where(and(eq(passwordResets.tokenHash, sha256(token)), isNull(passwordResets.usedAt), gt(passwordResets.expiresAt, new Date())))
    .returning({ userId: passwordResets.userId });
  return row?.userId ?? null;
}

/* ── National ID: encrypted at rest, shown only as its last four digits ── */

const digits = (s: string) => s.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/[\s-]/g, "");
/** Country rules differ, so the accepted shape is configuration. Default: 6 to 20 digits. */
const nationalIdPattern = () => new RegExp(process.env.NATIONAL_ID_PATTERN ?? "^\\d{6,20}$");

export function parseNationalId(input: string): string | null {
  const v = digits(input);
  return nationalIdPattern().test(v) ? v : null;
}

/** Stores the ID. Returns false when another account already uses it. */
export async function saveNationalId(userId: string, value: string) {
  const db = await getDb();
  const blindIndex = createHmac("sha256", subkey("national-id-index")).update(value).digest("hex");
  const [taken] = await db.select({ userId: identityDocuments.userId }).from(identityDocuments).where(eq(identityDocuments.blindIndex, blindIndex));
  if (taken && taken.userId !== userId) return false;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", subkey("national-id-encrypt"), iv);
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const ciphertext = Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
  const row = { userId, ciphertext, last4: value.slice(-4), blindIndex };
  await db.insert(identityDocuments).values(row).onConflictDoUpdate({ target: identityDocuments.userId, set: row });
  return true;
}

export async function nationalIdTaken(value: string) {
  const db = await getDb();
  const blindIndex = createHmac("sha256", subkey("national-id-index")).update(value).digest("hex");
  const [{ n }] = await db.select({ n: count() }).from(identityDocuments).where(eq(identityDocuments.blindIndex, blindIndex));
  return Number(n) > 0;
}

export async function nationalIdLast4(userId: string) {
  const db = await getDb();
  const [row] = await db.select({ last4: identityDocuments.last4 }).from(identityDocuments).where(eq(identityDocuments.userId, userId));
  return row?.last4 ?? null;
}

/* ── Audit and the public shape of a user ──────────────────────────── */

export async function audit(entry: { userId?: string | null; action: string; meta?: Record<string, unknown>; ip?: string }) {
  const db = await getDb();
  await db.insert(auditLogs).values(entry);
}

/** What the browser may know about the signed-in teacher. No password hash, no national ID. */
export function publicUser(u: User) {
  return {
    id: u.id, email: u.email, role: u.role, status: u.status,
    firstName: u.firstName, secondName: u.secondName, thirdName: u.thirdName, lastName: u.lastName,
    gender: u.gender, schoolName: u.schoolName, academicYear: u.academicYear,
    avatarFileId: u.avatarFileId, coverFileId: u.coverFileId, locale: u.locale, theme: u.theme,
  };
}
export type PublicUser = ReturnType<typeof publicUser>;

