import Link from "next/link";
import { LangSwitch, Logo, ThemeSwitch } from "@/components/ui";
import { createT } from "@/lib/i18n";
import { getPrefs } from "@/server/session";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const t = createT((await getPrefs()).locale);
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_minmax(0,28rem)]">
      <div className="flex flex-col px-4 py-5 sm:px-8">
        <header className="flex items-center justify-between">
          <Link href="/" aria-label="EduHub"><Logo /></Link>
          <div className="flex items-center gap-3"><LangSwitch /><ThemeSwitch /></div>
        </header>
        <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center py-10">{children}</main>
      </div>
      <aside aria-hidden className="hidden flex-col justify-end bg-board p-10 text-board-ink lg:flex">
        <p className="font-display text-3xl font-semibold leading-snug">{t("landing.heroTitle")}</p>
        <p className="mt-4 text-board-ink/70">{t("landing.footerTagline")}</p>
      </aside>
    </div>
  );
}
