"use client";

import { Play, Star } from "lucide-react";
import { useState, type DragEvent } from "react";
import { api } from "@/lib/api";
import { formatBytes, formatDate } from "@/lib/format";
import { courseTitle, sectionLabel, unitLabel } from "@/lib/i18n";
import type { ResourceDTO } from "@/server/services/resources";
import { PROVIDER_NAME, TYPE_COLOR, TYPE_ICON } from "./icons";
import { usePrefs, useToast } from "./providers";
import { useWorkspace } from "./workspace";

export const DRAG_TYPE = "application/x-eduhub-resource";

/** The picture of a resource: a real preview where one exists, a typed cover otherwise. */
export function ResourceCover({ r, large }: { r: ResourceDTO; large?: boolean }) {
  const Icon = TYPE_ICON[r.type];
  const src = r.type === "image" && r.file ? `/api/v1/files/${r.file.id}` : r.thumbnailUrl;
  if (src) {
    return (
      <div className="relative size-full bg-surface2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="" loading="lazy" className="size-full object-cover" referrerPolicy="no-referrer" />
        {r.type === "video" && (
          <span className="absolute inset-0 m-auto grid size-11 place-items-center rounded-full bg-black/65 text-white">
            <Play className="size-5 translate-x-px fill-current rtl:-translate-x-px" aria-hidden />
          </span>
        )}
      </div>
    );
  }
  if (r.type === "note") {
    return (
      <div className="paper size-full overflow-hidden px-3 pt-[0.2rem] text-[0.7rem] leading-[1.35rem]" dir="auto">
        <p className="line-clamp-6 whitespace-pre-line">{(r.content ?? "").replace(/[#*_`>|-]+/g, " ").trim()}</p>
      </div>
    );
  }
  const badge = r.file?.ext.toUpperCase() ?? (r.provider && PROVIDER_NAME[r.provider]) ?? (r.url ? new URL(r.url).hostname.replace(/^www\./, "") : "");
  return (
    <div data-color={TYPE_COLOR[r.type]} className="relative grid size-full place-items-center bg-[var(--c)] text-white">
      <Icon className={large ? "size-14" : "size-9"} strokeWidth={1.5} aria-hidden />
      {badge && (
        <span dir="ltr" className="absolute bottom-2 start-2 max-w-[80%] truncate rounded-md bg-black/30 px-1.5 py-0.5 text-[0.7rem] font-semibold">{badge}</span>
      )}
    </div>
  );
}

export function ResourceCard({ r, showPlace, onDropBefore }: { r: ResourceDTO; showPlace?: boolean; onDropBefore?: (draggedId: string) => void }) {
  const [over, setOver] = useState(false);
  const { t, locale } = usePrefs();
  const toast = useToast();
  const { openResource, refresh } = useWorkspace();
  const trashed = !!r.deletedAt;

  async function toggleFavorite() {
    try {
      await api(`/resources/${r.id}/favorite`, { body: { value: !r.isFavorite } });
      refresh();
    } catch {
      toast(t("errors.server_error"), "error");
    }
  }

  const meta = r.file ? formatBytes(r.file.size, locale) : r.provider && PROVIDER_NAME[r.provider] ? PROVIDER_NAME[r.provider] : null;

  return (
    <article
      draggable={!trashed}
      onDragStart={(e: DragEvent) => {
        e.dataTransfer.setData(DRAG_TYPE, r.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      // In a section the cards can be put in the teacher's own order: drop one on another to place it before.
      onDragOver={onDropBefore ? (e) => { if (e.dataTransfer.types.includes(DRAG_TYPE)) { e.preventDefault(); setOver(true); } } : undefined}
      onDragLeave={onDropBefore ? () => setOver(false) : undefined}
      onDrop={onDropBefore ? (e) => { e.preventDefault(); setOver(false); const id = e.dataTransfer.getData(DRAG_TYPE); if (id && id !== r.id) onDropBefore(id); } : undefined}
      className={`card group relative overflow-hidden transition-shadow hover:shadow-soft ${over ? "!border-brand ring-2 ring-brand" : ""}`}
    >
      <button type="button" onClick={() => openResource(r)} className="block w-full text-start">
        <div className="aspect-[16/10] overflow-hidden">
          <ResourceCover r={r} />
        </div>
        <div className="p-3">
          <h3 className="line-clamp-2 min-h-[2.9em] text-[0.95rem] font-semibold leading-snug" dir="auto">{r.title}</h3>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
            <span>{t(`types.${r.type}`)}</span>
            {meta && <span dir="ltr">{meta}</span>}
            <span>{formatDate(r.createdAt, locale)}</span>
          </p>
          {showPlace && (
            <p className="mt-1 truncate text-xs text-muted">{courseTitle(t, locale, r.course)} › {unitLabel(t, r.unit)} › {sectionLabel(locale, r.section)}</p>
          )}
        </div>
      </button>
      {!trashed && (
        <button
          type="button"
          onClick={toggleFavorite}
          aria-pressed={r.isFavorite}
          aria-label={r.isFavorite ? t("resource.unfavorite") : t("resource.favorite")}
          title={r.isFavorite ? t("resource.unfavorite") : t("resource.favorite")}
          className={`absolute end-2 top-2 grid size-9 place-items-center rounded-full bg-surface/90 shadow-soft transition-opacity ${
            r.isFavorite ? "text-accent" : "text-muted opacity-100 lg:opacity-0 lg:focus-visible:opacity-100 lg:group-hover:opacity-100"
          }`}
        >
          <Star className={`size-[1.1rem] ${r.isFavorite ? "fill-current" : ""}`} />
        </button>
      )}
    </article>
  );
}
