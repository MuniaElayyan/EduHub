"use client";

import { Copy, FileText, Save, Send, Sparkles, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, errorText } from "@/lib/api";
import { courseTitle, sectionLabel, unitLabel } from "@/lib/i18n";
import type { SectionDTO, UnitDTO } from "@/server/services/courses";
import type { ResourceDTO } from "@/server/services/resources";
import { Markdown } from "./markdown";
import { usePrefs, useToast } from "./providers";
import { PlacePicker, type Place } from "./resource-drawer";
import { Field, FormError, Modal, Spinner } from "./ui";
import { useWorkspace } from "./workspace";

const PRIMARY = ["lesson_plan", "quiz", "summary", "worksheet"] as const;
const MORE = ["flashcards", "questions", "objectives", "activities", "presentation_outline"] as const;
type Action = (typeof PRIMARY)[number] | (typeof MORE)[number];
type Msg = { role: "user" | "assistant"; content: string; action?: Action; failed?: boolean };

/** Where a generated draft is filed by default. */
const ACTION_SECTION: Partial<Record<Action, string>> = {
  lesson_plan: "lesson_plans", worksheet: "worksheets", quiz: "worksheets", presentation_outline: "presentations",
};

export function AiAssistant({
  state, onOpenChange, onClearResource,
}: {
  state: { open: boolean; prompt?: string; resource: ResourceDTO | null; nonce: number };
  onOpenChange: (open: boolean) => void;
  onClearResource: () => void;
}) {
  const { t, locale } = usePrefs();
  const toast = useToast();
  const { courses, getSections, getUnits, here } = useWorkspace();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<Action | null>(null);
  const [showMore, setShowMore] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [section, setSection] = useState<SectionDTO | null>(null);
  const [saving, setSaving] = useState<Msg | null>(null);
  // Off by default: the assistant reads the contents of the teacher's files only after they say so.
  const [useResources, setUseResources] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const cls = courses.find((c) => c.id === here.courseId) ?? null;
  const resource = state.resource;
  const [unit, setUnit] = useState<UnitDTO | null>(null);

  // Names for the "where you are" line: the unit and section the address points at.
  useEffect(() => {
    let live = true;
    setSection(null);
    setUnit(null);
    if (here.semesterId && here.unitId) {
      getUnits(here.semesterId).then((list) => live && setUnit(list.find((u) => u.id === here.unitId) ?? null)).catch(() => {});
      if (here.sectionId) getSections(here.unitId).then((list) => live && setSection(list.find((x) => x.id === here.sectionId) ?? null)).catch(() => {});
    }
    return () => {
      live = false;
    };
  }, [here.semesterId, here.unitId, here.sectionId, getSections, getUnits]);

  useEffect(() => {
    if (state.open) {
      if (state.prompt) setInput(state.prompt);
      inputRef.current?.focus();
    }
  }, [state.open, state.prompt, state.nonce]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [messages]);

  async function send(text: string, action?: Action) {
    const content = text.trim();
    if (!content || streaming) return;
    const history = [...messages.filter((m) => !m.failed && m.content), { role: "user" as const, content, action }];
    setMessages([...history, { role: "assistant", content: "", action }]);
    setInput("");
    setPending(null);
    setStreaming(true);
    abort.current = new AbortController();
    const patchLast = (fn: (m: Msg) => Msg) => setMessages((list) => list.map((m, i) => (i === list.length - 1 ? fn(m) : m)));

    try {
      const res = await fetch("/api/v1/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abort.current.signal,
        body: JSON.stringify({
          messages: history.map(({ role, content: c }) => ({ role, content: c })),
          // The assistant is told where the teacher is and which file is in front of them.
          context: { courseId: here.courseId, unitId: here.unitId, sectionId: here.sectionId, resourceId: resource?.id, useResources: useResources && !!cls },
          action,
        }),
      });
      if (!res.ok || !res.body) {
        const code = (await res.json().catch(() => null))?.error?.code ?? "ai_unavailable";
        patchLast((m) => ({ ...m, content: t(`errors.${code}`), failed: true }));
      } else {
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = dec.decode(value, { stream: true });
          patchLast((m) => ({ ...m, content: m.content + chunk }));
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") patchLast((m) => ({ ...m, content: t("errors.network"), failed: true }));
    }
    setStreaming(false);
  }

  function runAction(a: Action) {
    const text = input.trim() || (resource ? t("ai.aboutThisFile") : "");
    if (text) void send(text, a);
    else {
      // No topic yet: remember the choice and ask for one.
      setPending(a);
      inputRef.current?.focus();
    }
  }

  if (!state.open) {
    return (
      <button
        type="button"
        onClick={() => onOpenChange(true)}
        aria-label={t("ai.open")}
        title={t("ai.open")}
        className="fixed bottom-[5.25rem] end-4 z-30 grid size-14 place-items-center rounded-full bg-brand text-brand-ink shadow-soft lg:bottom-6 lg:end-6"
      >
        <Sparkles className="size-6" />
      </button>
    );
  }

  const chip = (a: Action) => (
    <button key={a} type="button" disabled={streaming} aria-pressed={pending === a} onClick={() => runAction(a)}
      className={`shrink-0 rounded-full border px-3 py-1.5 text-sm font-medium ${pending === a ? "border-brand bg-brand-soft text-brand" : "border-line hover:border-muted"}`}>
      {t(`ai.actions.${a}`)}
    </button>
  );

  return (
    <>
      <section
        aria-label={t("ai.title")}
        className="pop-in fixed inset-0 z-40 flex flex-col bg-surface lg:inset-auto lg:bottom-6 lg:end-6 lg:h-[min(44rem,calc(100dvh-3rem))] lg:w-[27rem] lg:rounded-2xl lg:border lg:border-line lg:shadow-soft"
      >
        <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold"><Sparkles className="size-5 text-brand" aria-hidden />{t("ai.title")}</h2>
          <div className="flex items-center">
            {messages.length > 0 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMessages([])} disabled={streaming}>{t("ai.newChat")}</button>}
            <button type="button" className="btn btn-ghost btn-icon" onClick={() => onOpenChange(false)} aria-label={t("common.close")}><X className="size-5" /></button>
          </div>
        </header>

        {(cls || resource) && (
          <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-4 py-2 text-sm">
            <span className="text-muted">{t("ai.context")}</span>
            {cls && <span className="chip">{courseTitle(t, locale, cls)}{unit ? ` › ${unitLabel(t, unit)}` : ""}{section ? ` › ${sectionLabel(locale, section)}` : ""}</span>}
            {resource && (
              <span className="chip max-w-full">
                <FileText className="size-3.5 shrink-0" aria-hidden />
                <span className="truncate" dir="auto">{resource.title}</span>
                <button type="button" onClick={onClearResource} aria-label={t("ai.clearFile")} className="-me-1 grid size-5 place-items-center rounded-full hover:bg-line"><X className="size-3" /></button>
              </span>
            )}
          </div>
        )}

        {cls && (
          <label className="flex cursor-pointer items-start gap-2.5 border-b border-line px-4 py-2.5 text-sm">
            <input type="checkbox" className="mt-1 size-4 accent-[var(--brand)]" checked={useResources} onChange={(e) => setUseResources(e.target.checked)} />
            <span>
              <span className="font-medium">{t(section ? "ai.useSection" : unit ? "ai.useUnit" : "ai.useClass")}</span>
              <span className="block text-xs text-muted">{t("ai.useHint")}</span>
            </span>
          </label>
        )}

        <div ref={scroller} className="flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite">
          {messages.length === 0 && (
            <div>
              <p className="font-semibold">{t("ai.greeting")}</p>
              <p className="mt-1 text-sm text-muted">{t("ai.greetingBody")}</p>
              <ul className="mt-4 space-y-2">
                {(cls ? [4, 1, 3] : [1, 2, 3]).map((n) => (
                  <li key={n}>
                    <button type="button" onClick={() => { if (n === 4) setUseResources(true); setInput(t(`ai.examples.${n}`)); inputRef.current?.focus(); }}
                      className="w-full rounded-xl border border-line px-3 py-2.5 text-start text-sm hover:border-muted">
                      {t(`ai.examples.${n}`)}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {messages.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="ms-auto w-fit max-w-[88%] rounded-2xl rounded-ee-md bg-brand px-3.5 py-2 text-brand-ink" dir="auto">
                {m.action && <span className="mb-0.5 block text-xs font-semibold opacity-80">{t(`ai.actions.${m.action}`)}</span>}
                <span className="whitespace-pre-wrap">{m.content}</span>
              </div>
            ) : (
              <div key={i} className={`max-w-[95%] rounded-2xl rounded-es-md border px-3.5 py-2.5 ${m.failed ? "border-danger/40 text-danger" : "border-line bg-bg"}`}>
                {m.content ? <Markdown>{m.content}</Markdown> : <span className="flex items-center gap-2 text-sm text-muted"><Spinner className="size-4" />{t("ai.thinking")}</span>}
                {m.content && !m.failed && !(streaming && i === messages.length - 1) && (
                  <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-2.5">
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => setSaving(m)}><Save className="size-4" aria-hidden />{t("ai.saveAsNote")}</button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigator.clipboard.writeText(m.content).then(() => toast(t("ai.copied")))}>
                      <Copy className="size-4" aria-hidden />{t("common.copy")}
                    </button>
                  </div>
                )}
              </div>
            ),
          )}
        </div>

        <div className="border-t border-line px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
          <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-3">
            {PRIMARY.map(chip)}
            {showMore ? MORE.map(chip) : (
              <button type="button" className="shrink-0 rounded-full border border-dashed border-line px-3 py-1.5 text-sm text-muted hover:border-muted" onClick={() => setShowMore(true)}>{t("common.more")}</button>
            )}
          </div>
          <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); void send(input, pending ?? undefined); }}>
            <textarea
              ref={inputRef}
              className="input max-h-36 !min-h-11 resize-none"
              rows={1}
              dir="auto"
              value={input}
              aria-label={t("ai.placeholder")}
              placeholder={pending ? t("ai.topicPlaceholder", { action: t(`ai.actions.${pending}`) }) : t("ai.placeholder")}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send(input, pending ?? undefined);
                }
              }}
            />
            {streaming ? (
              <button type="button" className="btn btn-outline btn-icon shrink-0" onClick={() => abort.current?.abort()} aria-label={t("ai.stop")}><Square className="size-4 fill-current" /></button>
            ) : (
              <button className="btn btn-primary btn-icon shrink-0" disabled={!input.trim()} aria-label={t("ai.send")}><Send className="size-5 rtl:-scale-x-100" /></button>
            )}
          </form>
          <p className="mt-2 text-center text-xs text-muted">{t("ai.disclaimer")}</p>
        </div>
      </section>

      <SaveNote message={saving} onClose={() => setSaving(null)} />
    </>
  );
}

/** Preview → edit → save. The draft becomes a new note; existing files are never changed. */
function SaveNote({ message, onClose }: { message: Msg | null; onClose: () => void }) {
  const { t } = usePrefs();
  const toast = useToast();
  const { courses, getSemesters, getUnits, getSections, refresh, here } = useWorkspace();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [tab, setTab] = useState<"preview" | "edit">("preview");
  const [place, setPlace] = useState<Place>({ courseId: "", semesterId: "", unitId: "", sectionId: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!message) return;
    const firstLine = message.content.split("\n").find((l) => l.trim()) ?? "";
    setTitle(firstLine.replace(/^[#>*\s-]+/, "").replace(/[*_`]/g, "").slice(0, 120));
    setContent(message.content);
    setTab("preview");
    setError(null);
    setBusy(false);
    // Default to where the teacher is, and to the section that suits what was generated.
    (async () => {
      const courseId = here.courseId && courses.some((c) => c.id === here.courseId) ? here.courseId : courses[0]?.id ?? "";
      if (!courseId) return;
      const sems = await getSemesters(courseId);
      const semesterId = sems.find((x) => x.id === here.semesterId)?.id ?? sems[0]?.id ?? "";
      const units = semesterId ? await getUnits(semesterId) : [];
      const unitId = units.find((u) => u.id === here.unitId)?.id ?? units[0]?.id ?? "";
      const secs = unitId ? await getSections(unitId) : [];
      const wanted = (message.action && ACTION_SECTION[message.action]) ?? "lesson_plans";
      const sectionId = (secs.find((x) => x.id === here.sectionId) ?? secs.find((x) => x.typeKey === wanted) ?? secs[0])?.id ?? "";
      setPlace({ courseId, semesterId, unitId, sectionId });
    })().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api("/resources", { body: { kind: "note", sectionId: place.sectionId, title, content } });
      toast(t("ai.saved"));
      refresh();
      onClose();
    } catch (err) {
      setError(errorText(t, err));
      setBusy(false);
    }
  }

  return (
    <Modal open={!!message} onClose={onClose} title={t("ai.saveAsNote")} wide>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <Field label={t("add.title")}><input className="input" required maxLength={200} dir="auto" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <PlacePicker value={place} onChange={setPlace} />
        <div>
          <div role="tablist" className="mb-2 inline-grid grid-cols-2 gap-1 rounded-xl bg-surface2 p-1">
            {(["preview", "edit"] as const).map((k) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                className={`min-h-9 rounded-lg px-4 text-sm font-semibold ${tab === k ? "bg-surface shadow-soft" : "text-muted"}`}>
                {t(k === "preview" ? "resource.preview" : "common.edit")}
              </button>
            ))}
          </div>
          {tab === "preview" ? (
            <div className="max-h-[45dvh] overflow-y-auto rounded-xl border border-line p-4"><Markdown>{content}</Markdown></div>
          ) : (
            <textarea className="input font-mono text-sm" dir="auto" rows={14} value={content} onChange={(e) => setContent(e.target.value)} aria-label={t("resource.content")} />
          )}
        </div>
        <FormError message={error} />
        <div className="flex gap-2">
          <button className="btn btn-primary" disabled={busy || !place.sectionId || !title.trim()}>{busy && <Spinner />}{t("common.save")}</button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>{t("common.cancel")}</button>
        </div>
      </form>
    </Modal>
  );
}
