"use client";

import {
  Bell, ChevronDown, Clock, GraduationCap, Home, Layers, LogOut, Menu, Plus, Search, Settings, Sparkles, Star, Trash2, X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { api } from "@/lib/api";
import { formatBytes, timeAgo } from "@/lib/format";
import type { PublicUser } from "@/server/auth";
import type { CourseDTO, SectionDTO, SemesterDTO, SubjectDTO, UnitDTO } from "@/server/services/courses";
import type { ResourceDTO } from "@/server/services/resources";
import { AddResourceModal, type AddPreset } from "./add-resource";
import { AiAssistant } from "./ai-assistant";
import { AddCourseModal } from "./class-modals";
import { usePrefs } from "./providers";
import { ResourceDrawer } from "./resource-drawer";
import { LangSwitch, Logo, ThemeSwitch } from "./ui";

/** Where the teacher is standing, read from the address: /app/classes/<course>/<semester>/<unit>/<section> */
export type Here = { courseId?: string; semesterId?: string; unitId?: string; sectionId?: string };

type Workspace = {
  user: PublicUser;
  courses: CourseDTO[];
  subjects: SubjectDTO[];
  storage: { used: number; quota: number };
  here: Here;
  activeResource: ResourceDTO | null;
  openResource: (r: ResourceDTO | null) => void;
  openAdd: (preset?: AddPreset) => void;
  openAddCourse: () => void;
  /** opens the assistant; pass a resource to ask about that file */
  openAi: (opts?: { prompt?: string; resource?: ResourceDTO }) => void;
  getSemesters: (courseId: string) => Promise<SemesterDTO[]>;
  getUnits: (semesterId: string) => Promise<UnitDTO[]>;
  getSections: (unitId: string) => Promise<SectionDTO[]>;
  /** re-reads server data after a change */
  refresh: () => void;
};

const Ctx = createContext<Workspace | null>(null);
export function useWorkspace() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useWorkspace must be used inside the workspace layout");
  return ctx;
}

export const displayName = (u: PublicUser) => [u.firstName, u.lastName].filter(Boolean).join(" ");

export function Avatar({ user, className = "size-9" }: { user: PublicUser; className?: string }) {
  return (
    <span className={`grid shrink-0 place-items-center overflow-hidden rounded-full bg-brand-soft font-semibold text-brand ${className}`}>
      {user.avatarFileId
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={`/api/v1/files/${user.avatarFileId}`} alt="" className="size-full object-cover" />
        : (user.firstName ?? "?").slice(0, 1)}
    </span>
  );
}

/** Small popover for the profile and notification menus. Closes on outside click and Escape. */
function Popover({ button, children, label }: { button: ReactNode; children: (close: () => void) => ReactNode; label: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-haspopup="true" aria-expanded={open} aria-label={label} onClick={() => setOpen(!open)} className="flex items-center gap-2 rounded-xl p-1 hover:bg-surface2">
        {button}
      </button>
      {open && (
        <div className="pop-in absolute end-0 top-full z-50 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-2xl border border-line bg-surface p-2 shadow-soft">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

type Notice = { id: string; type: string; createdAt: string };

function Notifications() {
  const { t, locale } = usePrefs();
  const [items, setItems] = useState<Notice[]>([]);
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    api<{ notifications: Notice[]; unread: number }>("/notifications")
      .then((d) => {
        setItems(d.notifications);
        setUnread(d.unread);
      })
      .catch(() => {});
  }, []);
  return (
    <Popover
      label={t("notifications.title")}
      button={
        <span
          className="relative grid size-9 place-items-center"
          onClick={() => {
            if (unread) void api("/notifications/read", { body: {} }).catch(() => {});
            setUnread(0);
          }}
        >
          <Bell className="size-5" />
          {unread > 0 && <span className="absolute end-1.5 top-1.5 size-2.5 rounded-full border-2 border-surface bg-accent" />}
        </span>
      }
    >
      {() => (
        <div>
          <p className="px-3 py-2 font-semibold">{t("notifications.title")}</p>
          {items.length === 0 && <p className="px-3 pb-3 text-sm text-muted">{t("notifications.empty")}</p>}
          <ul>
            {items.map((n) => (
              <li key={n.id} className="rounded-lg px-3 py-2 text-sm">
                <p>{t(`notifications.${n.type}`)}</p>
                <p className="text-xs text-muted">{timeAgo(n.createdAt, locale)}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Popover>
  );
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const { t, locale } = usePrefs();
  const { storage, openAi } = useWorkspace();
  const pathname = usePathname();
  const links = [
    { href: "/app", label: t("nav.home"), icon: Home, exact: true },
    { href: "/app/classes", label: t("nav.myClasses"), icon: GraduationCap },
    { href: "/app/resources", label: t("nav.myResources"), icon: Layers },
    { href: "/app/favorites", label: t("nav.favorites"), icon: Star },
    { href: "/app/recent", label: t("nav.recent"), icon: Clock },
    null, // the assistant: an action, not a page
    { href: "/app/trash", label: t("nav.trash"), icon: Trash2 },
    { href: "/app/settings", label: t("nav.settings"), icon: Settings },
  ];
  const cls = (active: boolean) =>
    `flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-start text-base ${active ? "bg-brand-soft font-semibold text-brand" : "text-ink hover:bg-surface2"}`;
  const pct = Math.min(100, Math.round((storage.used / Math.max(storage.quota, 1)) * 100));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <nav aria-label={t("nav.menu")} className="flex-1 space-y-1 overflow-y-auto">
        {links.map((l) => {
          if (!l) {
            return (
              <button key="ai" type="button" className={cls(false)} onClick={() => { onNavigate?.(); openAi(); }}>
                <Sparkles className="size-5 shrink-0" aria-hidden />
                {t("ai.title")}
              </button>
            );
          }
          const active = l.exact ? pathname === l.href : pathname.startsWith(l.href);
          return (
            <Link key={l.href} href={l.href} onClick={onNavigate} aria-current={active ? "page" : undefined} className={cls(active)}>
              <l.icon className="size-5 shrink-0" aria-hidden />
              {l.label}
            </Link>
          );
        })}
      </nav>
      <div className="mt-4 border-t border-line px-3 pt-4">
        <div className="flex justify-between text-xs text-muted">
          <span>{t("dash.storage")}</span>
          <span dir="ltr">{formatBytes(storage.used, locale)} / {formatBytes(storage.quota, locale)}</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={t("dash.storage")}>
          <div className={`h-full rounded-full ${pct > 90 ? "bg-danger" : "bg-brand"}`} style={{ width: `${Math.max(pct, 2)}%` }} />
        </div>
      </div>
    </div>
  );
}

export function WorkspaceShell({
  user, courses, subjects, storage, children,
}: { user: PublicUser; courses: CourseDTO[]; subjects: SubjectDTO[]; storage: { used: number; quota: number }; children: ReactNode }) {
  const { t } = usePrefs();
  const router = useRouter();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeResource, setActiveResource] = useState<ResourceDTO | null>(null);
  const [addPreset, setAddPreset] = useState<AddPreset | null>(null);
  const [addCourseOpen, setAddCourseOpen] = useState(false);
  const [ai, setAi] = useState<{ open: boolean; prompt?: string; resource: ResourceDTO | null; nonce: number }>({ open: false, resource: null, nonce: 0 });
  const cache = useRef(new Map<string, Promise<unknown>>());

  const refresh = useCallback(() => {
    cache.current.clear();
    router.refresh();
  }, [router]);

  /** Lists of semesters, units and sections are fetched once and kept until something changes. */
  const cached = useCallback(<R,>(path: string, key: string) => {
    let p = cache.current.get(path) as Promise<R> | undefined;
    if (!p) {
      p = api<Record<string, R>>(path).then((d) => d[key]);
      p.catch(() => cache.current.delete(path));
      cache.current.set(path, p);
    }
    return p;
  }, []);

  const here = useMemo<Here>(() => {
    const m = pathname.match(/^\/app\/classes\/([^/]+)(?:\/([^/]+))?(?:\/([^/]+))?(?:\/([^/]+))?/);
    return { courseId: m?.[1], semesterId: m?.[2], unitId: m?.[3], sectionId: m?.[4] };
  }, [pathname]);

  const value = useMemo<Workspace>(
    () => ({
      user, courses, subjects, storage, here, activeResource,
      openResource: setActiveResource,
      openAdd: (preset) => setAddPreset({ ...here, ...preset }),
      openAddCourse: () => setAddCourseOpen(true),
      openAi: (opts) => {
        // The details drawer is modal; close it so the assistant is reachable, and carry the file over as context.
        if (opts?.resource) setActiveResource(null);
        setAi((s) => ({ open: true, prompt: opts?.prompt, resource: opts?.resource ?? s.resource, nonce: s.nonce + 1 }));
      },
      getSemesters: (courseId) => cached<SemesterDTO[]>(`/courses/${courseId}/semesters`, "semesters"),
      getUnits: (semesterId) => cached<UnitDTO[]>(`/semesters/${semesterId}/units`, "units"),
      getSections: (unitId) => cached<SectionDTO[]>(`/units/${unitId}/sections`, "sections"),
      refresh,
    }),
    [user, courses, subjects, storage, here, activeResource, cached, refresh],
  );

  function search(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const q = String(new FormData(e.currentTarget).get("q") ?? "").trim();
    if (q) router.push(`/app/resources?q=${encodeURIComponent(q)}`);
  }

  async function logout() {
    await api("/auth/logout", { body: {} }).catch(() => {});
    window.location.assign("/");
  }

  const bottom = [
    { href: "/app", label: t("nav.home"), icon: Home, exact: true },
    { href: "/app/classes", label: t("nav.myClasses"), icon: GraduationCap },
    null,
    { href: "/app/resources", label: t("nav.myResources"), icon: Layers },
    { href: "/app/favorites", label: t("nav.favorites"), icon: Star },
  ];

  return (
    <Ctx.Provider value={value}>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:z-[90] focus:rounded-lg focus:bg-surface focus:px-4 focus:py-2">
        {t("common.skipToContent")}
      </a>

      <aside className="fixed inset-y-0 start-0 z-30 hidden w-64 flex-col border-e border-line bg-surface p-4 lg:flex">
        <Link href="/app" className="mb-6 px-2" aria-label="EduHub"><Logo /></Link>
        <NavLinks />
      </aside>

      {menuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label={t("nav.menu")}>
          <button type="button" className="absolute inset-0 bg-black/50" aria-label={t("common.close")} onClick={() => setMenuOpen(false)} />
          <div className="pop-in absolute inset-y-0 start-0 flex w-[min(20rem,88vw)] flex-col bg-surface p-4">
            <div className="mb-4 flex items-center justify-between">
              <Logo />
              <button type="button" className="btn btn-ghost btn-icon" onClick={() => setMenuOpen(false)} aria-label={t("common.close")}><X className="size-5" /></button>
            </div>
            <NavLinks onNavigate={() => setMenuOpen(false)} />
            <div className="mt-4 flex items-center justify-between gap-2 border-t border-line pt-4">
              <LangSwitch />
              <ThemeSwitch />
            </div>
          </div>
        </div>
      )}

      <div className="lg:ps-64">
        <header className="sticky top-0 z-20 border-b border-line bg-bg/90 backdrop-blur">
          <div className="flex h-16 items-center gap-2 px-3 sm:px-6 lg:px-8">
            <button type="button" className="btn btn-ghost btn-icon lg:hidden" onClick={() => setMenuOpen(true)} aria-label={t("nav.menu")}><Menu className="size-5" /></button>
            <form onSubmit={search} role="search" className="relative hidden min-w-0 flex-1 sm:block sm:max-w-md">
              <Search aria-hidden className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
              <input name="q" type="search" className="input !min-h-10 !ps-9" placeholder={t("search.placeholder")} aria-label={t("search.placeholder")} />
            </form>
            <Link href="/app" className="sm:hidden" aria-label="EduHub"><Logo className="!text-lg" /></Link>
            <div className="ms-auto flex items-center gap-1 sm:gap-2">
              <Link href="/app/resources" className="btn btn-ghost btn-icon sm:hidden" aria-label={t("nav.search")}><Search className="size-5" /></Link>
              <button type="button" className="btn btn-outline btn-sm hidden md:inline-flex" onClick={() => value.openAi()}>
                <Sparkles className="size-4 text-brand" aria-hidden />
                {t("ai.title")}
              </button>
              <LangSwitch className="hidden xl:inline-flex" />
              <div className="hidden xl:block"><ThemeSwitch /></div>
              <Notifications />
              <Popover
                label={t("nav.profileMenu")}
                button={
                  <>
                    <Avatar user={user} />
                    <span className="hidden text-start leading-tight md:block">
                      <span className="block max-w-40 truncate text-sm font-semibold">{displayName(user)}</span>
                      <span className="block max-w-40 truncate text-xs text-muted">{user.schoolName}</span>
                    </span>
                    <ChevronDown className="hidden size-4 text-muted md:block" aria-hidden />
                  </>
                }
              >
                {(close) => (
                  <div>
                    <div className="px-3 py-2">
                      <p className="font-semibold">{[user.firstName, user.secondName, user.thirdName, user.lastName].filter(Boolean).join(" ")}</p>
                      <p className="text-sm text-muted">{user.schoolName}</p>
                      <p className="mt-1 text-xs text-muted">{t("profile.academicYear")} <span dir="ltr">{user.academicYear}</span></p>
                    </div>
                    <div className="my-1 border-t border-line" />
                    <Link href="/app/settings" onClick={close} className="flex min-h-11 items-center gap-3 rounded-xl px-3 hover:bg-surface2">
                      <Settings className="size-4" aria-hidden /> {t("nav.settings")}
                    </Link>
                    <button type="button" onClick={logout} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-start hover:bg-surface2">
                      <LogOut className="size-4" aria-hidden /> {t("nav.logout")}
                    </button>
                  </div>
                )}
              </Popover>
            </div>
          </div>
        </header>

        <main id="main" className="mx-auto max-w-7xl px-4 pb-32 pt-6 sm:px-6 lg:px-8 lg:pb-12">{children}</main>
      </div>

      <nav aria-label={t("nav.menu")} className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden">
        {bottom.map((b) =>
          b ? (
            <Link key={b.href} href={b.href} aria-current={(b.exact ? pathname === b.href : pathname.startsWith(b.href)) ? "page" : undefined}
              className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-[0.7rem] ${(b.exact ? pathname === b.href : pathname.startsWith(b.href)) ? "font-semibold text-brand" : "text-muted"}`}>
              <b.icon className="size-5" aria-hidden />
              {b.label}
            </Link>
          ) : (
            <button key="add" type="button" onClick={() => value.openAdd()} className="flex flex-col items-center justify-center" aria-label={t("dash.quick.addResource")}>
              <span className="grid size-11 place-items-center rounded-full bg-accent text-accent-ink shadow-soft"><Plus className="size-6" /></span>
            </button>
          ),
        )}
      </nav>

      <ResourceDrawer />
      <AddResourceModal preset={addPreset} onClose={() => setAddPreset(null)} />
      <AddCourseModal open={addCourseOpen} onClose={() => setAddCourseOpen(false)} />
      <AiAssistant
        state={ai}
        onOpenChange={(open) => setAi((s) => ({ ...s, open, prompt: undefined }))}
        onClearResource={() => setAi((s) => ({ ...s, resource: null }))}
      />
    </Ctx.Provider>
  );
}
