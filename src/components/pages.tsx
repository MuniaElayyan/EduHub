"use client";

import { ChevronLeft, ChevronRight, FolderPlus, Link2, Pencil, Plus, Sparkles, Trash2, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { api, errorText } from "@/lib/api";
import { academicYears } from "@/lib/constants";
import { deviceLabel, timeAgo } from "@/lib/format";
import { gradeLabel, semesterLabel, subjectLabel, unitLabel } from "@/lib/i18n";
import type { CourseDTO, SectionDTO, SemesterDTO, UnitDTO } from "@/server/services/courses";
import type { ResourceDTO } from "@/server/services/resources";
import { CodeInput, retryAfter, useCountdown } from "./auth-forms";
import { SectionModal } from "./class-modals";
import { usePrefs, useToast } from "./providers";
import { SectionTile } from "./resource-browser";
import { Field, FormError, LangSwitch, Modal, Spinner, ThemeSwitch } from "./ui";
import { useWorkspace } from "./workspace";

/** "Where am I, and how do I go back": always the full path from home. */
export function Breadcrumbs({ items }: { items: { label: string; href?: string }[] }) {
  const { t, locale } = usePrefs();
  const Sep = locale === "ar" ? ChevronLeft : ChevronRight;
  return (
    <nav aria-label={t("resource.breadcrumbs")}>
      <ol className="flex flex-wrap items-center gap-1.5 text-muted">
        {items.map((it, i) => (
          <li key={i} className="flex items-center gap-1.5">
            {i > 0 && <Sep className="size-4" aria-hidden />}
            {it.href ? <Link href={it.href} className="rounded-md py-1 hover:text-ink hover:underline">{it.label}</Link> : <span aria-current="page" className="font-semibold text-ink">{it.label}</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** Greets by the time on the teacher's own clock, which the server cannot know. */
export function Greeting({ firstName, gender }: { firstName: string; gender: string | null }) {
  const { t } = usePrefs();
  const [part, setPart] = useState<"hello" | "morning" | "evening">("hello");
  useEffect(() => setPart(new Date().getHours() < 12 ? "morning" : "evening"), []);
  const name = `${t(`dash.title.${gender === "female" ? "female" : "male"}`)} ${firstName}`.trim();
  return <h1 className="text-2xl font-bold sm:text-3xl">{t(`dash.greet.${part}`, { name })}</h1>;
}

export function QuickActions() {
  const { t } = usePrefs();
  const { openAdd, openAddCourse, openAi } = useWorkspace();
  const actions = [
    { key: "addResource", icon: Plus, run: () => openAdd() },
    { key: "upload", icon: Upload, run: () => openAdd() },
    { key: "addLink", icon: Link2, run: () => openAdd() },
    { key: "addClass", icon: FolderPlus, run: openAddCourse },
    { key: "askAi", icon: Sparkles, run: () => openAi() },
  ];
  return (
    <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
      {actions.map(({ key, icon: Icon, run }) => (
        <button key={key} type="button" onClick={run} className={`btn shrink-0 ${key === "addResource" ? "btn-primary" : "btn-outline"}`}>
          <Icon className="size-4" aria-hidden />
          {t(`dash.quick.${key}`)}
        </button>
      ))}
    </div>
  );
}

/** The teacher's classes as notebooks, grouped under their subject, then the always-present "add class" card. */
export function CourseGrid({ courses }: { courses: CourseDTO[] }) {
  const { t, locale } = usePrefs();
  const { openAddCourse } = useWorkspace();
  const bySubject = [...new Set(courses.map((c) => c.subjectCode))].map((code) => courses.filter((c) => c.subjectCode === code));
  const addCard = (
    <button type="button" onClick={openAddCourse} className="grid aspect-[4/5] place-items-center rounded-2xl border-2 border-dashed border-line text-muted hover:border-brand hover:text-brand">
      <span className="flex flex-col items-center gap-2 font-semibold">
        <span className="grid size-12 place-items-center rounded-full bg-surface2"><Plus className="size-6" aria-hidden /></span>
        {t("dash.quick.addClass")}
      </span>
    </button>
  );
  const grid = "grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5";
  if (courses.length === 0) return <div className={grid}>{addCard}</div>;

  return (
    <div className="space-y-6">
      {bySubject.map((group, gi) => (
        <section key={group[0].subjectCode} aria-label={subjectLabel(locale, group[0])}>
          <h3 className="mb-3 text-lg font-semibold">{subjectLabel(locale, group[0])}</h3>
          <div className={grid}>
            {group.map((c) => (
              <Link key={c.id} href={`/app/classes/${c.id}`} data-color={c.color} className="notebook aspect-[4/5] p-3 ps-7 transition-transform hover:-translate-y-0.5">
                <div className="notebook-label">
                  <p className="font-display text-base font-bold leading-6 sm:text-lg">{gradeLabel(t, c.grade)}</p>
                  <p className="truncate text-xs leading-6 text-[#55665f]">{subjectLabel(locale, c)}</p>
                </div>
                <span aria-hidden className="pointer-events-none absolute bottom-10 end-3 font-display text-7xl font-bold leading-none text-white/15">{c.grade}</span>
                <div className="text-sm text-white/90">
                  <p>{t("dash.resourceCount", { n: c.resourceCount })}</p>
                  <p className="text-xs text-white/75">{t("dash.updated", { when: timeAgo(c.lastUpdate, locale) })}</p>
                  <span className="mt-2 inline-flex rounded-lg bg-white/20 px-3 py-1 text-sm font-semibold">{t("dash.enter")}</span>
                </div>
              </Link>
            ))}
            {gi === bySubject.length - 1 && addCard}
          </div>
        </section>
      ))}
    </div>
  );
}

/** A class opens onto its semesters: two large cards. */
export function SemesterCards({ courseId, color, semesters }: { courseId: string; color: string; semesters: SemesterDTO[] }) {
  const { t } = usePrefs();
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {semesters.map((s) => (
        <Link key={s.id} href={`/app/classes/${courseId}/${s.id}`} data-color={color} className="card group flex items-center gap-4 p-5 hover:border-muted sm:p-6">
          <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-[var(--c)] font-display text-2xl font-bold text-white">{s.position}</span>
          <span>
            <span className="block text-xl font-bold">{semesterLabel(t, s)}</span>
            <span className="block text-muted">{t("classPage.unitCount", { n: s.unitCount })}، {t("dash.resourceCount", { n: s.resourceCount })}</span>
          </span>
        </Link>
      ))}
    </div>
  );
}

/** A semester opens onto its units, followed by "add unit". */
export function UnitGrid({ courseId, semesterId, color, units }: { courseId: string; semesterId: string; color: string; units: UnitDTO[] }) {
  const { t } = usePrefs();
  const toast = useToast();
  const { refresh } = useWorkspace();
  const [busy, setBusy] = useState(false);

  async function add() {
    setBusy(true);
    try {
      await api(`/semesters/${semesterId}/units`, { body: {} });
      toast(t("classPage.unitAdded"));
      refresh();
    } catch (err) {
      toast(errorText(t, err), "error");
    }
    setBusy(false);
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
      {units.map((u) => (
        <Link key={u.id} href={`/app/classes/${courseId}/${semesterId}/${u.id}`} data-color={color} className="card flex min-h-24 flex-col justify-between border-s-4 !border-s-[var(--c)] p-4 hover:border-muted">
          <span className="text-lg font-bold" dir="auto">{unitLabel(t, u)}</span>
          <span className="text-sm text-muted">{t("dash.resourceCount", { n: u.resourceCount })}</span>
        </Link>
      ))}
      <button type="button" onClick={add} disabled={busy} className="flex min-h-24 items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-line font-semibold text-muted hover:border-brand hover:text-brand">
        {busy ? <Spinner /> : <Plus className="size-5" aria-hidden />}
        {t("classPage.addUnit")}
      </button>
    </div>
  );
}

/** Rename a unit, or remove it while it is still empty. */
export function UnitActions({ unit, backHref }: { unit: UnitDTO; backHref: string }) {
  const { t } = usePrefs();
  const toast = useToast();
  const router = useRouter();
  const { refresh } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(unit.title ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>, done: string, leave?: boolean) {
    setBusy(true);
    setError(null);
    try {
      await action();
      toast(done);
      setOpen(false);
      if (leave) router.push(backHref);
      refresh();
    } catch (err) {
      setError(errorText(t, err));
    }
    setBusy(false);
  }

  return (
    <>
      <button type="button" className="btn btn-outline" onClick={() => { setTitle(unit.title ?? ""); setError(null); setOpen(true); }}>
        <Pencil className="size-4" aria-hidden />{t("classPage.renameUnit")}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={t("classPage.renameUnit")}>
        <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); void run(() => api(`/units/${unit.id}`, { method: "PATCH", body: { title } }), t("resource.saved")); }}>
          <Field label={t("classPage.unitName")} hint={t("classPage.unitNameHint", { name: t("units.label", { n: unit.number }) })}>
            <input className="input" autoFocus maxLength={80} dir="auto" value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <FormError message={error} />
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn btn-primary" disabled={busy}>{busy && <Spinner />}{t("common.save")}</button>
            <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>{t("common.cancel")}</button>
            {unit.resourceCount === 0 && (
              <button type="button" className="btn btn-ghost ms-auto text-danger" disabled={busy} onClick={() => run(() => api(`/units/${unit.id}`, { method: "DELETE" }), t("classPage.unitDeleted"), true)}>
                {t("classPage.deleteUnit")}
              </button>
            )}
          </div>
        </form>
      </Modal>
    </>
  );
}

/** Section tiles of a unit plus the permanent "add section" card. */
export function SectionGrid({ unitId, base, sections }: { unitId: string; base: string; sections: SectionDTO[] }) {
  const { t } = usePrefs();
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {sections.map((s) => <SectionTile key={s.id} s={s} base={base} />)}
        <button type="button" onClick={() => setOpen(true)} className="flex min-h-20 items-center gap-3 rounded-2xl border-2 border-dashed border-line p-3 text-start text-muted hover:border-brand hover:text-brand">
          <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-surface2"><Plus className="size-6" aria-hidden /></span>
          <span>
            <span className="block text-lg font-semibold">{t("section.add")}</span>
            <span className="block text-sm">{t("section.addHint")}</span>
          </span>
        </button>
      </div>
      <SectionModal unitId={unitId} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

export function SectionRail({ sections, base, activeId }: { sections: SectionDTO[]; base: string; activeId: string }) {
  const { t } = usePrefs();
  return (
    <div>
      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
        {sections.map((s) => <SectionTile key={s.id} s={s} base={base} compact active={s.id === activeId} />)}
      </div>
      <p className="mt-2 hidden text-sm text-muted lg:block">{t("section.dragHint")}</p>
    </div>
  );
}

export function AiShortcut({ notes }: { notes: ResourceDTO[] }) {
  const { t } = usePrefs();
  const { openAi, openResource } = useWorkspace();
  return (
    <div className="rounded-2xl bg-board p-5 text-board-ink sm:p-6">
      <h2 className="flex items-center gap-2 text-lg font-semibold"><Sparkles className="size-5 text-accent" aria-hidden />{t("ai.title")}</h2>
      <p className="mt-1 text-board-ink/75">{t("dash.aiBody")}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        {[1, 2].map((n) => (
          <button key={n} type="button" onClick={() => openAi({ prompt: t(`ai.examples.${n}`) })} className="rounded-xl border border-board-ink/25 px-3 py-2 text-start text-sm hover:border-board-ink/60">
            {t(`ai.examples.${n}`)}
          </button>
        ))}
      </div>
      {notes.length > 0 && (
        <div className="mt-5 border-t border-board-ink/20 pt-4">
          <h3 className="text-sm font-semibold text-board-ink/75">{t("dash.aiNotes")}</h3>
          <ul className="mt-2 space-y-1">
            {notes.map((n) => (
              <li key={n.id}><button type="button" onClick={() => openResource(n)} className="w-full truncate rounded-lg px-2 py-1.5 text-start hover:bg-board-ink/10" dir="auto">{n.title}</button></li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function AddResourceButton({ label }: { label?: string }) {
  const { t } = usePrefs();
  const { openAdd } = useWorkspace();
  return (
    <button type="button" className="btn btn-primary" onClick={() => openAdd()}>
      <Plus className="size-4" aria-hidden />
      {label ?? t("dash.quick.addResource")}
    </button>
  );
}

export function EmptyTrashButton({ count }: { count: number }) {
  const { t } = usePrefs();
  const toast = useToast();
  const { refresh } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  if (count === 0) return null;
  return (
    <>
      <button type="button" className="btn btn-outline text-danger" onClick={() => setOpen(true)}><Trash2 className="size-4" aria-hidden />{t("trash.empty")}</button>
      <Modal open={open} onClose={() => setOpen(false)} title={t("trash.empty")}>
        <p className="font-semibold">{t("trash.emptyConfirm", { n: count })}</p>
        <p className="mt-1 text-muted">{t("trash.confirmBody")}</p>
        <div className="mt-5 flex gap-2">
          <button
            className="btn btn-danger"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api("/trash", { method: "DELETE" });
                toast(t("trash.deletedForever"));
                refresh();
                setOpen(false);
              } catch (err) {
                toast(errorText(t, err), "error");
              }
              setBusy(false);
            }}
          >
            {busy && <Spinner />}{t("trash.deleteForever")}
          </button>
          <button className="btn btn-ghost" onClick={() => setOpen(false)}>{t("common.cancel")}</button>
        </div>
      </Modal>
    </>
  );
}

/* ── Settings ──────────────────────────────────────────────────────── */

type Me = { hasPassword: boolean; nationalIdLast4: string | null; providers: string[] };
type SessionRow = { id: string; userAgent: string | null; remember: boolean; lastUsedAt: string; current: boolean };

const Block = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="card p-5">
    <h2 className="text-lg font-semibold">{title}</h2>
    <div className="mt-4">{children}</div>
  </section>
);

function ProfileForm() {
  const { t } = usePrefs();
  const toast = useToast();
  const { user, refresh } = useWorkspace();
  const [f, setF] = useState({
    firstName: user.firstName ?? "", secondName: user.secondName ?? "", thirdName: user.thirdName ?? "", lastName: user.lastName ?? "",
    schoolName: user.schoolName ?? "", academicYear: user.academicYear ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const years = [...new Set([...academicYears(), f.academicYear].filter(Boolean))].sort();

  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await api("/me", { method: "PATCH", body: f });
          toast(t("resource.saved"));
          refresh();
        } catch (err) {
          setError(errorText(t, err));
        }
        setBusy(false);
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {(["firstName", "secondName", "thirdName", "lastName"] as const).map((k) => (
          <Field key={k} label={t(`profile.${k}`)}><input className="input" required maxLength={60} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Field>
        ))}
      </div>
      <Field label={t("profile.schoolName")}><input className="input" required minLength={2} maxLength={150} value={f.schoolName} onChange={(e) => setF({ ...f, schoolName: e.target.value })} /></Field>
      <Field label={t("profile.academicYear")}>
        <select className="input" dir="ltr" value={f.academicYear} onChange={(e) => setF({ ...f, academicYear: e.target.value })}>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </Field>
      <FormError message={error} />
      <button className="btn btn-primary" disabled={busy}>{busy && <Spinner />}{t("common.save")}</button>
    </form>
  );
}

/** Changing the email: the password first, then a code sent to the new address. The old address stays until the code is entered. */
function EmailChange({ hasPassword }: { hasPassword: boolean }) {
  const { t } = usePrefs();
  const toast = useToast();
  const { user } = useWorkspace();
  const [step, setStep] = useState<"idle" | "form" | "code">("idle");
  const [password, setPassword] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [left, setLeft] = useCountdown(0);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      const wait = retryAfter(err);
      if (wait) setLeft(wait);
      setError(errorText(t, err));
    }
    setBusy(false);
  }
  const request = () =>
    run(async () => {
      const res = await api<{ resendIn?: number }>("/me/email", { body: { password, newEmail } });
      setLeft(res.resendIn ?? 60);
      setCode("");
      setStep("code");
    });
  const verify = (value = code) =>
    run(async () => {
      try {
        await api("/me/email/verify", { body: { code: value } });
        toast(t("settings.emailChanged"));
        window.location.reload();
      } catch (err) {
        setCode("");
        throw err;
      }
    });

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="label !mb-0">{t("auth.email")}</p>
          <p dir="ltr" className="text-start">{user.email}</p>
        </div>
        {step === "idle" && hasPassword && <button className="btn btn-outline btn-sm" onClick={() => setStep("form")}>{t("settings.changeEmail")}</button>}
      </div>
      {!hasPassword && <p className="mt-2 text-sm text-muted">{t("settings.emailFromGoogle")}</p>}
      {step !== "idle" && (
        <div className="mt-4 space-y-4 rounded-xl border border-line p-4">
          <FormError message={error} />
          {step === "form" ? (
            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void request(); }}>
              <Field label={t("settings.currentPassword")}><input className="input" type="password" dir="ltr" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
              <Field label={t("settings.newEmail")}><input className="input" type="email" dir="ltr" required autoComplete="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} /></Field>
              <div className="flex gap-2">
                <button className="btn btn-primary" disabled={busy}>{busy && <Spinner />}{t("auth.reset.send")}</button>
                <button type="button" className="btn btn-ghost" onClick={() => setStep("idle")}>{t("common.cancel")}</button>
              </div>
            </form>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted">{t("settings.codeSentTo")} <span dir="ltr" className="font-semibold text-ink">{newEmail}</span></p>
              <CodeInput value={code} disabled={busy} onChange={(v) => { setCode(v); if (v.length === 6) void verify(v); }} />
              <div className="flex flex-wrap items-center gap-3">
                <button className="btn btn-primary" disabled={busy || code.length !== 6} onClick={() => verify()}>{busy && <Spinner />}{t("auth.verify.submit")}</button>
                <button type="button" className="text-sm font-semibold text-brand hover:underline disabled:text-muted disabled:no-underline" disabled={left > 0 || busy} onClick={request}>
                  {left > 0 ? t("auth.resendIn", { n: left }) : t("auth.resend")}
                </button>
                <button type="button" className="btn btn-ghost btn-sm ms-auto" onClick={() => setStep("idle")}>{t("common.cancel")}</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PasswordChange({ hasPassword }: { hasPassword: boolean }) {
  const { t } = usePrefs();
  const toast = useToast();
  const [f, setF] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mismatch = f.confirm.length > 0 && f.confirm !== f.newPassword;

  if (!hasPassword) return <p className="text-muted">{t("settings.noPassword")} <Link href="/forgot-password" className="font-semibold text-brand hover:underline">{t("auth.forgotLink")}</Link></p>;
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (mismatch) return;
        setBusy(true);
        setError(null);
        try {
          await api("/me/password", { body: { currentPassword: f.currentPassword, newPassword: f.newPassword } });
          toast(t("settings.passwordChanged"));
          setF({ currentPassword: "", newPassword: "", confirm: "" });
        } catch (err) {
          setError(errorText(t, err));
        }
        setBusy(false);
      }}
    >
      <Field label={t("settings.currentPassword")}><input className="input" type="password" dir="ltr" required autoComplete="current-password" value={f.currentPassword} onChange={(e) => setF({ ...f, currentPassword: e.target.value })} /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("auth.newPassword")} hint={t("auth.passwordHint")}><input className="input" type="password" dir="ltr" required minLength={8} autoComplete="new-password" value={f.newPassword} onChange={(e) => setF({ ...f, newPassword: e.target.value })} /></Field>
        <Field label={t("auth.confirmPassword")}><input className="input" type="password" dir="ltr" required autoComplete="new-password" aria-invalid={mismatch} value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} /></Field>
      </div>
      {mismatch && <p role="alert" className="text-sm font-medium text-danger">{t("auth.passwordMismatch")}</p>}
      <FormError message={error} />
      <button className="btn btn-primary" disabled={busy || mismatch}>{busy && <Spinner />}{t("settings.changePassword")}</button>
    </form>
  );
}

function Sessions() {
  const { t, locale } = usePrefs();
  const [rows, setRows] = useState<SessionRow[] | null>(null);
  const load = () => api<{ sessions: SessionRow[] }>("/me/sessions").then((d) => setRows(d.sessions)).catch(() => setRows([]));
  useEffect(() => {
    void load();
  }, []);
  if (!rows) return <Spinner />;
  return (
    <div>
      <p className="text-sm text-muted">{t("settings.sessionsHint")}</p>
      <ul className="mt-3 divide-y divide-line">
        {rows.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="truncate font-medium" dir="ltr">{deviceLabel(s.userAgent)}</p>
              <p className="text-sm text-muted">
                {s.current ? t("settings.thisDevice") : t("settings.lastActive", { when: timeAgo(s.lastUsedAt, locale) })}
                {s.remember ? `، ${t("settings.remembered")}` : ""}
              </p>
            </div>
            {!s.current && (
              <button className="btn btn-outline btn-sm" onClick={async () => { await api(`/me/sessions/${s.id}`, { method: "DELETE" }).catch(() => {}); void load(); }}>
                {t("nav.logout")}
              </button>
            )}
          </li>
        ))}
      </ul>
      {rows.length > 1 && (
        <button className="btn btn-outline mt-2" onClick={async () => { await api("/me/sessions", { method: "DELETE" }).catch(() => {}); void load(); }}>
          {t("settings.signOutOthers")}
        </button>
      )}
    </div>
  );
}

export function SettingsPanel() {
  const { t } = usePrefs();
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    api<Me>("/me").then(setMe).catch(() => setMe({ hasPassword: true, nationalIdLast4: null, providers: [] }));
  }, []);

  return (
    <div className="max-w-2xl space-y-5">
      <Block title={t("settings.profile")}>
        <ProfileForm />
        <div className="mt-5 border-t border-line pt-4">
          <p className="label !mb-0">{t("profile.nationalId")}</p>
          <p dir="ltr" className="text-start font-mono tracking-wider">{me?.nationalIdLast4 ? `••••••••${me.nationalIdLast4}` : "…"}</p>
          <p className="mt-1 text-sm text-muted">{t("settings.nationalIdFixed")}</p>
        </div>
      </Block>
      <Block title={t("settings.appearance")}>
        <div className="flex flex-wrap items-center gap-x-10 gap-y-4">
          <div><p className="label">{t("common.language")}</p><LangSwitch /></div>
          <div><p className="label">{t("common.theme")}</p><ThemeSwitch /></div>
        </div>
      </Block>
      <Block title={t("settings.security")}>
        {!me ? <Spinner /> : (
          <div className="space-y-6">
            <EmailChange hasPassword={me.hasPassword} />
            <div className="border-t border-line pt-5">
              <h3 className="mb-3 font-semibold">{t("settings.changePassword")}</h3>
              <PasswordChange hasPassword={me.hasPassword} />
            </div>
            <div className="border-t border-line pt-5">
              <h3 className="mb-1 font-semibold">{t("settings.sessions")}</h3>
              <Sessions />
            </div>
          </div>
        )}
      </Block>
    </div>
  );
}
