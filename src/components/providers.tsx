"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import type { Locale, Theme } from "@/lib/constants";
import { createT, type T } from "@/lib/i18n";

type Prefs = {
  locale: Locale;
  theme: Theme;
  t: T;
  setLocale: (l: Locale) => void;
  setTheme: (t: Theme) => void;
};
const PrefsCtx = createContext<Prefs | null>(null);
const ToastCtx = createContext<(message: string, kind?: "ok" | "error") => void>(() => {});

const YEAR = 31_536_000;
const setCookie = (name: string, value: string) => {
  document.cookie = `${name}=${value}; path=/; max-age=${YEAR}; samesite=lax`;
};

export function Providers({ locale, theme: initialTheme, signedIn, children }: { locale: Locale; theme: Theme; signedIn: boolean; children: ReactNode }) {
  const router = useRouter();
  const [theme, setThemeState] = useState(initialTheme);
  const [toasts, setToasts] = useState<{ id: number; message: string; kind: "ok" | "error" }[]>([]);
  const nextId = useRef(1);
  const toastBox = useRef<HTMLDivElement>(null);

  // Toasts live in the browser's top layer so they stay visible above open dialogs.
  useEffect(() => {
    const el = toastBox.current;
    if (!el?.showPopover) return;
    try {
      if (el.matches(":popover-open")) el.hidePopover();
      if (toasts.length) el.showPopover();
    } catch {
      /* popover API unavailable: toasts still render in place */
    }
  }, [toasts]);
  const t = useMemo(() => createT(locale), [locale]);

  // Choices are kept on this device (cookie) and, when signed in, on the account.
  const setLocale = useCallback(
    (l: Locale) => {
      setCookie("eduhub_locale", l);
      if (signedIn) void api("/me", { method: "PATCH", body: { locale: l } }).catch(() => {});
      router.refresh();
    },
    [router, signedIn],
  );
  const setTheme = useCallback(
    (th: Theme) => {
      setCookie("eduhub_theme", th);
      if (th === "system") delete document.documentElement.dataset.theme;
      else document.documentElement.dataset.theme = th;
      setThemeState(th);
      if (signedIn) void api("/me", { method: "PATCH", body: { theme: th } }).catch(() => {});
    },
    [signedIn],
  );

  const toast = useCallback((message: string, kind: "ok" | "error" = "ok") => {
    const id = nextId.current++;
    setToasts((list) => [...list, { id, message, kind }]);
    setTimeout(() => setToasts((list) => list.filter((x) => x.id !== id)), 4500);
  }, []);

  const prefs = useMemo(() => ({ locale, theme, t, setLocale, setTheme }), [locale, theme, t, setLocale, setTheme]);

  return (
    <PrefsCtx.Provider value={prefs}>
      <ToastCtx.Provider value={toast}>
        {children}
        <div ref={toastBox} popover="manual" aria-live="polite" className="toasts">
          {toasts.map((x) => (
            <div
              key={x.id}
              role="status"
              className={`pop-in pointer-events-auto max-w-md rounded-xl px-4 py-3 text-sm font-medium shadow-soft ${
                x.kind === "error" ? "bg-danger text-surface" : "bg-ink text-bg"
              }`}
            >
              {x.message}
            </div>
          ))}
        </div>
      </ToastCtx.Provider>
    </PrefsCtx.Provider>
  );
}

export function usePrefs() {
  const ctx = useContext(PrefsCtx);
  if (!ctx) throw new Error("usePrefs must be used inside <Providers>");
  return ctx;
}
export const useT = () => usePrefs().t;
export const useToast = () => useContext(ToastCtx);
