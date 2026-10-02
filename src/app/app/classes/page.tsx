import { CourseGrid } from "@/components/pages";
import { createT } from "@/lib/i18n";
import { listCourses } from "@/server/services/courses";
import { getPrefs, requireTeacher } from "@/server/session";

export default async function ClassesPage() {
  const user = await requireTeacher();
  const t = createT((await getPrefs()).locale);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold sm:text-3xl">{t("nav.myClasses")}</h1>
        <p className="mt-1 text-muted">{t("classPage.listHint")}</p>
      </div>
      <CourseGrid courses={await listCourses(user.id)} />
    </div>
  );
}
