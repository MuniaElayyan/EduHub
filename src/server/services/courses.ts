import { and, asc, count, eq, isNull, max } from "drizzle-orm";
import { COLORS } from "@/lib/constants";
import { getDb } from "../db";
import { courses, resources, sections, sectionTypes, semesters, subjects, teacherGrades, teacherSubjects, units } from "../db/schema";

export type SubjectDTO = { code: string; nameAr: string; nameEn: string; grades: number[] };
export type CourseDTO = {
  id: string; subjectCode: string; subjectAr: string; subjectEn: string; grade: number; classroom: string | null;
  academicYear: string; color: string; resourceCount: number; lastUpdate: string;
};
export type SemesterDTO = { id: string; courseId: string; position: number; name: string | null; unitCount: number; resourceCount: number };
export type UnitDTO = { id: string; semesterId: string; courseId: string; number: number; title: string | null; resourceCount: number };
export type SectionDTO = {
  id: string; unitId: string; courseId: string; typeKey: string | null; name: string | null; typeNameAr: string | null; typeNameEn: string | null;
  description: string | null; icon: string; color: string; resourceCount: number;
  /** what the "add" dialog offers here: upload formats and whether links are accepted. A custom section accepts everything. */
  exts: string[] | null; links: boolean;
};

const DEFAULT_UNITS = () => Math.min(40, Math.max(1, Number(process.env.DEFAULT_UNITS_PER_SEMESTER ?? 12)));

export async function listSubjects(): Promise<SubjectDTO[]> {
  const db = await getDb();
  return db
    .select({ code: subjects.code, nameAr: subjects.nameAr, nameEn: subjects.nameEn, grades: subjects.grades })
    .from(subjects)
    .where(eq(subjects.isActive, true))
    .orderBy(asc(subjects.sortOrder));
}

const liveResources = (userId: string) => and(eq(resources.ownerId, userId), isNull(resources.deletedAt));

export async function listCourses(userId: string): Promise<CourseDTO[]> {
  const db = await getDb();
  const stats = db
    .select({ courseId: resources.courseId, n: count().as("n"), last: max(resources.updatedAt).as("last") })
    .from(resources).where(liveResources(userId)).groupBy(resources.courseId).as("stats");
  const rows = await db
    .select({ c: courses, s: subjects, n: stats.n, last: stats.last })
    .from(courses)
    .innerJoin(subjects, eq(subjects.code, courses.subjectCode))
    .leftJoin(stats, eq(stats.courseId, courses.id))
    .where(and(eq(courses.ownerId, userId), isNull(courses.archivedAt)))
    .orderBy(asc(subjects.sortOrder), asc(courses.grade), asc(courses.createdAt));
  return rows.map(({ c, s, n, last }) => ({
    id: c.id, subjectCode: c.subjectCode, subjectAr: s.nameAr, subjectEn: s.nameEn, grade: c.grade, classroom: c.classroom,
    academicYear: c.academicYear, color: c.color, resourceCount: Number(n ?? 0), lastUpdate: new Date(last ?? c.updatedAt).toISOString(),
  }));
}

export const getCourse = async (userId: string, id: string) => (await listCourses(userId)).find((c) => c.id === id) ?? null;

/** Creates the class with its two semesters and their units. Returns null when the teacher already has it. */
export async function createCourse(userId: string, input: { subjectCode: string; grade: number; academicYear: string; color?: string }) {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [dup] = await tx
      .select({ id: courses.id })
      .from(courses)
      .where(and(eq(courses.ownerId, userId), eq(courses.subjectCode, input.subjectCode), eq(courses.grade, input.grade), eq(courses.academicYear, input.academicYear), isNull(courses.archivedAt)));
    if (dup) return null;
    const [{ n }] = await tx.select({ n: count() }).from(courses).where(eq(courses.ownerId, userId));
    const [course] = await tx
      .insert(courses)
      .values({ ownerId: userId, ...input, color: input.color ?? COLORS[Number(n) % COLORS.length], position: Number(n) })
      .returning();
    const sems = await tx
      .insert(semesters)
      .values([1, 2].map((position) => ({ courseId: course.id, ownerId: userId, position })))
      .returning({ id: semesters.id });
    await tx.insert(units).values(
      sems.flatMap((s) => Array.from({ length: DEFAULT_UNITS() }, (_, i) => ({ semesterId: s.id, courseId: course.id, ownerId: userId, number: i + 1, position: i }))),
    );
    return course;
  });
}

/** Saves what the teacher teaches and creates one class per subject and grade. */
export async function buildWorkspace(userId: string, subjectCodes: string[], grades: number[], academicYear: string) {
  const db = await getDb();
  await db.delete(teacherSubjects).where(eq(teacherSubjects.userId, userId));
  await db.delete(teacherGrades).where(eq(teacherGrades.userId, userId));
  await db.insert(teacherSubjects).values(subjectCodes.map((subjectCode) => ({ userId, subjectCode })));
  await db.insert(teacherGrades).values(grades.map((grade) => ({ userId, grade })));
  const known = new Map((await listSubjects()).map((s) => [s.code, s]));
  for (const subjectCode of subjectCodes) {
    const applicable = known.get(subjectCode)?.grades ?? [];
    for (const grade of grades) {
      if (applicable.length && !applicable.includes(grade)) continue;
      await createCourse(userId, { subjectCode, grade, academicYear });
    }
  }
}

export async function teaching(userId: string) {
  const db = await getDb();
  const s = await db.select({ code: teacherSubjects.subjectCode }).from(teacherSubjects).where(eq(teacherSubjects.userId, userId));
  const g = await db.select({ grade: teacherGrades.grade }).from(teacherGrades).where(eq(teacherGrades.userId, userId)).orderBy(asc(teacherGrades.grade));
  return { subjects: s.map((x) => x.code), grades: g.map((x) => x.grade) };
}

export async function archiveCourse(userId: string, id: string) {
  const db = await getDb();
  const [row] = await db.update(courses).set({ archivedAt: new Date() }).where(and(eq(courses.id, id), eq(courses.ownerId, userId))).returning({ id: courses.id });
  return !!row;
}

export async function listSemesters(userId: string, courseId: string): Promise<SemesterDTO[]> {
  const db = await getDb();
  const rows = await db.select().from(semesters).where(and(eq(semesters.courseId, courseId), eq(semesters.ownerId, userId))).orderBy(asc(semesters.position));
  const unitRows = await db.select({ semesterId: units.semesterId, n: count() }).from(units).where(eq(units.courseId, courseId)).groupBy(units.semesterId);
  const resRows = await db
    .select({ semesterId: units.semesterId, n: count() })
    .from(resources).innerJoin(units, eq(units.id, resources.unitId))
    .where(and(liveResources(userId), eq(resources.courseId, courseId))).groupBy(units.semesterId);
  const pick = (list: { semesterId: string; n: number }[], id: string) => Number(list.find((x) => x.semesterId === id)?.n ?? 0);
  return rows.map((s) => ({ id: s.id, courseId, position: s.position, name: s.name, unitCount: pick(unitRows, s.id), resourceCount: pick(resRows, s.id) }));
}

export async function addSemester(userId: string, courseId: string, name: string) {
  const db = await getDb();
  if (!(await getCourse(userId, courseId))) return null;
  const [{ m }] = await db.select({ m: max(semesters.position) }).from(semesters).where(eq(semesters.courseId, courseId));
  const [row] = await db.insert(semesters).values({ courseId, ownerId: userId, position: Number(m ?? 0) + 1, name }).returning();
  return row;
}

export async function listUnits(userId: string, semesterId: string): Promise<UnitDTO[]> {
  const db = await getDb();
  const stats = db.select({ unitId: resources.unitId, n: count().as("n") }).from(resources).where(liveResources(userId)).groupBy(resources.unitId).as("stats");
  const rows = await db
    .select({ u: units, n: stats.n })
    .from(units).leftJoin(stats, eq(stats.unitId, units.id))
    .where(and(eq(units.semesterId, semesterId), eq(units.ownerId, userId)))
    .orderBy(asc(units.position));
  return rows.map(({ u, n }) => ({ id: u.id, semesterId: u.semesterId, courseId: u.courseId, number: u.number, title: u.title, resourceCount: Number(n ?? 0) }));
}

export async function addUnit(userId: string, semesterId: string, title: string | null) {
  const db = await getDb();
  const [sem] = await db.select().from(semesters).where(and(eq(semesters.id, semesterId), eq(semesters.ownerId, userId)));
  if (!sem) return null;
  const [{ n, p }] = await db.select({ n: max(units.number), p: max(units.position) }).from(units).where(eq(units.semesterId, semesterId));
  const [row] = await db
    .insert(units)
    .values({ semesterId, courseId: sem.courseId, ownerId: userId, number: Number(n ?? 0) + 1, position: Number(p ?? -1) + 1, title })
    .returning();
  return row;
}

export async function renameUnit(userId: string, unitId: string, title: string | null) {
  const db = await getDb();
  const [row] = await db.update(units).set({ title }).where(and(eq(units.id, unitId), eq(units.ownerId, userId))).returning();
  return row ?? null;
}

/** A unit can be removed only while it holds no resources, including ones in the trash. */
export async function deleteUnit(userId: string, unitId: string): Promise<"ok" | "not_found" | "not_empty"> {
  const db = await getDb();
  const [u] = await db.select({ id: units.id }).from(units).where(and(eq(units.id, unitId), eq(units.ownerId, userId)));
  if (!u) return "not_found";
  const [{ n }] = await db.select({ n: count() }).from(resources).where(eq(resources.unitId, unitId));
  if (Number(n) > 0) return "not_empty";
  await db.delete(units).where(eq(units.id, unitId));
  return "ok";
}

/** Where a unit sits, for breadcrumbs and for the assistant's context. */
export async function unitPath(userId: string, unitId: string) {
  const db = await getDb();
  const [row] = await db
    .select({ unit: units, semester: semesters })
    .from(units).innerJoin(semesters, eq(semesters.id, units.semesterId))
    .where(and(eq(units.id, unitId), eq(units.ownerId, userId)));
  if (!row) return null;
  const course = await getCourse(userId, row.unit.courseId);
  return course ? { course, semester: row.semester, unit: row.unit } : null;
}

/** Sections of a unit. The default ones are created the first time the unit is opened. */
export async function listSections(userId: string, unitId: string): Promise<SectionDTO[]> {
  const db = await getDb();
  const [claimed] = await db
    .update(units).set({ sectionsReady: true })
    .where(and(eq(units.id, unitId), eq(units.ownerId, userId), eq(units.sectionsReady, false)))
    .returning({ courseId: units.courseId });
  if (claimed) {
    const types = await db.select().from(sectionTypes).where(eq(sectionTypes.isActive, true)).orderBy(asc(sectionTypes.sortOrder));
    await db.insert(sections).values(
      types.map((t, i) => ({ unitId, courseId: claimed.courseId, ownerId: userId, typeKey: t.key, icon: t.icon, color: t.color, position: i })),
    );
  }
  const stats = db.select({ sectionId: resources.sectionId, n: count().as("n") }).from(resources).where(liveResources(userId)).groupBy(resources.sectionId).as("stats");
  const rows = await db
    .select({ s: sections, t: sectionTypes, n: stats.n })
    .from(sections)
    .leftJoin(sectionTypes, eq(sectionTypes.key, sections.typeKey))
    .leftJoin(stats, eq(stats.sectionId, sections.id))
    .where(and(eq(sections.unitId, unitId), eq(sections.ownerId, userId)))
    .orderBy(asc(sections.position), asc(sections.createdAt));
  return rows.map(({ s, t, n }) => ({
    id: s.id, unitId: s.unitId, courseId: s.courseId, typeKey: s.typeKey, name: s.name,
    typeNameAr: t?.nameAr ?? null, typeNameEn: t?.nameEn ?? null,
    description: s.description, icon: s.icon, color: s.color, resourceCount: Number(n ?? 0),
    exts: t ? t.exts : null, links: t ? t.links : true,
  }));
}

export async function createSection(userId: string, unitId: string, input: { name: string; description?: string | null; icon: string; color: string }) {
  const db = await getDb();
  const [u] = await db.select().from(units).where(and(eq(units.id, unitId), eq(units.ownerId, userId)));
  if (!u) return null;
  await listSections(userId, unitId);
  const [{ p }] = await db.select({ p: max(sections.position) }).from(sections).where(eq(sections.unitId, unitId));
  const [row] = await db.insert(sections).values({ unitId, courseId: u.courseId, ownerId: userId, ...input, position: Number(p ?? -1) + 1 }).returning();
  return row;
}

export async function updateSection(userId: string, id: string, patch: Partial<{ name: string; description: string | null; icon: string; color: string }>) {
  const db = await getDb();
  const [row] = await db.update(sections).set(patch).where(and(eq(sections.id, id), eq(sections.ownerId, userId))).returning();
  return row ?? null;
}

export async function deleteSection(userId: string, id: string): Promise<"ok" | "not_found" | "not_empty"> {
  const db = await getDb();
  const [s] = await db.select({ id: sections.id }).from(sections).where(and(eq(sections.id, id), eq(sections.ownerId, userId)));
  if (!s) return "not_found";
  const [{ n }] = await db.select({ n: count() }).from(resources).where(eq(resources.sectionId, id));
  if (Number(n) > 0) return "not_empty";
  await db.delete(sections).where(eq(sections.id, id));
  return "ok";
}

