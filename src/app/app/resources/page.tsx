import { ResourceBrowser } from "@/components/resource-browser";
import { createT } from "@/lib/i18n";
import { listResources } from "@/server/services/resources";
import { getPrefs, requireTeacher } from "@/server/session";

/** Everything the teacher has, in one place, searchable and filterable by class, unit, section and type. */
export default async function MyResourcesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const q = ((await searchParams).q ?? "").slice(0, 120).trim();
  const user = await requireTeacher();
  const t = createT((await getPrefs()).locale);
  const resources = await listResources(user.id, { limit: 500 });
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold sm:text-3xl">{t("nav.myResources")}</h1>
        <p className="mt-1 text-muted">{t("search.hint")}</p>
      </div>
      <ResourceBrowser key={q} resources={resources} showPlace addButton initialQuery={q} emptyTitle={t("dash.emptyTitle")} emptyBody={t("dash.emptyBody")} />
    </div>
  );
}
