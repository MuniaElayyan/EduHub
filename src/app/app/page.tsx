import { AiShortcut, CourseGrid, Greeting, QuickActions } from "@/components/pages";
import { ResourceBrowser } from "@/components/resource-browser";
import { createT, plural } from "@/lib/i18n";
import { listCourses } from "@/server/services/courses";
import { listResources, resourceCount } from "@/server/services/resources";
import { getPrefs, requireTeacher } from "@/server/session";

/** The dashboard is assembled from this teacher's own subjects, classes, activity and saved AI work. */
export default async function DashboardPage() {
  const user = await requireTeacher();
  const { locale } = await getPrefs();
  const t = createT(locale);
  const [courses, total, inProgress, recent, notes] = await Promise.all([
    listCourses(user.id),
    resourceCount(user.id),
    listResources(user.id, { view: "recent", limit: 4 }),
    listResources(user.id, { limit: 8 }),
    listResources(user.id, { type: "note", limit: 3 }),
  ]);

  return (
    <div className="space-y-10">
      <section>
        <Greeting firstName={user.firstName ?? ""} gender={user.gender} />
        <p className="mt-1 text-muted">
          {t("dash.summary", { classes: plural(t, locale, "dash.classesCount", courses.length), resources: plural(t, locale, "dash.resourcesCount", total) })}
        </p>
        <div className="mt-5"><QuickActions /></div>
      </section>

      <section aria-labelledby="my-classes">
        <h2 id="my-classes" className="mb-4 text-xl font-semibold">{t("nav.myClasses")}</h2>
        <CourseGrid courses={courses} />
      </section>

      {inProgress.length > 0 && (
        <section aria-labelledby="continue-working">
          <h2 id="continue-working" className="mb-4 text-xl font-semibold">{t("dash.continueWorking")}</h2>
          <ResourceBrowser resources={inProgress} showPlace toolbar={false} emptyTitle="" />
        </section>
      )}

      <section aria-labelledby="recent-resources">
        <h2 id="recent-resources" className="mb-4 text-xl font-semibold">{t("dash.recentResources")}</h2>
        <ResourceBrowser resources={recent} showPlace toolbar={false} addButton emptyTitle={t("dash.emptyTitle")} emptyBody={t("dash.emptyBody")} />
      </section>

      <AiShortcut notes={notes} />
    </div>
  );
}
