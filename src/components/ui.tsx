"use client";

import { Languages, Loader2, Monitor, Moon, Sun, X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { usePrefs } from "./providers";

export function Spinner({ className = "" }: { className?: string }) {
  return <Loader2 aria-hidden className={`spin size-5 ${className}`} />;
}

/** Modal built on <dialog>: focus is trapped, Escape closes, the page behind is inert. */
export function Modal({
  open, onClose, title, children, wide,
}: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const { t } = usePrefs();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => e.target === ref.current && onClose()}
      className={`m-auto w-[calc(100%-1.5rem)] rounded-2xl border border-line bg-surface p-0 shadow-soft ${wide ? "max-w-3xl" : "max-w-lg"} max-h-[calc(100dvh-2rem)]`}
    >
      {open && (
        <div className="flex max-h-[calc(100dvh-2rem)] flex-col">
          <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
            <h2 className="text-lg font-semibold">{title}</h2>
            <button type="button" className="btn btn-ghost btn-icon -me-2" onClick={onClose} aria-label={t("common.close")}>
              <X className="size-5" />
            </button>
          </header>
          <div className="overflow-y-auto p-5">{children}</div>
        </div>
      )}
    </dialog>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-sm text-muted">{hint}</span>}
    </label>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm font-medium text-danger">
      {message}
    </p>
  );
}

/** "العربية | English": both names always visible, each in its own language. */
export function LangSwitch({ className = "" }: { className?: string }) {
  const { locale, setLocale, t } = usePrefs();
  return (
    <div role="group" aria-label={t("common.language")} className={`inline-flex items-center gap-1 text-sm ${className}`}>
      <Languages aria-hidden className="me-1 size-4 text-muted" />
      {(["ar", "en"] as const).map((l, i) => (
        <span key={l} className="inline-flex items-center gap-1">
          {i > 0 && <span aria-hidden className="text-line">|</span>}
          <button
            type="button"
            lang={l}
            aria-pressed={locale === l}
            onClick={() => locale !== l && setLocale(l)}
            className={`rounded-md px-1.5 py-1 ${locale === l ? "font-bold text-ink" : "text-muted hover:text-ink"}`}
          >
            {l === "ar" ? "العربية" : "English"}
          </button>
        </span>
      ))}
    </div>
  );
}

export function ThemeSwitch() {
  const { theme, setTheme, t } = usePrefs();
  const options = [
    { value: "light", icon: Sun },
    { value: "dark", icon: Moon },
    { value: "system", icon: Monitor },
  ] as const;
  return (
    <div role="group" aria-label={t("common.theme")} className="inline-flex rounded-xl border border-line bg-surface p-0.5">
      {options.map(({ value, icon: Icon }) => (
        <button
          key={value}
          type="button"
          aria-pressed={theme === value}
          title={t(`theme.${value}`)}
          aria-label={t(`theme.${value}`)}
          onClick={() => setTheme(value)}
          className={`grid size-9 place-items-center rounded-[0.6rem] ${theme === value ? "bg-brand-soft text-brand" : "text-muted hover:text-ink"}`}
        >
          <Icon className="size-4" />
        </button>
      ))}
    </div>
  );
}

export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-display text-xl font-bold tracking-tight ${className}`}>
      <span aria-hidden className="notebook size-8 !rounded-md !shadow-none" data-color="green" />
      EduHub
    </span>
  );
}
