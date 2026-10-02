import { ResourceBrowser } from "@/components/resource-browser";
import { createT } from "@/lib/i18n";
import { listResources } from "@/server/services/resources";
import { getPrefs, requireTeacher } from "@/server/session";

export default async function Page() {
  const user = await requireTeacher();
  const t = createT((await getPrefs()).locale);
  const resources = await listResources(user.id, { view: "recent", limit: 40 });
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold sm:text-3xl">{t("nav.recent")}</h1>
      <ResourceBrowser resources={resources} showPlace emptyTitle={t("recent.emptyTitle")} emptyBody={t("recent.emptyBody")} />
    </div>
  );
}
