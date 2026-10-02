"use client";

import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, errorText } from "@/lib/api";
import { COLORS, GRADES, SECTION_ICONS, type ColorName } from "@/lib/constants";
import { subjectName } from "@/lib/i18n";
import type { SectionDTO } from "@/server/services/courses";
import { SECTION_ICON } from "./icons";
import { usePrefs, useToast } from "./providers";
import { Field, FormError, Modal, Spinner } from "./ui";
import { useWorkspace } from "./workspace";

function ColorPicker({ value, onChange }: { value: ColorName; onChange: (c: ColorName) => void }) {
  const { t } = usePrefs();
  return (
    <div role="radiogroup" aria-label={t("classPage.color")} className="flex flex-wrap gap-2">
      {COLORS.map((c) => (
        <button key={c} type="button" role="radio" aria-checked={value === c} aria-label={t(`colors.${c}`)} title={t(`colors.${c}`)} data-color={c} onClick={() => onChange(c)}
          className="grid size-11 place-items-center rounded-full bg-[var(--c)] text-white">
          {value === c && <Check className="size-5" aria-hidden />}
        </button>
      ))}
    </div>
  );
}

/** Add a class: one subject in one grade. Semesters and units come with it. */
export function AddCourseModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, locale } = usePrefs();
  const toast = useToast();
  const router = useRouter();
  const { courses, subjects, refresh } = useWorkspace();
  const mine = [...new Set(courses.map((c) => c.subjectCode))];
  const [subjectCode, setSubjectCode] = useState("");
  const [grade, setGrade] = useState<number | null>(null);
  const [color, setColor] = useState<ColorName>("green");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSubjectCode(mine[0] ?? "");
    setGrade(null);
    setColor(COLORS[courses.length % COLORS.length]);
    setError(null);
    setBusy(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ course: { id: string } }>("/courses", { body: { subjectCode, grade, color } });
      toast(t("classPage.created"));
      refresh();
      onClose();
      router.push(`/app/classes/${res.course.id}`);
    } catch (err) {
      setError(errorText(t, err));
      setBusy(false);
    }
  }

  // The teacher's own subjects come first; the rest of the list follows.
  const ordered = [...subjects.filter((s) => mine.includes(s.code)), ...subjects.filter((s) => !mine.includes(s.code))];

  return (
    <Modal open={open} onClose={onClose} title={t("dash.quick.addClass")}>
      <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); void create(); }}>
        <Field label={t("place.subject")}>
          <select className="input" value={subjectCode} onChange={(e) => setSubjectCode(e.target.value)} required>
            {!subjectCode && <option value="">{t("place.choose")}</option>}
            {ordered.map((s) => <option key={s.code} value={s.code}>{subjectName(locale, s)}</option>)}
          </select>
        </Field>
        <fieldset>
          <legend className="label">{t("classPage.pickGrade")}</legend>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {GRADES.map((g) => {
              const has = courses.some((c) => c.grade === g && c.subjectCode === subjectCode);
              return (
                <button key={g} type="button" disabled={has} aria-pressed={grade === g} onClick={() => setGrade(g)}
                  className={`min-h-12 rounded-xl border-2 px-2 text-sm font-semibold disabled:opacity-50 ${grade === g ? "border-brand bg-brand-soft text-brand" : "border-line hover:border-muted"}`}>
                  {t(`grades.${g}`)}
                  {has && <span className="block text-[0.7rem] font-normal text-muted">{t("classPage.alreadyHave")}</span>}
                </button>
              );
            })}
          </div>
        </fieldset>
        <div>
          <span className="label">{t("classPage.color")}</span>
          <ColorPicker value={color} onChange={setColor} />
        </div>
        <FormError message={error} />
        <div className="flex gap-2">
          <button className="btn btn-primary" disabled={busy || !subjectCode || grade === null}>{busy && <Spinner />}{t("classPage.create")}</button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>{t("common.cancel")}</button>
        </div>
      </form>
    </Modal>
  );
}

/** Add a section to a unit, or rename/restyle an existing one. Deleting is offered only for an empty section. */
export function SectionModal({ unitId, section, open, onClose }: { unitId: string; section?: SectionDTO | null; open: boolean; onClose: () => void }) {
  const { t, locale } = usePrefs();
  const toast = useToast();
  const { refresh } = useWorkspace();
  const [f, setF] = useState({ name: "", description: "", icon: "folder", color: "green" as ColorName });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setF(
      section
        ? { name: section.name ?? (locale === "ar" ? section.typeNameAr : section.typeNameEn) ?? "", description: section.description ?? "", icon: section.icon, color: section.color as ColorName }
        : { name: "", description: "", icon: "folder", color: "green" },
    );
    setError(null);
    setBusy(false);
  }, [open, section, locale]);

  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
      toast(done);
      refresh();
      onClose();
    } catch (err) {
      setError(errorText(t, err));
      setBusy(false);
    }
  }
  const save = () =>
    section
      ? run(() => api(`/sections/${section.id}`, { method: "PATCH", body: f }), t("resource.saved"))
      : run(() => api(`/units/${unitId}/sections`, { body: f }), t("section.created"));

  return (
    <Modal open={open} onClose={onClose} title={section ? t("section.edit") : t("section.add")}>
      <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <Field label={t("section.name")}>
          <input className="input" required maxLength={60} autoFocus placeholder={t("section.namePlaceholder")} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <div>
          <span className="label">{t("section.icon")}</span>
          <div role="radiogroup" aria-label={t("section.icon")} className="grid grid-cols-8 gap-1.5">
            {SECTION_ICONS.map((key) => {
              const Icon = SECTION_ICON[key];
              return (
                <button key={key} type="button" role="radio" aria-checked={f.icon === key} aria-label={key} onClick={() => setF({ ...f, icon: key })}
                  className={`grid aspect-square place-items-center rounded-lg border-2 ${f.icon === key ? "border-brand bg-brand-soft text-brand" : "border-transparent text-muted hover:bg-surface2"}`}>
                  <Icon className="size-5" aria-hidden />
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <span className="label">{t("classPage.color")}</span>
          <ColorPicker value={f.color} onChange={(color) => setF({ ...f, color })} />
        </div>
        <FormError message={error} />
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn btn-primary" disabled={busy || !f.name.trim()}>{busy && <Spinner />}{section ? t("common.save") : t("common.create")}</button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>{t("common.cancel")}</button>
          {section && (
            <button type="button" className="btn btn-ghost ms-auto text-danger" disabled={busy}
              onClick={() => run(() => api(`/sections/${section.id}`, { method: "DELETE" }), t("section.deleted"))}>
              {t("section.delete")}
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}
