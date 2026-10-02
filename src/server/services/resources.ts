import { and, asc, count, desc, eq, ilike, inArray, isNotNull, isNull, max, or, sql, sum, type SQL } from "drizzle-orm";
import type { ResourceType } from "@/lib/constants";
import { getDb } from "../db";
import { courses, files, resources, resourceStates, sections, sectionTypes, semesters, subjects, units, users } from "../db/schema";
import { storage } from "../storage";

export type ResourceDTO = {
  id: string;
  kind: "file" | "link" | "note";
  type: ResourceType;
  title: string;
  description: string | null;
  url: string | null;
  provider: string | null;
  thumbnailUrl: string | null;
  content: string | null;
  topic: string | null;
  tags: string[];
  position: number;
  courseId: string;
  semesterId: string;
  unitId: string;
  sectionId: string;
  course: { grade: number; subjectAr: string; subjectEn: string; color: string; academicYear: string };
  semester: { position: number; name: string | null };
  unit: { number: number; title: string | null };
  section: { name: string | null; typeNameAr: string | null; typeNameEn: string | null };
  file: { id: string; name: string; mime: string; ext: string; size: number } | null;
  isFavorite: boolean;
  lastOpenedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ResourceFilters = {
  view?: "all" | "favorites" | "recent" | "trash";
  courseId?: string;
  semesterId?: string;
  unitId?: string;
  sectionId?: string;
  type?: ResourceType;
  tag?: string;
  q?: string;
  sort?: "newest" | "oldest" | "az" | "recent" | "manual";
  limit?: number;
};

const iso = (d: Date | null) => (d ? d.toISOString() : null);
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

function baseQuery(db: Awaited<ReturnType<typeof getDb>>, userId: string) {
  return db
    .select({
      r: resources,
      fileName: files.originalName, fileMime: files.mime, fileExt: files.ext, fileSize: files.sizeBytes,
      sectionName: sections.name, typeNameAr: sectionTypes.nameAr, typeNameEn: sectionTypes.nameEn,
      unitNumber: units.number, unitTitle: units.title, semesterId: units.semesterId,
      semesterPosition: semesters.position, semesterName: semesters.name,
      grade: courses.grade, color: courses.color, academicYear: courses.academicYear,
      subjectAr: subjects.nameAr, subjectEn: subjects.nameEn,
      isFavorite: resourceStates.isFavorite, lastOpenedAt: resourceStates.lastOpenedAt,
    })
    .from(resources)
    .innerJoin(courses, eq(courses.id, resources.courseId))
    .innerJoin(subjects, eq(subjects.code, courses.subjectCode))
    .innerJoin(units, eq(units.id, resources.unitId))
    .innerJoin(semesters, eq(semesters.id, units.semesterId))
    .innerJoin(sections, eq(sections.id, resources.sectionId))
    .leftJoin(sectionTypes, eq(sectionTypes.key, sections.typeKey))
    .leftJoin(files, eq(files.id, resources.fileId))
    .leftJoin(resourceStates, and(eq(resourceStates.resourceId, resources.id), eq(resourceStates.userId, userId)));
}
type Row = Awaited<ReturnType<typeof baseQuery>>[number];

const toDTO = (x: Row): ResourceDTO => ({
  id: x.r.id, kind: x.r.kind, type: x.r.type, title: x.r.title, description: x.r.description, url: x.r.url,
  provider: x.r.provider, thumbnailUrl: x.r.thumbnailUrl, content: x.r.content, topic: x.r.topic, tags: x.r.tags, position: x.r.position,
  courseId: x.r.courseId, semesterId: x.semesterId, unitId: x.r.unitId, sectionId: x.r.sectionId,
  course: { grade: x.grade, subjectAr: x.subjectAr, subjectEn: x.subjectEn, color: x.color, academicYear: x.academicYear },
  semester: { position: x.semesterPosition, name: x.semesterName },
  unit: { number: x.unitNumber, title: x.unitTitle },
  section: { name: x.sectionName, typeNameAr: x.typeNameAr, typeNameEn: x.typeNameEn },
  file: x.r.fileId && x.fileName ? { id: x.r.fileId, name: x.fileName, mime: x.fileMime!, ext: x.fileExt!, size: Number(x.fileSize) } : null,
  isFavorite: !!x.isFavorite, lastOpenedAt: iso(x.lastOpenedAt), deletedAt: iso(x.r.deletedAt),
  createdAt: x.r.createdAt.toISOString(), updatedAt: x.r.updatedAt.toISOString(),
});

export async function listResources(userId: string, f: ResourceFilters = {}): Promise<ResourceDTO[]> {
  const db = await getDb();
  const where: (SQL | undefined)[] = [eq(resources.ownerId, userId)];

  if (f.view === "trash") where.push(isNotNull(resources.deletedAt));
  else where.push(isNull(resources.deletedAt), isNull(courses.archivedAt));
  if (f.view === "favorites") where.push(eq(resourceStates.isFavorite, true));
  if (f.view === "recent") where.push(isNotNull(resourceStates.lastOpenedAt));

  if (f.courseId) where.push(eq(resources.courseId, f.courseId));
  if (f.semesterId) where.push(eq(units.semesterId, f.semesterId));
  if (f.unitId) where.push(eq(resources.unitId, f.unitId));
  if (f.sectionId) where.push(eq(resources.sectionId, f.sectionId));
  if (f.type) where.push(eq(resources.type, f.type));
  if (f.tag) where.push(sql`${resources.tags} @> ${JSON.stringify([f.tag])}::jsonb`);

  // Every word must match something: the resource's own fields, or the unit, section or subject it sits in.
  // "Unit 3" therefore finds everything filed under unit 3 in any class, whatever its title says.
  for (const term of (f.q ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 6)) {
    const p = `%${likeEscape(term)}%`;
    where.push(
      or(
        ilike(resources.title, p), ilike(resources.description, p), ilike(resources.topic, p), ilike(resources.url, p),
        ilike(files.originalName, p), sql`${resources.tags}::text ilike ${p}`,
        sql`('unit ' || ${units.number} || ' الوحدة ' || ${units.number}) ilike ${p}`,
        ilike(units.title, p), ilike(sections.name, p), ilike(sectionTypes.nameAr, p), ilike(sectionTypes.nameEn, p),
        ilike(subjects.nameAr, p), ilike(subjects.nameEn, p),
      ),
    );
  }

  const sort = f.sort ?? (f.view === "recent" ? "recent" : "newest");
  const order =
    sort === "oldest" ? [asc(resources.createdAt)]
    : sort === "az" ? [asc(sql`lower(${resources.title})`)]
    : sort === "manual" ? [asc(resources.position), asc(resources.createdAt)]
    : sort === "recent" ? [sql`${resourceStates.lastOpenedAt} desc nulls last`, desc(resources.createdAt)]
    : f.view === "trash" ? [desc(resources.deletedAt)]
    : [desc(resources.createdAt)];

  const rows = await baseQuery(db, userId).where(and(...where)).orderBy(...order).limit(Math.min(f.limit ?? 200, 500));
  return rows.map(toDTO);
}

export async function getResource(userId: string, id: string): Promise<ResourceDTO | null> {
  const db = await getDb();
  const [row] = await baseQuery(db, userId).where(and(eq(resources.id, id), eq(resources.ownerId, userId))).limit(1);
  return row ? toDTO(row) : null;
}

async function ownSection(userId: string, sectionId: string) {
  const db = await getDb();
  const [s] = await db.select().from(sections).where(and(eq(sections.id, sectionId), eq(sections.ownerId, userId)));
  return s ?? null;
}

export type CreateResourceInput = {
  sectionId: string;
  kind: "file" | "link" | "note";
  type: ResourceType;
  title: string;
  description?: string | null;
  fileId?: string | null;
  url?: string | null;
  provider?: string | null;
  thumbnailUrl?: string | null;
  content?: string | null;
  topic?: string | null;
  tags?: string[];
};

/** The section decides the unit and the class, so a resource added inside a section needs nothing else. */
export async function createResource(userId: string, input: CreateResourceInput) {
  const db = await getDb();
  const section = await ownSection(userId, input.sectionId);
  if (!section) return null;
  if (input.fileId) {
    const [f] = await db.select({ id: files.id }).from(files).where(and(eq(files.id, input.fileId), eq(files.ownerId, userId)));
    if (!f) return null;
  }
  const [{ p }] = await db.select({ p: max(resources.position) }).from(resources).where(eq(resources.sectionId, section.id));
  const [row] = await db
    .insert(resources)
    .values({ ...input, ownerId: userId, courseId: section.courseId, unitId: section.unitId, tags: input.tags ?? [], position: Number(p ?? -1) + 1 })
    .returning({ id: resources.id });
  await db.update(courses).set({ updatedAt: new Date() }).where(eq(courses.id, section.courseId));
  return getResource(userId, row.id);
}

export async function updateResource(
  userId: string,
  id: string,
  patch: Partial<{ title: string; description: string | null; topic: string | null; tags: string[]; content: string | null; sectionId: string }>,
) {
  const db = await getDb();
  const { sectionId, ...fields } = patch;
  const set: Record<string, unknown> = { ...fields, updatedAt: new Date() };
  if (sectionId) {
    const section = await ownSection(userId, sectionId);
    if (!section) return null;
    Object.assign(set, { sectionId: section.id, unitId: section.unitId, courseId: section.courseId });
  }
  const [row] = await db.update(resources).set(set).where(and(eq(resources.id, id), eq(resources.ownerId, userId))).returning({ id: resources.id });
  return row ? getResource(userId, row.id) : null;
}

/** Saves the teacher's own order of a section's resources. */
export async function reorderResources(userId: string, sectionId: string, ids: string[]) {
  const db = await getDb();
  if (!(await ownSection(userId, sectionId))) return false;
  await db.transaction(async (tx) => {
    for (const [i, id] of ids.entries()) {
      await tx.update(resources).set({ position: i }).where(and(eq(resources.id, id), eq(resources.sectionId, sectionId), eq(resources.ownerId, userId)));
    }
  });
  return true;
}

export async function duplicateResource(userId: string, id: string) {
  const db = await getDb();
  const [src] = await db.select().from(resources).where(and(eq(resources.id, id), eq(resources.ownerId, userId), isNull(resources.deletedAt)));
  if (!src) return null;
  const { id: _id, createdAt: _c, updatedAt: _u, deletedAt: _d, ...copy } = src;
  // The copy points at the same stored file; storage is freed only when the last reference goes.
  const [row] = await db.insert(resources).values({ ...copy, title: `${src.title} (2)`, position: src.position + 1 }).returning({ id: resources.id });
  return getResource(userId, row.id);
}

async function setState(userId: string, id: string, state: { isFavorite?: boolean; lastOpenedAt?: Date }) {
  const db = await getDb();
  if (!(await getResource(userId, id))) return false;
  await db
    .insert(resourceStates)
    .values({ userId, resourceId: id, ...state })
    .onConflictDoUpdate({ target: [resourceStates.userId, resourceStates.resourceId], set: state });
  return true;
}
export const setFavorite = (userId: string, id: string, value: boolean) => setState(userId, id, { isFavorite: value });
export const markOpened = (userId: string, id: string) => setState(userId, id, { lastOpenedAt: new Date() });

export async function setTrashed(userId: string, id: string, trashed: boolean) {
  const db = await getDb();
  const [row] = await db
    .update(resources).set({ deletedAt: trashed ? new Date() : null })
    .where(and(eq(resources.id, id), eq(resources.ownerId, userId)))
    .returning({ id: resources.id });
  return !!row;
}

/** Permanent removal is only possible from the trash. Frees the stored file once nothing else uses it. */
export async function deleteForever(userId: string, ids: string[] | "all") {
  const db = await getDb();
  const cond = and(
    eq(resources.ownerId, userId),
    isNotNull(resources.deletedAt),
    ids === "all" ? undefined : inArray(resources.id, ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]),
  );
  const removed = await db.delete(resources).where(cond).returning({ fileId: resources.fileId });
  for (const fileId of new Set(removed.map((r) => r.fileId).filter((v): v is string => !!v))) {
    const [{ n }] = await db.select({ n: count() }).from(resources).where(eq(resources.fileId, fileId));
    const [avatar] = await db.select({ id: users.id }).from(users).where(eq(users.avatarFileId, fileId));
    if (Number(n) > 0 || avatar) continue;
    const [f] = await db.delete(files).where(and(eq(files.id, fileId), eq(files.ownerId, userId))).returning();
    if (f) await storage().delete(f.storageKey);
  }
  return removed.length;
}

export async function storageUsed(userId: string) {
  const db = await getDb();
  const [{ total }] = await db.select({ total: sum(files.sizeBytes) }).from(files).where(eq(files.ownerId, userId));
  return Number(total ?? 0);
}

export async function resourceCount(userId: string) {
  const db = await getDb();
  const [{ n }] = await db.select({ n: count() }).from(resources).where(and(eq(resources.ownerId, userId), isNull(resources.deletedAt)));
  return Number(n);
}
