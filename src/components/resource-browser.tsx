"use client";

import { ArrowUpDown, Filter, Pencil, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState, type DragEvent, type ReactNode } from "react";
import { api, errorText } from "@/lib/api";
import { RESOURCE_TYPES } from "@/lib/constants";
import { courseTitle, sectionLabel, unitLabel } from "@/lib/i18n";
import type { SectionDTO } from "@/server/services/courses";
import type { ResourceDTO } from "@/server/services/resources";
import { SectionModal } from "./class-modals";
import { SECTION_ICON } from "./icons";
import { usePrefs, useToast } from "./providers";
import { DRAG_TYPE, ResourceCard } from "./resource-card";
import { useWorkspace } from "./workspace";

type Sort = "manual" | "newest" | "oldest" | "az" | "recent";
const DAY = 86_400_000;

/** A section drawn as a tile. Resources, and files from the computer, can be dropped on it. */
export function SectionTile({ s, base, compact, active }: { s: SectionDTO; base: string; compact?: boolean; active?: boolean }) {
  const { t, locale } = usePrefs();
  const toast = useToast();
  const { refresh, openAdd, here } = useWorkspace();
  const [over, setOver] = useState(false);
  const [editing, setEditing] = useState(false);
  const Icon = SECTION_ICON[s.icon] ?? SECTION_ICON.folder;
  const name = sectionLabel(locale, s);

  async function onDrop(e: DragEvent) {
    e.preventDefault();
    setOver(false);
    const id = e.dataTransfer.getData(DRAG_TYPE);
    if (id) {
      try {
        await api(`/resources/${id}`, { method: "PATCH", body: { sectionId: s.id } });
        toast(t("resource.movedTo", { name }));
        refresh();
      } catch (err) {
        toast(errorText(t, err), "error");
      }
    } else if (e.dataTransfer.files[0]) {
      openAdd({ ...here, unitId: s.unitId, sectionId: s.id, file: e.dataTransfer.files[0] });
    }
  }

  return (
    <div className={`relative ${compact ? "shrink-0" : ""}`}>
      <Link
        href={`${base}/${s.id}`}
        data-color={s.color}
        aria-current={active ? "page" : undefined}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={`card flex items-center gap-3 transition-colors ${compact ? "px-3 py-2" : "min-h-20 p-3 pe-12"} ${
          over ? "!border-brand bg-brand-soft" : active ? "!border-[var(--c)]" : "hover:border-muted"
        }`}
      >
        <span className={`grid shrink-0 place-items-center rounded-xl bg-[var(--c)] text-white ${compact ? "size-8" : "size-12"}`}>
          <Icon className={compact ? "size-4" : "size-6"} aria-hidden />
        </span>
        <span className="min-w-0">
          <span className={`block truncate font-semibold ${compact ? "text-sm" : "text-lg"}`}>{name}</span>
          {!compact && <span className="block text-sm text-muted">{t("dash.resourceCount", { n: s.resourceCount })}</span>}
        </span>
      </Link>
      {!compact && (
        <>
          <button type="button" onClick={() => setEditing(true)} aria-label={t("section.editNamed", { name })} title={t("section.edit")}
            className="absolute end-2 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-lg text-muted hover:bg-surface2 hover:text-ink">
            <Pencil className="size-4" />
          </button>
          <SectionModal unitId={s.unitId} section={s} open={editing} onClose={() => setEditing(false)} />
        </>
      )}
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="rounded-2xl border-2 border-dashed border-line px-6 py-12 text-center">
      <p className="text-lg font-semibold">{title}</p>
      {body && <p className="mx-auto mt-1 max-w-md text-muted">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/**
 * Grid of resource cards with in-page search, filters and sorting.
 * Filtering runs on the loaded list; the API accepts the same filters for larger libraries and a mobile app.
 */
export function ResourceBrowser({
  resources, showPlace, emptyTitle, emptyBody, addButton, toolbar = true, initialQuery = "", reorderSectionId,
}: {
  resources: ResourceDTO[];
  showPlace?: boolean;
  emptyTitle: string;
  emptyBody?: string;
  addButton?: boolean;
  toolbar?: boolean;
  initialQuery?: string;
  /** set on a section page: the cards can then be dragged into the teacher's own order */
  reorderSectionId?: string;
}) {
  const { t, locale } = usePrefs();
  const toast = useToast();
  const { openAdd, refresh } = useWorkspace();
  const [q, setQ] = useState(initialQuery);
  const [open, setOpen] = useState(false);
  const [sort, setSort] = useState<Sort>(reorderSectionId ? "manual" : "newest");
  const [f, setF] = useState({ type: "", courseId: "", unitId: "", sectionId: "", tag: "", date: "" });

  // Offer only the choices that exist in this list.
  const options = useMemo(() => {
    const first = <K extends keyof ResourceDTO>(key: K) => [...new Map(resources.map((r) => [r[key], r])).values()];
    return {
      types: RESOURCE_TYPES.filter((ty) => resources.some((r) => r.type === ty)),
      courses: first("courseId").map((r) => ({ value: r.courseId, label: courseTitle(t, locale, r.course) })),
      units: first("unitId").map((r) => ({ value: r.unitId, label: unitLabel(t, r.unit), courseId: r.courseId })),
      sections: [...new Set(resources.map((r) => sectionLabel(locale, r.section)))].map((label) => ({ value: label, label })),
      tags: [...new Set(resources.flatMap((r) => r.tags))].sort().map((v) => ({ value: v, label: v })),
    };
  }, [resources, t, locale]);

  const shown = useMemo(() => {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    const since = f.date ? Date.now() - Number(f.date) * DAY : 0;
    const list = resources.filter((r) => {
      if (f.type && r.type !== f.type) return false;
      if (f.courseId && r.courseId !== f.courseId) return false;
      if (f.unitId && r.unitId !== f.unitId) return false;
      if (f.sectionId && sectionLabel(locale, r.section) !== f.sectionId) return false;
      if (f.tag && !r.tags.includes(f.tag)) return false;
      if (since && new Date(r.createdAt).getTime() < since) return false;
      const hay = [
        r.title, r.description, r.topic, r.file?.name, r.url, ...r.tags,
        `unit ${r.unit.number}`, `الوحدة ${r.unit.number}`, r.unit.title, sectionLabel(locale, r.section), r.course.subjectAr, r.course.subjectEn,
      ].join(" ").toLowerCase();
      return terms.every((term) => hay.includes(term));
    });
    const time = (s: string | null) => (s ? new Date(s).getTime() : 0);
    if (sort === "manual") return list;
    return list.sort((a, b) =>
      sort === "az" ? a.title.localeCompare(b.title)
      : sort === "oldest" ? time(a.createdAt) - time(b.createdAt)
      : sort === "recent" ? time(b.lastOpenedAt) - time(a.lastOpenedAt)
      : time(b.createdAt) - time(a.createdAt),
    );
  }, [resources, q, f, sort, locale]);

  async function placeBefore(draggedId: string, targetId: string) {
    const ids = resources.map((r) => r.id).filter((id) => id !== draggedId);
    ids.splice(ids.indexOf(targetId), 0, draggedId);
    try {
      await api(`/sections/${reorderSectionId}/reorder`, { body: { ids } });
      refresh();
    } catch (err) {
      toast(errorText(t, err), "error");
    }
  }

  const activeFilters = Object.values(f).filter(Boolean).length;
  const empty = { type: "", courseId: "", unitId: "", sectionId: "", tag: "", date: "" };
  const select = (key: keyof typeof f, label: string, opts: { value: string; label: string }[]) =>
    opts.length > 1 || f[key] ? (
      <label className="block min-w-36 flex-1">
        <span className="mb-1 block text-xs font-semibold text-muted">{label}</span>
        <select className="input !min-h-10 !py-1.5 text-sm" value={f[key]} onChange={(e) => setF({ ...f, [key]: e.target.value })}>
          <option value="">{t("common.all")}</option>
          {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
    ) : null;

  if (resources.length === 0) {
    return (
      <EmptyState
        title={emptyTitle}
        body={emptyBody}
        action={addButton ? <button className="btn btn-primary" onClick={() => openAdd()}><Plus className="size-4" aria-hidden />{t("dash.quick.addResource")}</button> : undefined}
      />
    );
  }

  const sorts: Sort[] = reorderSectionId ? ["manual", "newest", "oldest", "az", "recent"] : ["newest", "oldest", "az", "recent"];
  const canReorder = !!reorderSectionId && sort === "manual" && !q && activeFilters === 0;

  return (
    <div>
      {toolbar && (
        <div className="mb-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1 basis-56">
              <Search aria-hidden className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
              <input type="search" className="input !min-h-11 !ps-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("filters.searchHere")} aria-label={t("filters.searchHere")} />
            </div>
            <button type="button" className={`btn btn-outline ${activeFilters ? "!border-brand text-brand" : ""}`} aria-expanded={open} onClick={() => setOpen(!open)}>
              <Filter className="size-4" aria-hidden />
              {t("filters.title")}{activeFilters ? ` (${activeFilters})` : ""}
            </button>
            <label className="relative">
              <span className="sr-only">{t("filters.sort")}</span>
              <ArrowUpDown aria-hidden className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
              <select className="input !min-h-11 !w-auto !py-1.5 !ps-9" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                {sorts.map((s) => <option key={s} value={s}>{t(`filters.sorts.${s}`)}</option>)}
              </select>
            </label>
          </div>
          {open && (
            <div className="card flex flex-wrap items-end gap-3 p-3">
              {select("type", t("filters.type"), options.types.map((v) => ({ value: v, label: t(`types.${v}`) })))}
              {select("courseId", t("place.course"), options.courses)}
              {select("unitId", t("place.unit"), options.units.filter((u) => !f.courseId || u.courseId === f.courseId))}
              {select("sectionId", t("place.section"), options.sections)}
              {select("tag", t("filters.tags"), options.tags)}
              {select("date", t("filters.date"), [7, 30, 365].map((d) => ({ value: String(d), label: t(`filters.dates.${d}`) })))}
              {activeFilters > 0 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setF(empty)}>{t("filters.clear")}</button>}
            </div>
          )}
        </div>
      )}
      {shown.length === 0 ? (
        <EmptyState title={t("filters.noMatchTitle")} body={t("filters.noMatchBody")} />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4">
          {shown.map((r) => (
            <ResourceCard key={r.id} r={r} showPlace={showPlace} onDropBefore={canReorder ? (dragged) => placeBefore(dragged, r.id) : undefined} />
          ))}
        </div>
      )}
      {canReorder && shown.length > 1 && <p className="mt-3 hidden text-sm text-muted lg:block">{t("filters.reorderHint")}</p>}
    </div>
  );
}
