import ar from "@messages/ar.json";
import en from "@messages/en.json";
import type { Locale } from "./constants";

export const dictionaries = { ar, en } as const;
export type Messages = typeof ar;
export type T = (key: string, vars?: Record<string, string | number>) => string;

export const dirOf = (locale: Locale) => (locale === "ar" ? "rtl" : "ltr");
export const asLocale = (v: string | undefined | null): Locale => (v === "en" ? "en" : "ar");

/** Looks up "a.b.c" in the dictionary and fills {placeholders}. Falls back to the key itself. */
export function createT(locale: Locale): T {
  const dict = dictionaries[locale] as unknown as Record<string, unknown>;
  return (key, vars) => {
    let node: unknown = dict;
    for (const part of key.split(".")) node = (node as Record<string, unknown> | undefined)?.[part];
    if (typeof node !== "string") return key;
    return vars ? node.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? "")) : node;
  };
}

type Named = { nameAr?: string | null; nameEn?: string | null };

/** Labels for the workspace levels. Subjects and default sections are named in the database, in both languages. */
export const subjectLabel = (locale: Locale, s: { subjectAr: string; subjectEn: string }) => (locale === "ar" ? s.subjectAr : s.subjectEn);
export const subjectName = (locale: Locale, s: Named) => (locale === "ar" ? s.nameAr : s.nameEn) ?? "";
export const gradeLabel = (t: T, grade: number) => t(`grades.${grade}`);
export const semesterLabel = (t: T, s: { position: number; name: string | null }) =>
  s.name || (s.position <= 2 ? t(`semesters.${s.position}`) : t("semesters.n", { n: s.position }));
export const unitLabel = (t: T, u: { number: number; title: string | null }) => u.title || t("units.label", { n: u.number });
export const sectionLabel = (locale: Locale, s: { name: string | null; typeNameAr: string | null; typeNameEn: string | null }) =>
  s.name || (locale === "ar" ? s.typeNameAr : s.typeNameEn) || "";

/** Picks the grammatical form for a count ("3 صفوف", "48 موردًا"). Arabic has six forms, English two. */
export function plural(t: T, locale: Locale, key: string, n: number) {
  const form = n === 0 ? "zero" : new Intl.PluralRules(locale).select(n);
  return t(`${key}.${form}`, { n });
}

/** "English: Grade 6": the full name of a class wherever subject and grade must both be clear. */
export const courseTitle = (t: T, locale: Locale, c: { grade: number; subjectAr: string; subjectEn: string }) =>
  `${subjectLabel(locale, c)}: ${gradeLabel(t, c.grade)}`;
