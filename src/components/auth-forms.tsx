"use client";

import { Check, Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { api, ApiFailure, errorText } from "@/lib/api";
import { GRADES } from "@/lib/constants";
import { subjectName } from "@/lib/i18n";
import type { SubjectDTO } from "@/server/services/courses";
import { usePrefs } from "./providers";
import { Field, FormError, Spinner } from "./ui";

export type Reference = { subjects: SubjectDTO[]; academicYears: string[]; google: boolean };

/* ── Small shared pieces ───────────────────────────────────────────── */

export function Choice({ selected, onClick, children, className = "" }: { selected: boolean; onClick: () => void; children: ReactNode; className?: string }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`relative flex min-h-12 items-center justify-center gap-2 rounded-xl border-2 px-3 py-2.5 text-center font-semibold transition-colors ${
        selected ? "border-brand bg-brand-soft text-brand" : "border-line bg-surface hover:border-muted"
      } ${className}`}
    >
      {selected && <Check aria-hidden className="absolute end-1.5 top-1.5 size-4" />}
      {children}
    </button>
  );
}

/** Six boxes for the emailed code. Typing moves forward, Backspace moves back, and a pasted code fills them all. */
export function CodeInput({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const { t } = usePrefs();
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length: 6 }, (_, i) => value[i] ?? "");
  const clean = (s: string) => s.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/\D/g, "");

  function type(i: number, raw: string) {
    const d = clean(raw);
    if (!d) return;
    const next = (value.slice(0, i) + d + value.slice(i + d.length)).slice(0, 6);
    onChange(next);
    refs.current[Math.min(i + d.length, 5)]?.focus();
  }
  function keyDown(i: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace") {
      e.preventDefault();
      const at = digits[i] ? i : Math.max(i - 1, 0);
      onChange(value.slice(0, at));
      refs.current[at]?.focus();
    }
  }
  function paste(e: ClipboardEvent<HTMLInputElement>) {
    e.preventDefault();
    const d = clean(e.clipboardData.getData("text")).slice(0, 6);
    onChange(d);
    refs.current[Math.min(d.length, 5)]?.focus();
  }

  return (
    <div dir="ltr" role="group" aria-label={t("auth.codeLabel")} className="flex justify-center gap-2">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          value={d}
          disabled={disabled}
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          aria-label={t("auth.codeDigit", { n: i + 1 })}
          autoFocus={i === 0}
          onChange={(e) => type(i, e.target.value)}
          onKeyDown={(e) => keyDown(i, e)}
          onPaste={paste}
          onFocus={(e) => e.target.select()}
          className="input !min-h-14 !w-11 !px-0 text-center text-2xl font-bold sm:!w-12"
        />
      ))}
    </div>
  );
}

export function useCountdown(start: number) {
  const [left, setLeft] = useState(start);
  useEffect(() => {
    if (left <= 0) return;
    const id = setTimeout(() => setLeft(left - 1), 1000);
    return () => clearTimeout(id);
  }, [left]);
  return [left, setLeft] as const;
}

export const retryAfter = (err: unknown) => (err instanceof ApiFailure && typeof err.extra?.retryAfter === "number" ? err.extra.retryAfter : null);

function GoogleButton({ remember = false, label }: { remember?: boolean; label: string }) {
  return (
    <a href={`/api/v1/auth/oauth/google/start?remember=${remember ? 1 : 0}`} className="btn btn-outline w-full">
      <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
        <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.5 5.5 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8z" />
        <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24z" />
        <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.3a12 12 0 0 0 0 10.8l4-3.1z" />
        <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9z" />
      </svg>
      {label}
    </a>
  );
}

const Divider = ({ label }: { label: string }) => (
  <div className="flex items-center gap-3 text-sm text-muted"><span className="h-px flex-1 bg-line" />{label}<span className="h-px flex-1 bg-line" /></div>
);

/* ── The teacher's details, shared by registration and by "complete your profile" ── */

type Profile = {
  firstName: string; secondName: string; thirdName: string; lastName: string; gender: "" | "male" | "female";
  nationalId: string; schoolName: string; subjects: string[]; grades: number[]; academicYear: string;
};
const emptyProfile = (year: string, names: Partial<Profile> = {}): Profile => ({
  firstName: "", secondName: "", thirdName: "", lastName: "", gender: "", nationalId: "", schoolName: "", subjects: [], grades: [], academicYear: year, ...names,
});
const personValid = (p: Profile) =>
  [p.firstName, p.secondName, p.thirdName, p.lastName].every((v) => v.trim()) && p.gender !== "" && p.nationalId.replace(/\D/g, "").length >= 6;
const teachingValid = (p: Profile) => p.schoolName.trim().length >= 2 && p.subjects.length > 0 && p.grades.length > 0 && !!p.academicYear;

function PersonFields({ p, set }: { p: Profile; set: (patch: Partial<Profile>) => void }) {
  const { t } = usePrefs();
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        {(["firstName", "secondName", "thirdName", "lastName"] as const).map((k, i) => (
          <Field key={k} label={t(`profile.${k}`)}>
            <input className="input" autoFocus={i === 0} maxLength={60} value={p[k]} onChange={(e) => set({ [k]: e.target.value })}
              autoComplete={k === "firstName" ? "given-name" : k === "lastName" ? "family-name" : "additional-name"} />
          </Field>
        ))}
      </div>
      <fieldset>
        <legend className="label">{t("profile.gender")}</legend>
        <div className="grid grid-cols-2 gap-3">
          {(["male", "female"] as const).map((g) => <Choice key={g} selected={p.gender === g} onClick={() => set({ gender: g })}>{t(`profile.${g}`)}</Choice>)}
        </div>
      </fieldset>
      <Field label={t("profile.nationalId")} hint={t("profile.nationalIdHint")}>
        <input className="input" dir="ltr" inputMode="numeric" maxLength={24} autoComplete="off" value={p.nationalId} onChange={(e) => set({ nationalId: e.target.value })} />
      </Field>
    </div>
  );
}

function TeachingFields({ p, set, reference }: { p: Profile; set: (patch: Partial<Profile>) => void; reference: Reference }) {
  const { t, locale } = usePrefs();
  const [filter, setFilter] = useState("");
  const toggle = <V,>(list: V[], v: V) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    // Chosen subjects stay visible while filtering, so nothing selected is ever hidden.
    return reference.subjects.filter((s) => p.subjects.includes(s.code) || !q || s.nameAr.includes(filter.trim()) || s.nameEn.toLowerCase().includes(q));
  }, [reference.subjects, filter, p.subjects]);

  return (
    <div className="space-y-6">
      <Field label={t("profile.schoolName")} hint={t("profile.schoolNameHint")}>
        <input className="input" autoFocus maxLength={150} autoComplete="organization" value={p.schoolName} onChange={(e) => set({ schoolName: e.target.value })} />
      </Field>
      <fieldset>
        <legend className="label">{t("profile.subjects")}</legend>
        <div className="relative mb-2">
          <Search aria-hidden className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <input type="search" className="input !min-h-10 !ps-9" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t("profile.subjectsSearch")} aria-label={t("profile.subjectsSearch")} />
        </div>
        <div className="grid max-h-56 grid-cols-2 gap-2 overflow-y-auto rounded-xl border border-line p-2 sm:grid-cols-3">
          {shown.map((s) => (
            <Choice key={s.code} selected={p.subjects.includes(s.code)} onClick={() => set({ subjects: toggle(p.subjects, s.code) })} className="!min-h-11 text-sm">
              {subjectName(locale, s)}
            </Choice>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="label">{t("profile.grades")}</legend>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {GRADES.map((g) => (
            <Choice key={g} selected={p.grades.includes(g)} onClick={() => set({ grades: toggle(p.grades, g) })} className="!min-h-11 text-sm">{t(`grades.${g}`)}</Choice>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="label">{t("profile.academicYear")}</legend>
        <div className="grid grid-cols-3 gap-2">
          {reference.academicYears.map((y) => (
            <Choice key={y} selected={p.academicYear === y} onClick={() => set({ academicYear: y })}><span dir="ltr">{y}</span></Choice>
          ))}
        </div>
      </fieldset>
    </div>
  );
}

function Steps({ current, total }: { current: number; total: number }) {
  const { t } = usePrefs();
  return (
    <div>
      <p className="text-sm text-muted">{t("auth.step", { n: current + 1, total })}</p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface2" role="progressbar" aria-valuemin={1} aria-valuemax={total} aria-valuenow={current + 1}>
        <div className="h-full rounded-full bg-brand transition-[width] duration-300" style={{ width: `${((current + 1) / total) * 100}%` }} />
      </div>
    </div>
  );
}

/* ── Registration: three short steps, then the emailed code ────────── */

export function RegisterWizard({ reference }: { reference: Reference }) {
  const { t, locale, theme } = usePrefs();
  const [step, setStep] = useState(0);
  const [p, setP] = useState(() => emptyProfile(reference.academicYears[1]));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<Profile>) => setP((s) => ({ ...s, ...patch }));

  const mismatch = confirm.length > 0 && confirm !== password;
  const valid = [personValid(p), /.+@.+\..+/.test(email) && password.length >= 8 && confirm === password, teachingValid(p)][step];

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setError(null);
    if (step < 2) return setStep(step + 1);
    setBusy(true);
    try {
      await api("/auth/register", { body: { ...p, email, password, locale, theme } });
      window.location.assign("/app");
    } catch (err) {
      const code = err instanceof ApiFailure ? err.code : "";
      // Send the teacher back to the step that holds the field in question.
      if (code === "email_taken") setStep(1);
      if (code === "national_id_taken" || code === "invalid_national_id") setStep(0);
      setError(errorText(t, err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold sm:text-3xl">{t(`auth.register.title${step}`)}</h1>
        <p className="mt-2 text-muted">{t(`auth.register.hint${step}`)}</p>
      </div>
      <Steps current={step} total={3} />
      {step === 0 && reference.google && (
        <>
          <GoogleButton label={t("auth.googleSignup")} />
          <Divider label={t("auth.or")} />
        </>
      )}
      <FormError message={error} />
      {step === 0 && <PersonFields p={p} set={set} />}
      {step === 1 && (
        <div className="space-y-5">
          <Field label={t("auth.email")} hint={t("auth.emailHint")}>
            <input className="input" type="email" dir="ltr" autoFocus autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label={t("auth.password")} hint={t("auth.passwordHint")}>
            <input className="input" type="password" dir="ltr" autoComplete="new-password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Field label={t("auth.confirmPassword")}>
            <input className="input" type="password" dir="ltr" autoComplete="new-password" aria-invalid={mismatch} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>
          {mismatch && <p role="alert" className="text-sm font-medium text-danger">{t("auth.passwordMismatch")}</p>}
        </div>
      )}
      {step === 2 && <TeachingFields p={p} set={set} reference={reference} />}
      <div className="flex items-center justify-between gap-3">
        <button type="button" className="btn btn-ghost" onClick={() => setStep(step - 1)} disabled={step === 0 || busy}>{t("common.back")}</button>
        <button className={`btn px-6 ${step === 2 ? "btn-accent" : "btn-primary"}`} disabled={!valid || busy}>
          {busy && <Spinner />}
          {step === 2 ? t("auth.register.submit") : t("common.next")}
        </button>
      </div>
      <p className="text-center text-sm text-muted">{t("auth.haveAccount")} <Link href="/login" className="font-semibold text-brand hover:underline">{t("auth.login")}</Link></p>
    </form>
  );
}

/* ── After a first Google sign-in: the details Google cannot know ───── */

export function CompleteProfile({ reference, email, firstName, lastName }: { reference: Reference; email: string; firstName: string; lastName: string }) {
  const { t, locale, theme } = usePrefs();
  const [step, setStep] = useState(0);
  const [p, setP] = useState(() => emptyProfile(reference.academicYears[1], { firstName, lastName }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<Profile>) => setP((s) => ({ ...s, ...patch }));
  const valid = step === 0 ? personValid(p) : teachingValid(p);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setError(null);
    if (step === 0) return setStep(1);
    setBusy(true);
    try {
      await api("/auth/complete-profile", { body: { ...p, locale, theme } });
      window.location.assign("/app");
    } catch (err) {
      if (err instanceof ApiFailure && (err.code === "national_id_taken" || err.code === "invalid_national_id")) setStep(0);
      setError(errorText(t, err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold sm:text-3xl">{t("auth.complete.title")}</h1>
        <p className="mt-2 text-muted">{t("auth.complete.hint")} <span dir="ltr" className="font-medium text-ink">{email}</span></p>
      </div>
      <Steps current={step} total={2} />
      <FormError message={error} />
      {step === 0 ? <PersonFields p={p} set={set} /> : <TeachingFields p={p} set={set} reference={reference} />}
      <div className="flex items-center justify-between gap-3">
        <button type="button" className="btn btn-ghost" onClick={() => setStep(0)} disabled={step === 0 || busy}>{t("common.back")}</button>
        <button className={`btn px-6 ${step === 1 ? "btn-accent" : "btn-primary"}`} disabled={!valid || busy}>
          {busy && <Spinner />}
          {step === 1 ? t("auth.register.submit") : t("common.next")}
        </button>
      </div>
    </form>
  );
}

/* ── Sign in ───────────────────────────────────────────────────────── */

export function LoginForm({ google, oauthError }: { google: boolean; oauthError: boolean }) {
  const { t } = usePrefs();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(oauthError ? t("errors.oauth_failed") : null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/auth/login", { body: { email, password, remember } });
      window.location.assign("/app");
    } catch (err) {
      setError(errorText(t, err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold sm:text-3xl">{t("auth.login")}</h1>
        <p className="mt-2 text-muted">{t("auth.loginHint")}</p>
      </div>
      <FormError message={error} />
      <Field label={t("auth.email")}>
        <input className="input" type="email" dir="ltr" autoFocus autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label={t("auth.password")}>
        <input className="input" type="password" dir="ltr" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex min-h-11 cursor-pointer items-center gap-2.5">
          <input type="checkbox" className="size-5 accent-[var(--brand)]" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          <span>{t("auth.remember")}</span>
        </label>
        <Link href="/forgot-password" className="text-sm font-semibold text-brand hover:underline">{t("auth.forgotLink")}</Link>
      </div>
      {remember && <p className="text-sm text-muted">{t("auth.rememberHint")}</p>}
      <button className="btn btn-primary w-full" disabled={busy}>{busy && <Spinner />}{t("auth.login")}</button>
      {google && (
        <>
          <Divider label={t("auth.or")} />
          <GoogleButton remember={remember} label={t("auth.googleLogin")} />
        </>
      )}
      <p className="text-center text-sm text-muted">{t("auth.noAccount")} <Link href="/register" className="font-semibold text-brand hover:underline">{t("auth.registerLink")}</Link></p>
    </form>
  );
}

/* ── Forgotten password: email → code → new password ───────────────── */

export function ForgotPassword() {
  const { t } = usePrefs();
  const [step, setStep] = useState<"email" | "code" | "password" | "done">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [ticket, setTicket] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [left, setLeft] = useCountdown(0);
  const mismatch = confirm.length > 0 && confirm !== password;

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
  const requestCode = () =>
    run(async () => {
      const res = await api<{ resendIn?: number }>("/auth/forgot-password", { body: { email } });
      setLeft(res.resendIn ?? 60);
      setCode("");
      setStep("code");
    });
  const checkCode = (value = code) =>
    run(async () => {
      try {
        const res = await api<{ ticket: string }>("/auth/reset/verify-code", { body: { email, code: value } });
        setTicket(res.ticket);
        setStep("password");
      } catch (err) {
        setCode("");
        throw err;
      }
    });
  const save = () =>
    run(async () => {
      await api("/auth/reset/complete", { body: { ticket, password } });
      setStep("done");
    });

  if (step === "done") {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold sm:text-3xl">{t("auth.reset.doneTitle")}</h1>
        <p className="text-muted">{t("auth.reset.doneBody")}</p>
        <Link href="/login" className="btn btn-primary">{t("auth.login")}</Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold sm:text-3xl">{t(`auth.reset.${step}Title`)}</h1>
        <p className="mt-2 text-muted">{t(`auth.reset.${step}Hint`)}</p>
      </div>
      <FormError message={error} />
      {step === "email" && (
        <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); void requestCode(); }}>
          <Field label={t("auth.email")}>
            <input className="input" type="email" dir="ltr" autoFocus autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <button className="btn btn-primary w-full" disabled={busy}>{busy && <Spinner />}{t("auth.reset.send")}</button>
        </form>
      )}
      {step === "code" && (
        <div className="space-y-5">
          <CodeInput value={code} disabled={busy} onChange={(v) => { setCode(v); if (v.length === 6) void checkCode(v); }} />
          <button className="btn btn-primary w-full" disabled={code.length !== 6 || busy} onClick={() => checkCode()}>{busy && <Spinner />}{t("auth.verify.submit")}</button>
          <button type="button" className="text-sm font-semibold text-brand hover:underline disabled:text-muted disabled:no-underline" disabled={left > 0 || busy} onClick={requestCode}>
            {left > 0 ? t("auth.resendIn", { n: left }) : t("auth.resend")}
          </button>
        </div>
      )}
      {step === "password" && (
        <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); if (!mismatch && password.length >= 8) void save(); }}>
          <Field label={t("auth.newPassword")} hint={t("auth.passwordHint")}>
            <input className="input" type="password" dir="ltr" autoFocus autoComplete="new-password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Field label={t("auth.confirmPassword")}>
            <input className="input" type="password" dir="ltr" autoComplete="new-password" aria-invalid={mismatch} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>
          {mismatch && <p role="alert" className="text-sm font-medium text-danger">{t("auth.passwordMismatch")}</p>}
          <button className="btn btn-primary w-full" disabled={busy || password.length < 8 || confirm !== password}>{busy && <Spinner />}{t("auth.reset.save")}</button>
        </form>
      )}
      <p className="text-sm"><Link href="/login" className="font-semibold text-brand hover:underline">{t("auth.backToLogin")}</Link></p>
    </div>
  );
}
