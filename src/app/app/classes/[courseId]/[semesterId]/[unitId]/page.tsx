import { notFound } from "next/navigation";
import { Breadcrumbs, SectionGrid, UnitActions } from "@/components/pages";
import { ResourceBrowser } from "@/components/resource-browser";
import { courseTitle, createT, semesterLabel, unitLabel } from "@/lib/i18n";
import { getCourse, listSections, listSemesters, listUnits } from "@/server/services/courses";
import { listResources } from "@/server/services/resources";
import { getPrefs, requireTeacher } from "@/server/session";

const UUID = /^[0-9a-f-]{36}$/i;

export default async function UnitPage({ params }: { params: Promise<{ courseId: string; semesterId: string; unitId: string }> }) {
  const { courseId, semesterId, unitId } = await params;
  if (![courseId, semesterId, unitId].every((v) => UUID.test(v))) notFound();
  const user = await requireTeacher();
  const { locale } = await getPrefs();
  const t = createT(locale);
  const course = await getCourse(user.id, courseId);
  const semester = course ? (await listSemesters(user.id, courseId)).find((s) => s.id === semesterId) : null;
  const unit = semester ? (await listUnits(user.id, semesterId)).find((u) => u.id === unitId) : null;
  if (!course || !semester || !unit) notFound();
  const [sections, resources] = await Promise.all([listSections(user.id, unitId), listResources(user.id, { unitId })]);
  const semesterHref = `/app/classes/${course.id}/${semester.id}`;
  const base = `${semesterHref}/${unit.id}`;
  const name = unitLabel(t, unit);

  return (
    <div className="space-y-8">
      <Breadcrumbs items={[
        { label: t("nav.home"), href: "/app" },
        { label: courseTitle(t, locale, course), href: `/app/classes/${course.id}` },
        { label: semesterLabel(t, semester), href: semesterHref },
        { label: name },
      ]} />
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold sm:text-3xl" dir="auto">{name}</h1>
        <UnitActions unit={unit} backHref={semesterHref} />
      </header>
      <section aria-labelledby="sections">
        <h2 id="sections" className="mb-4 text-xl font-semibold">{t("classPage.sections")}</h2>
        <SectionGrid unitId={unit.id} base={base} sections={sections} />
      </section>
      {resources.length > 0 && (
        <section aria-labelledby="unit-resources">
          <h2 id="unit-resources" className="mb-4 text-xl font-semibold">{t("classPage.unitResources")}</h2>
          <ResourceBrowser resources={resources} emptyTitle="" />
        </section>
      )}
    </div>
  );
}
