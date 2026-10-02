"use client";

import {
  ChevronLeft, ChevronRight, Copy, Download, ExternalLink, Eye, FolderInput, Pencil, RotateCcw, Sparkles, Star, Trash2, X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, errorText } from "@/lib/api";
import { formatBytes, formatDate } from "@/lib/format";
import { courseTitle, sectionLabel, semesterLabel, unitLabel } from "@/lib/i18n";
import { youtubeId } from "@/lib/links";
import type { SectionDTO, SemesterDTO, UnitDTO } from "@/server/services/courses";
import type { ResourceDTO } from "@/server/services/resources";
import { PROVIDER_NAME } from "./icons";
import { Markdown } from "./markdown";
import { usePrefs, useToast } from "./providers";
import { ResourceCover } from "./resource-card";
import { Field, FormError, Modal, Spinner } from "./ui";
import { useWorkspace } from "./workspace";

/** What can be shown inside the page for this resource, if anything. */
function previewOf(r: ResourceDTO): ReactNode | null {
  const fileUrl = r.file ? `/api/v1/files/${r.file.id}` : null;
  if (r.type === "note") return <div className="p-5"><Markdown>{r.content ?? ""}</Markdown></div>;
  if (r.type === "image" && fileUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={fileUrl} alt={r.title} className="mx-auto max-h-[75dvh] object-contain" />;
  }
  if (r.type === "pdf" && fileUrl) return <iframe src={fileUrl} title={r.title} className="h-[75dvh] w-full" />;
  if (r.type === "video" && fileUrl) return <video src={fileUrl} controls playsInline className="max-h-[75dvh] w-full bg-black" />;
  if (r.provider === "youtube" && r.url) {
    const id = youtubeId(new URL(r.url));
    if (id) {
      return (
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${id}`}
          title={r.title}
          className="aspect-video w-full"
          allow="accelerometer; encrypted-media; picture-in-picture; fullscreen"
          referrerPolicy="strict-origin-when-cross-origin"
        />
      );
    }
  }
  return null;
}

export type Place = { courseId: string; semesterId: string; unitId: string; sectionId: string };

/** Class, semester, unit and section as four linked choices. Picking a level fills the ones below it. */
export function PlacePicker({ value, onChange }: { value: Place; onChange: (p: Place) => void }) {
  const { t, locale } = usePrefs();
  const { courses, getSemesters, getUnits, getSections } = useWorkspace();
  const [semesters, setSemesters] = useState<SemesterDTO[]>([]);
  const [units, setUnits] = useState<UnitDTO[]>([]);
  const [sections, setSections] = useState<SectionDTO[]>([]);

  useEffect(() => {
    let live = true;
    (async () => {
      if (!value.courseId) return;
      const sems = await getSemesters(value.courseId);
      if (!live) return;
      setSemesters(sems);
      const semesterId = sems.some((s) => s.id === value.semesterId) ? value.semesterId : sems[0]?.id ?? "";
      const us = semesterId ? await getUnits(semesterId) : [];
      if (!live) return;
      setUnits(us);
      const unitId = us.some((u) => u.id === value.unitId) ? value.unitId : us[0]?.id ?? "";
      const secs = unitId ? await getSections(unitId) : [];
      if (!live) return;
      setSections(secs);
      const sectionId = secs.some((s) => s.id === value.sectionId) ? value.sectionId : secs[0]?.id ?? "";
      if (semesterId !== value.semesterId || unitId !== value.unitId || sectionId !== value.sectionId) {
        onChange({ courseId: value.courseId, semesterId, unitId, sectionId });
      }
    })().catch(() => {});
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.courseId, value.semesterId, value.unitId]);

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label={t("place.course")}>
        <select className="input" value={value.courseId} onChange={(e) => onChange({ courseId: e.target.value, semesterId: "", unitId: "", sectionId: "" })}>
          {!value.courseId && <option value="">{t("place.choose")}</option>}
          {courses.map((c) => <option key={c.id} value={c.id}>{courseTitle(t, locale, c)}</option>)}
        </select>
      </Field>
      <Field label={t("place.semester")}>
        <select className="input" value={value.semesterId} onChange={(e) => onChange({ ...value, semesterId: e.target.value, unitId: "", sectionId: "" })}>
          {semesters.map((s) => <option key={s.id} value={s.id}>{semesterLabel(t, s)}</option>)}
        </select>
      </Field>
      <Field label={t("place.unit")}>
        <select className="input" value={value.unitId} onChange={(e) => onChange({ ...value, unitId: e.target.value, sectionId: "" })}>
          {units.map((u) => <option key={u.id} value={u.id}>{unitLabel(t, u)}</option>)}
        </select>
      </Field>
      <Field label={t("place.section")}>
        <select className="input" value={value.sectionId} onChange={(e) => onChange({ ...value, sectionId: e.target.value })}>
          {sections.map((s) => <option key={s.id} value={s.id}>{sectionLabel(locale, s)}</option>)}
        </select>
      </Field>
    </div>
  );
}

export const parseTags = (s: string) => [...new Set(s.split(/[,،]/).map((x) => x.trim()).filter(Boolean))].slice(0, 12);
export const unitHref = (r: { courseId: string; semesterId: string; unitId: string }) => `/app/classes/${r.courseId}/${r.semesterId}/${r.unitId}`;

export function ResourceDrawer() {
  const { t, locale } = usePrefs();
  const toast = useToast();
  const { activeResource: r, openResource, refresh, openAi } = useWorkspace();
  const ref = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<"view" | "edit" | "move" | "confirmDelete">("view");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ title: "", description: "", topic: "", tags: "", content: "" });
  const [place, setPlace] = useState<Place>({ courseId: "", semesterId: "", unitId: "", sectionId: "" });
  const id = r?.id;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (r && !d.open) d.showModal();
    if (!r && d.open) d.close();
  }, [r]);

  // Opening a resource is what "recently used" records.
  useEffect(() => {
    if (!id) return;
    setMode("view");
    setError(null);
    setPreviewOpen(false);
    if (!r?.deletedAt) void api(`/resources/${id}/open`, { body: {} }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!r) return <dialog ref={ref} />;

  const trashed = !!r.deletedAt;
  const fileUrl = r.file ? `/api/v1/files/${r.file.id}` : null;
  const preview = previewOf(r);
  const Sep = locale === "ar" ? ChevronLeft : ChevronRight;
  const close = () => openResource(null);
  const crumbs = [
    { label: courseTitle(t, locale, r.course), href: `/app/classes/${r.courseId}` },
    { label: semesterLabel(t, r.semester), href: `/app/classes/${r.courseId}/${r.semesterId}` },
    { label: unitLabel(t, r.unit), href: unitHref(r) },
    { label: sectionLabel(locale, r.section), href: `${unitHref(r)}/${r.sectionId}` },
  ];

  /** Runs a change, then either keeps the drawer open with fresh data or closes it. */
  async function run(action: () => Promise<unknown>, opts: { done: string; close?: boolean }) {
    setBusy(true);
    setError(null);
    try {
      const res = (await action()) as { resource?: ResourceDTO };
      toast(opts.done);
      refresh();
      if (opts.close) close();
      else {
        if (res?.resource) openResource(res.resource);
        setMode("view");
      }
    } catch (err) {
      setError(errorText(t, err));
    }
    setBusy(false);
  }

  function startEdit() {
    setForm({ title: r!.title, description: r!.description ?? "", topic: r!.topic ?? "", tags: r!.tags.join(locale === "ar" ? "، " : ", "), content: r!.content ?? "" });
    setMode("edit");
  }

  function downloadNote() {
    const url = URL.createObjectURL(new Blob([r!.content ?? ""], { type: "text/markdown;charset=utf-8" }));
    Object.assign(document.createElement("a"), { href: url, download: `${r!.title}.md` }).click();
    URL.revokeObjectURL(url);
  }

  const Action = ({ icon: Icon, label, onClick, href, download, disabled, hint }: {
    icon: typeof Eye; label: string; onClick?: () => void; href?: string; download?: boolean; disabled?: boolean; hint?: string;
  }) => {
    const cls = "flex min-h-[4.5rem] flex-col items-center justify-center gap-1.5 rounded-xl border border-line px-1 text-center text-sm font-medium hover:border-muted disabled:opacity-45 disabled:hover:border-line";
    return href ? (
      <a className={cls} href={href} target={download ? undefined : "_blank"} rel="noopener noreferrer" title={hint}><Icon className="size-5" aria-hidden />{label}</a>
    ) : (
      <button type="button" className={cls} onClick={onClick} disabled={disabled || busy} title={hint}><Icon className="size-5" aria-hidden />{label}</button>
    );
  };

  const rows: [string, ReactNode][] = [
    [t("filters.type"), <>{t(`types.${r.type}`)}{r.provider && PROVIDER_NAME[r.provider] ? ` (${PROVIDER_NAME[r.provider]})` : ""}</>],
    ...(r.topic ? [[t("add.topic"), r.topic] as [string, ReactNode]] : []),
    [t("profile.academicYear"), <span key="y" dir="ltr">{r.course.academicYear}</span>],
    [t("resource.createdAt"), formatDate(r.createdAt, locale)],
    [t("resource.updatedAt"), formatDate(r.updatedAt, locale)],
    ...(r.file ? [[t("resource.size"), <span key="s" dir="ltr">{formatBytes(r.file.size, locale)}</span>] as [string, ReactNode]] : []),
  ];

  return (
    <>
      <dialog
        ref={ref}
        aria-label={r.title}
        onCancel={(e) => {
          e.preventDefault();
          close();
        }}
        onClick={(e) => e.target === ref.current && close()}
        className="m-0 ms-auto h-dvh max-h-none w-full max-w-md border-s border-line bg-surface p-0 shadow-soft"
      >
        <div className="flex h-full flex-col">
          <header className="flex items-start justify-between gap-2 border-b border-line px-4 py-3">
            <nav aria-label={t("resource.breadcrumbs")} className="min-w-0 pt-1.5">
              <ol className="flex flex-wrap items-center gap-1 text-sm text-muted">
                {crumbs.map((c, i) => (
                  <li key={c.href} className="flex items-center gap-1">
                    {i > 0 && <Sep className="size-3.5" aria-hidden />}
                    <Link href={c.href} onClick={close} className="hover:text-ink">{c.label}</Link>
                  </li>
                ))}
              </ol>
            </nav>
            <button type="button" className="btn btn-ghost btn-icon shrink-0" onClick={close} aria-label={t("common.close")}><X className="size-5" /></button>
          </header>

          <div className="flex-1 overflow-y-auto p-4">
            <div className="aspect-[16/10] overflow-hidden rounded-xl border border-line"><ResourceCover r={r} large /></div>

            <div className="mt-4 flex items-start justify-between gap-3">
              <h2 className="text-xl font-bold leading-snug" dir="auto">{r.title}</h2>
              {!trashed && (
                <button
                  type="button"
                  className={`btn btn-ghost btn-icon shrink-0 ${r.isFavorite ? "text-accent" : "text-muted"}`}
                  aria-pressed={r.isFavorite}
                  aria-label={r.isFavorite ? t("resource.unfavorite") : t("resource.favorite")}
                  onClick={async () => {
                    await api(`/resources/${r.id}/favorite`, { body: { value: !r.isFavorite } }).catch(() => {});
                    openResource({ ...r, isFavorite: !r.isFavorite });
                    refresh();
                  }}
                >
                  <Star className={`size-5 ${r.isFavorite ? "fill-current" : ""}`} />
                </button>
              )}
            </div>
            {r.description && <p className="mt-2 whitespace-pre-line text-muted" dir="auto">{r.description}</p>}
            {r.tags.length > 0 && (
              <ul className="mt-3 flex flex-wrap gap-1.5" aria-label={t("filters.tags")}>
                {r.tags.map((tag) => <li key={tag} className="chip">{tag}</li>)}
              </ul>
            )}
            <div className="mt-4"><FormError message={error} /></div>

            {trashed ? (
              <div className="mt-4 space-y-3">
                <p className="rounded-xl bg-surface2 px-4 py-3 text-sm">{t("trash.inTrash", { date: formatDate(r.deletedAt!, locale) })}</p>
                {mode === "confirmDelete" ? (
                  <div className="rounded-xl border border-danger/40 p-4">
                    <p className="font-semibold">{t("trash.confirmTitle")}</p>
                    <p className="mt-1 text-sm text-muted">{t("trash.confirmBody")}</p>
                    <div className="mt-4 flex gap-2">
                      <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => run(() => api(`/resources/${r.id}/permanent`, { method: "DELETE" }), { done: t("trash.deletedForever"), close: true })}>
                        {busy && <Spinner />}{t("trash.deleteForever")}
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={() => setMode("view")}>{t("common.cancel")}</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <button className="btn btn-primary" disabled={busy} onClick={() => run(() => api(`/resources/${r.id}/restore`, { body: {} }), { done: t("trash.restored"), close: true })}>
                      <RotateCcw className="size-4" aria-hidden />{t("trash.restore")}
                    </button>
                    <button className="btn btn-outline text-danger" onClick={() => setMode("confirmDelete")}><Trash2 className="size-4" aria-hidden />{t("trash.deleteForever")}</button>
                  </div>
                )}
              </div>
            ) : mode === "edit" ? (
              <form
                className="mt-4 space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(
                    () => api(`/resources/${r.id}`, {
                      method: "PATCH",
                      body: { title: form.title, description: form.description, topic: form.topic, tags: parseTags(form.tags), ...(r.kind === "note" ? { content: form.content } : {}) },
                    }),
                    { done: t("resource.saved") },
                  );
                }}
              >
                <Field label={t("add.title")}><input className="input" required maxLength={200} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
                <Field label={t("add.description")}><textarea className="input" rows={3} maxLength={2000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
                <Field label={t("add.topic")}><input className="input" maxLength={80} value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })} /></Field>
                <Field label={t("filters.tags")} hint={t("add.tagsHint")}><input className="input" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} /></Field>
                {r.kind === "note" && (
                  <Field label={t("resource.content")}><textarea className="input font-mono text-sm" dir="auto" rows={12} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} /></Field>
                )}
                <div className="flex gap-2">
                  <button className="btn btn-primary" disabled={busy}>{busy && <Spinner />}{t("common.save")}</button>
                  <button type="button" className="btn btn-ghost" onClick={() => setMode("view")}>{t("common.cancel")}</button>
                </div>
              </form>
            ) : mode === "move" ? (
              <div className="mt-4 space-y-4 rounded-xl border border-line p-4">
                <p className="font-semibold">{t("resource.moveTitle")}</p>
                <PlacePicker value={place} onChange={setPlace} />
                <div className="flex gap-2">
                  <button className="btn btn-primary" disabled={busy || !place.sectionId || place.sectionId === r.sectionId}
                    onClick={() => run(() => api(`/resources/${r.id}`, { method: "PATCH", body: { sectionId: place.sectionId } }), { done: t("resource.moved") })}>
                    {busy && <Spinner />}{t("resource.move")}
                  </button>
                  <button className="btn btn-ghost" onClick={() => setMode("view")}>{t("common.cancel")}</button>
                </div>
              </div>
            ) : (
              <>
                <div className="mt-5 grid grid-cols-3 gap-2">
                  {r.url && <Action icon={ExternalLink} label={t("common.open")} href={r.url} />}
                  {fileUrl && <Action icon={ExternalLink} label={t("common.open")} href={fileUrl} />}
                  <Action icon={Eye} label={t("resource.preview")} onClick={() => setPreviewOpen(true)} disabled={!preview} hint={preview ? undefined : t("resource.noPreview")} />
                  {fileUrl && <Action icon={Download} label={t("resource.download")} href={`${fileUrl}?download=1`} download />}
                  {r.kind === "note" && <Action icon={Download} label={t("resource.download")} onClick={downloadNote} />}
                  <Action icon={Pencil} label={t("common.edit")} onClick={startEdit} />
                  <Action icon={FolderInput} label={t("resource.move")} onClick={() => { setPlace({ courseId: r.courseId, semesterId: r.semesterId, unitId: r.unitId, sectionId: r.sectionId }); setMode("move"); }} />
                  <Action icon={Copy} label={t("resource.duplicate")} onClick={() => run(() => api(`/resources/${r.id}/duplicate`, { body: {} }), { done: t("resource.duplicated") })} />
                  <Action icon={Trash2} label={t("common.delete")} onClick={() => run(() => api(`/resources/${r.id}`, { method: "DELETE" }), { done: t("resource.trashed"), close: true })} />
                </div>
                <button type="button" className="btn btn-outline mt-3 w-full" onClick={() => openAi({ resource: r })}>
                  <Sparkles className="size-4 text-brand" aria-hidden />{t("resource.askAi")}
                </button>
                <dl className="mt-5 divide-y divide-line border-y border-line text-sm">
                  {rows.map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-4 py-2.5">
                      <dt className="text-muted">{k}</dt>
                      <dd className="text-end font-medium">{v}</dd>
                    </div>
                  ))}
                </dl>
              </>
            )}
          </div>
        </div>
      </dialog>

      <Modal open={previewOpen && !!preview} onClose={() => setPreviewOpen(false)} title={r.title} wide>
        <div className="-m-5 overflow-hidden">{preview}</div>
      </Modal>
    </>
  );
}
