import { notFound } from "next/navigation";
import { AddResourceButton, Breadcrumbs, SectionRail } from "@/components/pages";
import { ResourceBrowser } from "@/components/resource-browser";
import { courseTitle, createT, sectionLabel, semesterLabel, unitLabel } from "@/lib/i18n";
import { getCourse, listSections, listSemesters, listUnits } from "@/server/services/courses";
import { listResources } from "@/server/services/resources";
import { getPrefs, requireTeacher } from "@/server/session";

const UUID = /^[0-9a-f-]{36}$/i;
type Params = { courseId: string; semesterId: string; unitId: string; sectionId: string };

export default async function SectionPage({ params }: { params: Promise<Params> }) {
  const { courseId, semesterId, unitId, sectionId } = await params;
  if (![courseId, semesterId, unitId, sectionId].every((v) => UUID.test(v))) notFound();
  const user = await requireTeacher();
  const { locale } = await getPrefs();
  const t = createT(locale);
  const course = await getCourse(user.id, courseId);
  const semester = course ? (await listSemesters(user.id, courseId)).find((s) => s.id === semesterId) : null;
  const unit = semester ? (await listUnits(user.id, semesterId)).find((u) => u.id === unitId) : null;
  if (!course || !semester || !unit) notFound();
  const sections = await listSections(user.id, unitId);
  const section = sections.find((s) => s.id === sectionId);
  if (!section) notFound();
  const resources = await listResources(user.id, { sectionId, sort: "manual" });
  const semesterHref = `/app/classes/${course.id}/${semester.id}`;
  const base = `${semesterHref}/${unit.id}`;
  const name = sectionLabel(locale, section);

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[
        { label: t("nav.home"), href: "/app" },
        { label: courseTitle(t, locale, course), href: `/app/classes/${course.id}` },
        { label: semesterLabel(t, semester), href: semesterHref },
        { label: unitLabel(t, unit), href: base },
        { label: name },
      ]} />
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold sm:text-3xl" dir="auto">{name}</h1>
          <p className="mt-1 text-muted">{section.description || t("dash.resourceCount", { n: resources.length })}</p>
        </div>
        <AddResourceButton label={t("add.toSection", { name })} />
      </header>
      <SectionRail sections={sections} base={base} activeId={section.id} />
      <ResourceBrowser resources={resources} addButton reorderSectionId={section.id} emptyTitle={t("section.emptyTitle", { name })} emptyBody={t("section.emptyBody")} />
    </div>
  );
}
