import { SettingsPanel } from "@/components/pages";
import { createT } from "@/lib/i18n";
import { getPrefs, requireTeacher } from "@/server/session";

export default async function SettingsPage() {
  await requireTeacher();
  const t = createT((await getPrefs()).locale);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold sm:text-3xl">{t("nav.settings")}</h1>
      <SettingsPanel />
    </div>
  );
}
