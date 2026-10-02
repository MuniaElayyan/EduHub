import type { Locale } from "./constants";

const tag = (l: Locale) => (l === "ar" ? "ar-u-nu-latn" : "en");

export function formatBytes(bytes: number, locale: Locale) {
  const units = locale === "ar" ? ["بايت", "ك.ب", "م.ب", "ج.ب"] : ["B", "KB", "MB", "GB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n >= 10 || i === 0 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
}

export function formatDate(iso: string, locale: Locale) {
  return new Intl.DateTimeFormat(tag(locale), { year: "numeric", month: "short", day: "numeric" }).format(new Date(iso));
}

export function timeAgo(iso: string, locale: Locale) {
  const rtf = new Intl.RelativeTimeFormat(tag(locale), { numeric: "auto" });
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const steps: [number, Intl.RelativeTimeFormatUnit][] = [[60, "second"], [60, "minute"], [24, "hour"], [30, "day"], [12, "month"], [Infinity, "year"]];
  let v = diff;
  for (const [size, unit] of steps) {
    if (Math.abs(v) < size) return rtf.format(Math.round(v), unit);
    v /= size;
  }
  return "";
}

export function countryName(code: string, locale: Locale) {
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** "Chrome, Windows" from a user-agent string, for the list of signed-in devices. */
export function deviceLabel(ua: string | null) {
  if (!ua) return "?";
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser}, ${os}` : browser;
}
