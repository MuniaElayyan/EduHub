import { sql } from "drizzle-orm";
import {
  bigint, boolean, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const ts = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => ts("created_at").notNull().defaultNow();
const updatedAt = () => ts("updated_at").notNull().defaultNow();
const owner = () => uuid("owner_id").notNull().references(() => users.id, { onDelete: "cascade" });

/* ── Enums ─────────────────────────────────────────────────────────── */

/** One role today. New roles are added here; nothing else in the schema assumes "teacher". */
export const roleEnum = pgEnum("user_role", ["teacher"]);
export const statusEnum = pgEnum("user_status", ["pending_email", "pending_profile", "active", "suspended"]);
export const genderEnum = pgEnum("gender", ["male", "female"]);
export const codePurposeEnum = pgEnum("code_purpose", ["verify_email", "reset_password", "change_email"]);
export const resourceKindEnum = pgEnum("resource_kind", ["file", "link", "note"]);
export const resourceTypeEnum = pgEnum("resource_type", [
  "pdf", "presentation", "document", "spreadsheet", "image", "video", "link", "note",
]);

/* ── Account ───────────────────────────────────────────────────────── */

export const users = pgTable(
  "users",
  {
    id: id(),
    email: text("email").notNull(),
    emailVerifiedAt: ts("email_verified_at"),
    role: roleEnum("role").notNull().default("teacher"),
    status: statusEnum("status").notNull().default("pending_email"),
    firstName: text("first_name"),
    secondName: text("second_name"),
    thirdName: text("third_name"),
    lastName: text("last_name"),
    gender: genderEnum("gender"),
    /** typed by the teacher, stored as typed, editable in settings */
    schoolName: text("school_name"),
    academicYear: text("academic_year"),
    avatarFileId: uuid("avatar_file_id"),
    locale: text("locale").notNull().default("ar"),
    theme: text("theme").notNull().default("system"),
    storageQuotaBytes: bigint("storage_quota_bytes", { mode: "number" }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("users_email_idx").on(t.email)],
);

/** The password hash lives apart from the profile so ordinary queries never load it. Absent for Google-only accounts. */
export const userCredentials = pgTable("user_credentials", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  passwordHash: text("password_hash").notNull(),
  updatedAt: updatedAt(),
});

/** National ID: encrypted value, last four digits for masked display, and a keyed hash to keep it unique. */
export const identityDocuments = pgTable(
  "identity_documents",
  {
    userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
    ciphertext: text("ciphertext").notNull(),
    keyVersion: integer("key_version").notNull().default(1),
    last4: text("last4").notNull(),
    blindIndex: text("blind_index").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("identity_blind_idx").on(t.blindIndex)],
);

export const oauthAccounts = pgTable(
  "oauth_accounts",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    providerUserId: text("provider_user_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("oauth_identity_idx").on(t.provider, t.providerUserId), index("oauth_user_idx").on(t.userId)],
);

/** One row per signed-in device. The cookie token is rotated; only hashes are stored. */
export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    /** the token this one replaced; valid for a short grace period, afterwards its use means theft */
    prevTokenHash: text("prev_token_hash"),
    rotatedAt: ts("rotated_at").notNull().defaultNow(),
    remember: boolean("remember").notNull().default(false),
    userAgent: text("user_agent"),
    /** recorded for the device list and the audit trail only; never used to accept or refuse a request */
    ip: text("ip"),
    createdAt: createdAt(),
    lastUsedAt: ts("last_used_at").notNull().defaultNow(),
    expiresAt: ts("expires_at").notNull(),
    revokedAt: ts("revoked_at"),
  },
  (t) => [
    uniqueIndex("sessions_token_idx").on(t.tokenHash),
    index("sessions_prev_idx").on(t.prevTokenHash),
    index("sessions_user_idx").on(t.userId),
  ],
);

/** Six-digit email codes for every sensitive step: confirming an address, resetting a password, changing email. */
export const verificationCodes = pgTable(
  "verification_codes",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    purpose: codePurposeEnum("purpose").notNull(),
    codeHash: text("code_hash").notNull(),
    targetEmail: text("target_email").notNull(),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: ts("expires_at").notNull(),
    consumedAt: ts("consumed_at"),
    createdAt: createdAt(),
  },
  (t) => [index("codes_user_idx").on(t.userId, t.purpose, t.createdAt)],
);

/** Issued after a correct reset code: a single-use ticket that allows choosing a new password. */
export const passwordResets = pgTable(
  "password_resets",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: ts("expires_at").notNull(),
    usedAt: ts("used_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("resets_token_idx").on(t.tokenHash)],
);

/* ── Reference data (seeded, editable without touching the interface) ── */

export const subjects = pgTable("subjects", {
  code: text("code").primaryKey(),
  nameAr: text("name_ar").notNull(),
  nameEn: text("name_en").notNull(),
  /** grades this subject is taught in; empty means all */
  grades: jsonb("grades").$type<number[]>().notNull().default([]),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
});

/** The sections every unit starts with, and what each one accepts. */
export const sectionTypes = pgTable("section_types", {
  key: text("key").primaryKey(),
  nameAr: text("name_ar").notNull(),
  nameEn: text("name_en").notNull(),
  icon: text("icon").notNull(),
  color: text("color").notNull(),
  /** file extensions accepted for upload; empty means none */
  exts: jsonb("exts").$type<string[]>().notNull().default([]),
  links: boolean("links").notNull().default(true),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const teacherSubjects = pgTable(
  "teacher_subjects",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    subjectCode: text("subject_code").notNull().references(() => subjects.code),
  },
  (t) => [primaryKey({ columns: [t.userId, t.subjectCode] })],
);

export const teacherGrades = pgTable(
  "teacher_grades",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    grade: integer("grade").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.grade] })],
);

/* ── The teacher's workspace: subject → grade → semester → unit → section → resource ── */

/** A class the teacher teaches: one subject in one grade in one academic year. */
export const courses = pgTable(
  "courses",
  {
    id: id(),
    ownerId: owner(),
    subjectCode: text("subject_code").notNull().references(() => subjects.code),
    grade: integer("grade").notNull(),
    /** optional label for a later split into classrooms ("A", "B") */
    classroom: text("classroom"),
    academicYear: text("academic_year").notNull(),
    color: text("color").notNull().default("green"),
    position: integer("position").notNull().default(0),
    archivedAt: ts("archived_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("courses_owner_idx").on(t.ownerId)],
);

export const semesters = pgTable(
  "semesters",
  {
    id: id(),
    courseId: uuid("course_id").notNull().references(() => courses.id, { onDelete: "cascade" }),
    ownerId: owner(),
    position: integer("position").notNull(),
    /** null for the two standard semesters, which are named by the interface language */
    name: text("name"),
  },
  (t) => [index("semesters_course_idx").on(t.courseId)],
);

export const units = pgTable(
  "units",
  {
    id: id(),
    semesterId: uuid("semester_id").notNull().references(() => semesters.id, { onDelete: "cascade" }),
    courseId: uuid("course_id").notNull().references(() => courses.id, { onDelete: "cascade" }),
    ownerId: owner(),
    number: integer("number").notNull(),
    title: text("title"),
    position: integer("position").notNull(),
    /** default sections are created the first time the unit is opened, so unused units cost nothing */
    sectionsReady: boolean("sections_ready").notNull().default(false),
  },
  (t) => [index("units_semester_idx").on(t.semesterId)],
);

export const sections = pgTable(
  "sections",
  {
    id: id(),
    unitId: uuid("unit_id").notNull().references(() => units.id, { onDelete: "cascade" }),
    courseId: uuid("course_id").notNull().references(() => courses.id, { onDelete: "cascade" }),
    ownerId: owner(),
    /** set for sections created from a section type; null for the teacher's own sections */
    typeKey: text("type_key").references(() => sectionTypes.key),
    /** the teacher's name for it; when null the section type's name is shown */
    name: text("name"),
    description: text("description"),
    icon: text("icon").notNull().default("folder"),
    color: text("color").notNull().default("green"),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("sections_unit_idx").on(t.unitId)],
);

export const files = pgTable(
  "files",
  {
    id: id(),
    ownerId: owner(),
    storageKey: text("storage_key").notNull(),
    originalName: text("original_name").notNull(),
    mime: text("mime").notNull(),
    ext: text("ext").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("files_owner_idx").on(t.ownerId)],
);

export const resources = pgTable(
  "resources",
  {
    id: id(),
    ownerId: owner(),
    courseId: uuid("course_id").notNull().references(() => courses.id, { onDelete: "cascade" }),
    unitId: uuid("unit_id").notNull().references(() => units.id, { onDelete: "cascade" }),
    sectionId: uuid("section_id").notNull().references(() => sections.id, { onDelete: "cascade" }),
    kind: resourceKindEnum("kind").notNull(),
    type: resourceTypeEnum("type").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    fileId: uuid("file_id").references(() => files.id, { onDelete: "set null" }),
    url: text("url"),
    provider: text("provider"),
    thumbnailUrl: text("thumbnail_url"),
    /** markdown body of notes saved from the assistant */
    content: text("content"),
    topic: text("topic"),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    /** the teacher's own order inside a section */
    position: integer("position").notNull().default(0),
    deletedAt: ts("deleted_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("resources_owner_idx").on(t.ownerId, t.deletedAt),
    index("resources_section_idx").on(t.sectionId),
    index("resources_course_idx").on(t.courseId),
  ],
);

export const resourceStates = pgTable(
  "resource_states",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    resourceId: uuid("resource_id").notNull().references(() => resources.id, { onDelete: "cascade" }),
    isFavorite: boolean("is_favorite").notNull().default(false),
    lastOpenedAt: ts("last_opened_at"),
  },
  (t) => [primaryKey({ columns: [t.userId, t.resourceId] })],
);

/* ── Notifications, AI usage, audit ────────────────────────────────── */

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    readAt: ts("read_at"),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_user_idx").on(t.userId, t.createdAt)],
);

export const aiUsage = pgTable(
  "ai_usage",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    action: text("action").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("ai_usage_user_idx").on(t.userId, t.createdAt)],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    userId: uuid("user_id"),
    action: text("action").notNull(),
    meta: jsonb("meta").$type<Record<string, unknown>>(),
    ip: text("ip"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_user_idx").on(t.userId, t.createdAt)],
);

/**
 * Rate-limit counters. They live in the database because on serverless hosts the app runs as many
 * short-lived instances, and a counter kept in one instance's memory would not be seen by the others.
 */
export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  resetAt: ts("reset_at").notNull(),
});

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
