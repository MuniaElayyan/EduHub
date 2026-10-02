import { EmptyTrashButton } from "@/components/pages";
import { ResourceBrowser } from "@/components/resource-browser";
import { createT } from "@/lib/i18n";
import { listResources } from "@/server/services/resources";
import { getPrefs, requireTeacher } from "@/server/session";

export default async function TrashPage() {
  const user = await requireTeacher();
  const t = createT((await getPrefs()).locale);
  const resources = await listResources(user.id, { view: "trash" });
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold sm:text-3xl">{t("nav.trash")}</h1>
          <p className="mt-1 text-muted">{t("trash.hint")}</p>
        </div>
        <EmptyTrashButton count={resources.length} />
      </header>
      <ResourceBrowser resources={resources} showPlace toolbar={false} emptyTitle={t("trash.emptyTitle")} emptyBody={t("trash.emptyBody")} />
    </div>
  );
}
