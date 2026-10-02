import {
  ClipboardList, Globe, History, KeyRound, Laptop, LayoutGrid, Lock, Mail, Search, ShieldCheck, Smartphone, Sparkles, Tablet, Users,
} from "lucide-react";
import Link from "next/link";
import { HeroScene } from "@/components/hero-scene";
import { LangSwitch, Logo, ThemeSwitch } from "@/components/ui";
import { createT } from "@/lib/i18n";
import { SOCIAL_LINKS } from "@/lib/site";
import { getCurrentUser, getPrefs } from "@/server/session";

const WHY = [
  { key: "organize", icon: LayoutGrid },
  { key: "classes", icon: Users },
  { key: "quick", icon: Search },
  { key: "ai", icon: Sparkles },
  { key: "planning", icon: ClipboardList },
  { key: "bilingual", icon: Globe },
  { key: "devices", icon: Smartphone },
] as const;

const TRUST = [
  { key: "private", icon: Lock },
  { key: "passwords", icon: KeyRound },
  { key: "sessions", icon: ShieldCheck },
  { key: "trash", icon: History },
  { key: "codes", icon: Mail },
] as const;

export default async function LandingPage() {
  const [{ locale }, user] = await Promise.all([getPrefs(), getCurrentUser()]);
  const t = createT(locale);
  const primaryHref = user ? "/app" : "/register";
  const primaryLabel = user ? t("landing.openWorkspace") : t("landing.start");

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-40 border-b border-line/70 bg-bg/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <Link href="/" aria-label="EduHub"><Logo /></Link>
          <nav aria-label={t("landing.navLabel")} className="hidden items-center gap-6 text-sm font-medium text-muted lg:flex">
            <a className="hover:text-ink" href="#why">{t("landing.navWhy")}</a>
            <a className="hover:text-ink" href="#how">{t("landing.navHow")}</a>
            <a className="hover:text-ink" href="#assistant">{t("landing.navAi")}</a>
            <a className="hover:text-ink" href="#trust">{t("landing.navTrust")}</a>
          </nav>
          <div className="flex items-center gap-2 sm:gap-3">
            <LangSwitch className="hidden sm:inline-flex" />
            <div className="hidden md:block"><ThemeSwitch /></div>
            {!user && <Link href="/login" className="btn btn-ghost btn-sm">{t("auth.login")}</Link>}
            <Link href={primaryHref} className="btn btn-primary btn-sm">{primaryLabel}</Link>
          </div>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-16 pt-10 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:gap-14 lg:pb-24 lg:pt-16">
          <div>
            <p className="mb-3 font-display text-lg font-semibold text-brand">{t("landing.kicker")}</p>
            <h1 className="text-[2.1rem] font-bold leading-[1.2] sm:text-5xl sm:leading-[1.15] lg:text-[3.4rem]">{t("landing.heroTitle")}</h1>
            <p className="mt-5 max-w-xl text-lg text-muted">{t("landing.heroSubtitle")}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href={primaryHref} className="btn btn-accent px-6 text-base">{primaryLabel}</Link>
              {!user && <Link href="/login" className="btn btn-outline px-6 text-base">{t("auth.login")}</Link>}
            </div>
            <p className="mt-5 text-sm text-muted">{t("landing.heroNote")}</p>
            <LangSwitch className="mt-6 sm:hidden" />
          </div>
          <HeroScene />
        </section>

        {/* What is EduHub */}
        <section className="border-y border-line bg-surface">
          <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 lg:py-20">
            <h2 className="text-2xl font-bold sm:text-3xl">{t("landing.whatTitle")}</h2>
            <p className="mt-4 max-w-3xl text-lg text-muted">{t("landing.whatBody")}</p>
          </div>
        </section>

        {/* Why */}
        <section id="why" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-14 sm:px-6 lg:py-20">
          <h2 className="text-2xl font-bold sm:text-3xl">{t("landing.whyTitle")}</h2>
          <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {WHY.map(({ key, icon: Icon }, i) => (
              <li key={key} className={`card p-5 ${i === 0 ? "sm:col-span-2 lg:col-span-2 lg:row-span-1" : ""}`}>
                <span className="grid size-10 place-items-center rounded-xl bg-brand-soft text-brand"><Icon className="size-5" aria-hidden /></span>
                <h3 className="mt-4 text-lg font-semibold">{t(`landing.why.${key}.title`)}</h3>
                <p className="mt-1.5 text-muted">{t(`landing.why.${key}.body`)}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* How it works: a real sequence, so it is numbered */}
        <section id="how" className="scroll-mt-20 bg-board text-board-ink">
          <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 lg:py-20">
            <h2 className="text-2xl font-bold sm:text-3xl">{t("landing.howTitle")}</h2>
            <ol className="mt-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
              {[1, 2, 3, 4].map((n) => (
                <li key={n} className="border-t border-board-ink/25 pt-5">
                  <span className="font-display text-4xl font-bold text-accent">{n}</span>
                  <h3 className="mt-3 text-lg font-semibold">{t(`landing.how.${n}.title`)}</h3>
                  <p className="mt-1.5 text-board-ink/75">{t(`landing.how.${n}.body`)}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Feature showcase: the workspace, drawn in miniature */}
        <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6 lg:py-20">
          <h2 className="text-2xl font-bold sm:text-3xl">{t("landing.showTitle")}</h2>
          <p className="mt-3 max-w-2xl text-lg text-muted">{t("landing.showBody")}</p>
          <div aria-hidden className="card mt-8 overflow-hidden shadow-soft">
            <div className="flex items-center gap-1.5 border-b border-line bg-surface2 px-4 py-2.5">
              <span className="size-2.5 rounded-full bg-line" /><span className="size-2.5 rounded-full bg-line" /><span className="size-2.5 rounded-full bg-line" />
            </div>
            <div className="grid sm:grid-cols-[11rem_1fr]">
              <div className="hidden space-y-1 border-e border-line p-3 text-sm sm:block">
                {["home", "favorites", "recent", "trash"].map((k, i) => (
                  <div key={k} className={`rounded-lg px-3 py-2 ${i === 0 ? "bg-brand-soft font-semibold text-brand" : "text-muted"}`}>{t(`nav.${k}`)}</div>
                ))}
              </div>
              <div className="p-4 sm:p-6">
                <p className="font-display text-xl font-semibold">{t("landing.showHello")}</p>
                <p className="text-sm text-muted">{t("dash.subtitle")}</p>
                <div className="mt-4 flex flex-wrap gap-2 text-sm">
                  {["addClass", "addResource", "upload", "addLink", "askAi"].map((k) => (
                    <span key={k} className="rounded-lg border border-line px-3 py-1.5">{t(`dash.quick.${k}`)}</span>
                  ))}
                </div>
                <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[{ g: 4, c: "coral" }, { g: 6, c: "blue" }, { g: 7, c: "green" }].map(({ g, c }) => (
                    <div key={g} data-color={c} className="notebook aspect-[4/5] p-2 ps-6">
                      <div className="notebook-label text-xs font-semibold">{t(`grades.${g}`)}</div>
                    </div>
                  ))}
                  <div className="grid aspect-[4/5] place-items-center rounded-2xl border-2 border-dashed border-line text-sm font-semibold text-muted">
                    + {t("dash.quick.addClass")}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* AI assistant */}
        <section id="assistant" className="scroll-mt-20 border-y border-line bg-surface">
          <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-14 sm:px-6 lg:grid-cols-2 lg:py-20">
            <div>
              <h2 className="text-2xl font-bold sm:text-3xl">{t("landing.aiTitle")}</h2>
              <p className="mt-4 text-lg text-muted">{t("landing.aiBody")}</p>
              <ul className="mt-6 space-y-2.5">
                {[1, 2, 3].map((n) => (
                  <li key={n} className="flex gap-3">
                    <Sparkles className="mt-1 size-4 shrink-0 text-brand" aria-hidden />
                    <span>{t(`landing.aiPoints.${n}`)}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div aria-hidden className="rounded-2xl border border-line bg-bg p-4 sm:p-5">
              <div className="ms-auto w-fit max-w-[85%] rounded-2xl rounded-ee-md bg-brand px-4 py-2.5 text-brand-ink">{t("landing.aiDemoAsk")}</div>
              <div className="mt-3 max-w-[92%] rounded-2xl rounded-es-md border border-line bg-surface px-4 py-3">
                <p className="font-semibold">{t("landing.aiDemoAnswerTitle")}</p>
                <p className="mt-1 text-sm text-muted">{t("landing.aiDemoAnswerBody")}</p>
                <div className="mt-3 flex flex-wrap gap-2 text-sm">
                  <span className="rounded-lg bg-brand-soft px-3 py-1.5 font-medium text-brand">{t("ai.saveAsNote")}</span>
                  <span className="rounded-lg border border-line px-3 py-1.5">{t("common.edit")}</span>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2 text-sm text-muted">
                {["lesson_plan", "quiz", "summary", "worksheet"].map((a) => (
                  <span key={a} className="rounded-full border border-line px-3 py-1">{t(`ai.actions.${a}`)}</span>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Multi-device */}
        <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6 lg:py-20">
          <h2 className="text-2xl font-bold sm:text-3xl">{t("landing.devicesTitle")}</h2>
          <p className="mt-3 max-w-2xl text-lg text-muted">{t("landing.devicesBody")}</p>
          <ul className="mt-8 grid gap-4 sm:grid-cols-3">
            {[{ k: "desktop", icon: Laptop }, { k: "tablet", icon: Tablet }, { k: "mobile", icon: Smartphone }].map(({ k, icon: Icon }) => (
              <li key={k} className="flex items-start gap-4 border-t-2 border-brand pt-4">
                <Icon className="size-7 shrink-0 text-brand" aria-hidden />
                <div>
                  <h3 className="font-semibold">{t(`landing.devices.${k}.title`)}</h3>
                  <p className="text-muted">{t(`landing.devices.${k}.body`)}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        {/* Security and trust: only things the product actually does */}
        <section id="trust" className="scroll-mt-20 border-y border-line bg-surface">
          <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 lg:py-20">
            <h2 className="text-2xl font-bold sm:text-3xl">{t("landing.trustTitle")}</h2>
            <p className="mt-3 max-w-2xl text-lg text-muted">{t("landing.trustBody")}</p>
            <dl className="mt-8 grid gap-x-10 gap-y-6 sm:grid-cols-2">
              {TRUST.map(({ key, icon: Icon }) => (
                <div key={key} className="flex gap-4">
                  <Icon className="mt-1 size-5 shrink-0 text-brand" aria-hidden />
                  <div>
                    <dt className="font-semibold">{t(`landing.trust.${key}.title`)}</dt>
                    <dd className="text-muted">{t(`landing.trust.${key}.body`)}</dd>
                  </div>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* Final call to action */}
        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-24">
          <div className="rounded-[1.75rem] bg-board px-6 py-12 text-center text-board-ink sm:px-10 sm:py-16">
            <h2 className="mx-auto max-w-2xl text-3xl font-bold sm:text-4xl">{t("landing.finalTitle")}</h2>
            <Link href={primaryHref} className="btn btn-accent mt-8 px-8 text-base">{primaryLabel}</Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-line bg-surface">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:px-6 md:flex-row md:items-start md:justify-between">
          <div>
            <Logo />
            <p className="mt-2 max-w-xs text-sm text-muted">{t("landing.footerTagline")}</p>
          </div>
          <nav aria-label={t("landing.footerLabel")} className="grid grid-cols-2 gap-x-10 gap-y-2 text-sm sm:grid-cols-3">
            {["about", "contact", "help", "privacy", "terms"].map((slug) => (
              <Link key={slug} href={`/info/${slug}`} className="text-muted hover:text-ink">{t(`info.${slug}.title`)}</Link>
            ))}
            {SOCIAL_LINKS.map((s) => (
              <a key={s.name} href={s.href} rel="noopener noreferrer" target="_blank" className="text-muted hover:text-ink">{s.name}</a>
            ))}
          </nav>
          <div className="flex flex-col items-start gap-3">
            <LangSwitch />
            <ThemeSwitch />
          </div>
        </div>
        <p className="border-t border-line px-4 py-4 text-center text-sm text-muted">© {new Date().getFullYear()} EduHub</p>
      </footer>
    </div>
  );
}
