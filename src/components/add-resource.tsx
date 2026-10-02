"use client";

import { FileText, Globe, Image as ImageIcon, Link2, Presentation, Upload, Video, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, errorText, uploadFile } from "@/lib/api";
import { ACCEPT_UPLOAD, FILE_TYPES } from "@/lib/constants";
import { formatBytes } from "@/lib/format";
import { courseTitle, sectionLabel, semesterLabel, unitLabel } from "@/lib/i18n";
import { inspectLink } from "@/lib/links";
import type { SectionDTO } from "@/server/services/courses";
import type { Suggestion } from "@/server/services/classify";
import { usePrefs, useToast } from "./providers";
import { parseTags, PlacePicker, type Place } from "./resource-drawer";
import { Field, FormError, Modal, Spinner } from "./ui";
import { useWorkspace, type Here } from "./workspace";

export type AddPreset = Here & { file?: File };

type Tile = { key: string; icon: LucideIcon; sources: ("file" | "url")[]; accept?: string; linkType?: string };
const TILES: Tile[] = [
  { key: "file", icon: Upload, sources: ["file"], accept: ACCEPT_UPLOAD },
  { key: "video", icon: Video, sources: ["url", "file"], accept: ".mp4,.mov", linkType: "video" },
  { key: "link", icon: Link2, sources: ["url"], linkType: "link" },
  { key: "image", icon: ImageIcon, sources: ["file"], accept: ".png,.jpg,.jpeg,.webp" },
  { key: "presentation", icon: Presentation, sources: ["file", "url"], accept: ".ppt,.pptx,.pdf", linkType: "presentation" },
  { key: "pdf", icon: FileText, sources: ["file", "url"], accept: ".pdf", linkType: "pdf" },
  { key: "document", icon: FileText, sources: ["file", "url"], accept: ".doc,.docx,.xls,.xlsx,.pdf", linkType: "document" },
  { key: "external", icon: Globe, sources: ["url"], linkType: "link" },
];

/** What a section's type means for links pasted into it. */
const SECTION_LINK_TYPE: Record<string, string> = { videos: "video", presentations: "presentation", files: "document", lesson_plans: "document", worksheets: "document" };

type Suggested = Suggestion & { courseId: string | null; semesterId: string | null; unitId: string | null; sectionId: string | null };
type Step = "choose" | "source" | "suggest" | "form";
const EMPTY: Place = { courseId: "", semesterId: "", unitId: "", sectionId: "" };

export function AddResourceModal({ preset, onClose }: { preset: AddPreset | null; onClose: () => void }) {
  const { t, locale } = usePrefs();
  const toast = useToast();
  const { courses, refresh, getSemesters, getUnits, getSections, openAddCourse } = useWorkspace();
  const [step, setStep] = useState<Step>("choose");
  const [tile, setTile] = useState<Tile>(TILES[0]);
  const [here, setHere] = useState<SectionDTO | null>(null);
  const [source, setSource] = useState<"file" | "url">("file");
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [suggestion, setSuggestion] = useState<Suggested | null>(null);
  const [form, setForm] = useState({ title: "", description: "", topic: "", tags: "" });
  const [place, setPlace] = useState<Place>(EMPTY);
  const [placeText, setPlaceText] = useState("");
  const [pickPlace, setPickPlace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // Start fresh each time. Opened inside a section, the dialog already knows the place and what that section accepts.
  useEffect(() => {
    if (!preset) return;
    let live = true;
    setFile(null);
    setUrl("");
    setSuggestion(null);
    setError(null);
    setProgress(null);
    setBusy(false);
    setPickPlace(false);
    setHere(null);
    setStep("choose");
    (async () => {
      let section: SectionDTO | null = null;
      if (preset.unitId && preset.sectionId) section = (await getSections(preset.unitId)).find((s) => s.id === preset.sectionId) ?? null;
      if (!live) return;
      if (section) {
        const sources: ("file" | "url")[] = [];
        if (section.exts === null || section.exts.length) sources.push("file");
        if (section.links) sources.push("url");
        setHere(section);
        setTile({
          key: "section", icon: Upload, sources,
          accept: section.exts === null ? ACCEPT_UPLOAD : section.exts.map((e) => `.${e}`).join(","),
          linkType: (section.typeKey && SECTION_LINK_TYPE[section.typeKey]) || "link",
        });
        setSource(sources[0]);
        setStep("source");
      }
      if (preset.file) await analyse({ file: preset.file }, section);
    })().catch(() => {});
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset]);

  async function describe(p: Place) {
    if (!p.sectionId) return "";
    const course = courses.find((c) => c.id === p.courseId);
    const sem = (await getSemesters(p.courseId)).find((s) => s.id === p.semesterId);
    const unit = (await getUnits(p.semesterId)).find((u) => u.id === p.unitId);
    const sec = (await getSections(p.unitId)).find((s) => s.id === p.sectionId);
    if (!course || !sem || !unit || !sec) return "";
    return [courseTitle(t, locale, course), semesterLabel(t, sem), unitLabel(t, unit), sectionLabel(locale, sec)].join(" › ");
  }

  /** Reads the name or link, asks the rules engine where it belongs, and prepares the form. Nothing is saved here. */
  async function analyse(input: { file?: File; url?: string }, section: SectionDTO | null = here) {
    setError(null);
    if (input.file) {
      const ext = input.file.name.split(".").pop()?.toLowerCase() ?? "";
      if (!FILE_TYPES[ext]) return setError(t("errors.unsupported_file_type"));
      if (section?.exts && !section.exts.includes(ext)) return setError(t("add.sectionRejects", { name: sectionLabel(locale, section) }));
      setFile(input.file);
    } else if (!inspectLink(input.url ?? "")) {
      return setError(t("errors.invalid_url"));
    }
    setBusy(true);
    try {
      const { suggestion: s } = await api<{ suggestion: Suggested }>("/resources/suggest", {
        body: { name: input.file?.name, url: input.url, courseId: preset?.courseId, semesterId: preset?.semesterId, unitId: preset?.unitId },
      });
      setSuggestion(s);
      setForm({ title: s.title || input.url || "", description: "", topic: s.topic ?? "", tags: s.tags.join(locale === "ar" ? "، " : ", ") });
      // Inside a section the place is known and is not asked again. Elsewhere the suggestion proposes it.
      const target: Place = section
        ? { courseId: section.courseId, semesterId: preset!.semesterId!, unitId: section.unitId, sectionId: section.id }
        : { courseId: s.courseId ?? courses[0]?.id ?? "", semesterId: s.semesterId ?? "", unitId: s.unitId ?? "", sectionId: s.sectionId ?? "" };
      setPlace(target);
      setPlaceText(await describe(target));
      setPickPlace(!section && !(s.confident && s.sectionId));
      setStep(!section && s.confident && s.sectionId ? "suggest" : "form");
    } catch (err) {
      setError(errorText(t, err));
    }
    setBusy(false);
  }

  async function save() {
    if (!place.sectionId || !form.title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const common = { sectionId: place.sectionId, title: form.title, description: form.description, topic: form.topic, tags: parseTags(form.tags) };
      if (file) {
        setProgress(0);
        const stored = await uploadFile(file, { onProgress: setProgress });
        await api("/resources", { body: { ...common, kind: "file", fileId: stored.id } });
      } else {
        await api("/resources", { body: { ...common, kind: "link", url, type: tile.linkType } });
      }
      toast(t("add.saved"));
      refresh();
      onClose();
    } catch (err) {
      setError(errorText(t, err));
      setProgress(null);
      setBusy(false);
    }
  }

  const title = here ? t("add.toSection", { name: sectionLabel(locale, here) }) : t("dash.quick.addResource");

  return (
    <Modal open={!!preset} onClose={onClose} title={title} wide={step === "choose"}>
      {courses.length === 0 ? (
        <div className="space-y-4 text-center">
          <p className="text-muted">{t("add.needClass")}</p>
          <button className="btn btn-primary" onClick={() => { onClose(); openAddCourse(); }}>{t("dash.quick.addClass")}</button>
        </div>
      ) : step === "choose" ? (
        <div>
          {busy ? (
            <div className="flex items-center justify-center gap-3 py-10 text-muted"><Spinner />{t("common.loading")}</div>
          ) : (
            <>
              <p className="mb-4 text-muted">{t("add.chooseHint")}</p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {TILES.map((tl) => (
                  <button key={tl.key} type="button" onClick={() => { setTile(tl); setSource(tl.sources[0]); setError(null); setStep("source"); }}
                    className="flex min-h-28 flex-col items-center justify-center gap-2 rounded-xl border border-line p-3 text-center font-semibold hover:border-brand hover:bg-brand-soft">
                    <tl.icon className="size-7 text-brand" aria-hidden />
                    {t(`add.kinds.${tl.key}`)}
                  </button>
                ))}
              </div>
            </>
          )}
          <div className="mt-4"><FormError message={error} /></div>
        </div>
      ) : step === "source" ? (
        <div className="space-y-4">
          {tile.sources.length > 1 && (
            <div role="tablist" className="grid grid-cols-2 gap-1 rounded-xl bg-surface2 p-1">
              {tile.sources.map((s) => (
                <button key={s} role="tab" aria-selected={source === s} type="button" onClick={() => { setSource(s); setError(null); }}
                  className={`min-h-11 rounded-lg font-semibold ${source === s ? "bg-surface shadow-soft" : "text-muted"}`}>
                  {t(s === "file" ? "add.fromDevice" : "add.pasteUrl")}
                </button>
              ))}
            </div>
          )}
          {source === "file" ? (
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files[0]) void analyse({ file: e.dataTransfer.files[0] }); }}
              className={`rounded-2xl border-2 border-dashed px-4 py-10 text-center ${dragOver ? "border-brand bg-brand-soft" : "border-line"}`}
            >
              <Upload className="mx-auto size-8 text-muted" aria-hidden />
              <p className="mt-3 hidden text-muted lg:block">{t("add.dropHere")}</p>
              <button type="button" className="btn btn-primary mt-4" disabled={busy} onClick={() => fileInput.current?.click()}>
                {busy && <Spinner />}{t("add.fromDevice")}
              </button>
              <input ref={fileInput} type="file" className="sr-only" tabIndex={-1} accept={tile.accept} onChange={(e) => e.target.files?.[0] && analyse({ file: e.target.files[0] })} />
              <p className="mt-3 text-xs text-muted" dir="ltr">{(tile.accept ?? "").replaceAll(".", "").replaceAll(",", "  ").toUpperCase()}</p>
            </div>
          ) : (
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void analyse({ url: url.trim() }); }}>
              <Field label={t("add.pasteUrl")} hint={t(here?.typeKey === "videos" ? "add.urlHintVideo" : here?.typeKey === "presentations" ? "add.urlHintSlides" : "add.urlHint")}>
                <input className="input" type="url" dir="ltr" autoFocus required placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} />
              </Field>
              <button className="btn btn-primary" disabled={busy}>{busy && <Spinner />}{t("common.next")}</button>
            </form>
          )}
          <FormError message={error} />
          {!here && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setStep("choose")}>{t("common.back")}</button>}
        </div>
      ) : step === "suggest" && suggestion ? (
        <div className="space-y-4">
          <p className="font-semibold">{t("suggest.question")}</p>
          <dl className="divide-y divide-line rounded-xl border border-line text-sm">
            {([
              [t("add.title"), form.title],
              [t("add.place"), placeText],
              [t("add.topic"), suggestion.topic],
              [t("filters.tags"), suggestion.tags.join(locale === "ar" ? "، " : ", ")],
            ] as [string, string | null][]).filter(([, v]) => v).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 px-4 py-2.5">
                <dt className="shrink-0 text-muted">{k}</dt>
                <dd className="text-end font-semibold" dir="auto">{v}</dd>
              </div>
            ))}
          </dl>
          {progress !== null && <Progress value={progress} />}
          <FormError message={error} />
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-primary" disabled={busy} onClick={save}>{busy && <Spinner />}{t("suggest.approve")}</button>
            <button className="btn btn-outline" disabled={busy} onClick={() => { setPickPlace(true); setStep("form"); }}>{t("common.edit")}</button>
            <button className="btn btn-ghost" disabled={busy} onClick={onClose}>{t("common.cancel")}</button>
          </div>
        </div>
      ) : (
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          {file && <p className="chip" dir="ltr">{file.name}&nbsp;&nbsp;({formatBytes(file.size, locale)})</p>}
          <Field label={t("add.title")}><input className="input" required maxLength={200} dir="auto" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
          {pickPlace ? (
            <PlacePicker value={place} onChange={setPlace} />
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface2 px-4 py-3 text-sm">
              <span><span className="text-muted">{t("add.savedIn")}</span> <span className="font-semibold">{placeText}</span></span>
              <button type="button" className="font-semibold text-brand hover:underline" onClick={() => setPickPlace(true)}>{t("add.changePlace")}</button>
            </div>
          )}
          <Field label={`${t("add.topic")} (${t("common.optional")})`}><input className="input" maxLength={80} value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })} /></Field>
          <Field label={`${t("filters.tags")} (${t("common.optional")})`} hint={t("add.tagsHint")}><input className="input" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} /></Field>
          {progress !== null && <Progress value={progress} />}
          <FormError message={error} />
          <div className="flex gap-2">
            <button className="btn btn-primary" disabled={busy || !place.sectionId}>{busy && <Spinner />}{t("add.save")}</button>
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={onClose}>{t("common.cancel")}</button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function Progress({ value }: { value: number }) {
  const { t } = usePrefs();
  const pct = Math.round(value * 100);
  return (
    <div>
      <div className="flex justify-between text-sm text-muted"><span>{t("add.uploading")}</span><span dir="ltr">{pct}%</span></div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={t("add.uploading")}>
        <div className="h-full rounded-full bg-brand transition-[width]" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
