import { notFound } from "next/navigation";
import { Breadcrumbs, SemesterCards } from "@/components/pages";
import { courseTitle, createT, gradeLabel, subjectLabel } from "@/lib/i18n";
import { getCourse, listSemesters } from "@/server/services/courses";
import { getPrefs, requireTeacher } from "@/server/session";

const UUID = /^[0-9a-f-]{36}$/i;

export default async function CoursePage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  if (!UUID.test(courseId)) notFound();
  const user = await requireTeacher();
  const { locale } = await getPrefs();
  const t = createT(locale);
  const course = await getCourse(user.id, courseId);
  if (!course) notFound();
  const semesters = await listSemesters(user.id, courseId);

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: t("nav.home"), href: "/app" }, { label: courseTitle(t, locale, course) }]} />
      <header data-color={course.color} className="flex items-center gap-4 rounded-2xl border border-line bg-surface p-4 sm:p-5">
        <span aria-hidden className="notebook h-16 w-12 shrink-0 !shadow-none" />
        <div>
          <h1 className="text-2xl font-bold sm:text-3xl">{gradeLabel(t, course.grade)}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className="chip">{subjectLabel(locale, course)}</span>
            <span className="chip">{t("profile.academicYear")} <span dir="ltr">{course.academicYear}</span></span>
          </div>
        </div>
      </header>
      <section aria-labelledby="semesters">
        <h2 id="semesters" className="mb-4 text-xl font-semibold">{t("classPage.chooseSemester")}</h2>
        <SemesterCards courseId={course.id} color={course.color} semesters={semesters} />
      </section>
    </div>
  );
}
