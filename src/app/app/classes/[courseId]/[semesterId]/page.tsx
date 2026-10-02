import { notFound } from "next/navigation";
import { Breadcrumbs, UnitGrid } from "@/components/pages";
import { courseTitle, createT, semesterLabel } from "@/lib/i18n";
import { getCourse, listSemesters, listUnits } from "@/server/services/courses";
import { getPrefs, requireTeacher } from "@/server/session";

const UUID = /^[0-9a-f-]{36}$/i;

export default async function SemesterPage({ params }: { params: Promise<{ courseId: string; semesterId: string }> }) {
  const { courseId, semesterId } = await params;
  if (!UUID.test(courseId) || !UUID.test(semesterId)) notFound();
  const user = await requireTeacher();
  const { locale } = await getPrefs();
  const t = createT(locale);
  const course = await getCourse(user.id, courseId);
  const semester = course ? (await listSemesters(user.id, courseId)).find((s) => s.id === semesterId) : null;
  if (!course || !semester) notFound();
  const units = await listUnits(user.id, semesterId);
  const name = semesterLabel(t, semester);

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: t("nav.home"), href: "/app" }, { label: courseTitle(t, locale, course), href: `/app/classes/${course.id}` }, { label: name }]} />
      <div>
        <h1 className="text-2xl font-bold sm:text-3xl">{name}</h1>
        <p className="mt-1 text-muted">{t("classPage.chooseUnit")}</p>
      </div>
      <UnitGrid courseId={course.id} semesterId={semester.id} color={course.color} units={units} />
    </div>
  );
}
