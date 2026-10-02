import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { asLocale } from "@/lib/i18n";
import { THEMES, type Locale, type Theme } from "@/lib/constants";
import { readSession, SESSION_COOKIE } from "./auth";
import type { User } from "./db/schema";

export const LOCALE_COOKIE = "eduhub_locale";
export const THEME_COOKIE = "eduhub_theme";

/** The signed-in user for this request, or null. Cached per request. */
export const getCurrentUser = cache(async () => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return (await readSession(token))?.user ?? null;
});

/** Where an account belongs right now, given how far it has got. */
export const homeFor = (user: Pick<User, "status">) =>
  user.status === "pending_email" ? "/verify-email" : user.status === "pending_profile" ? "/complete-profile" : "/app";

/** Gate for the workspace: signed in, email confirmed, profile complete. */
export async function requireTeacher() {
  const user = await getCurrentUser();
  if (!user || user.status === "suspended") redirect("/login");
  if (user.status !== "active") redirect(homeFor(user));
  return user;
}

/** Language and theme: this device's cookie first, then the account's saved choice, then the browser. */
export const getPrefs = cache(async (): Promise<{ locale: Locale; theme: Theme }> => {
  const jar = await cookies();
  const user = await getCurrentUser();
  const cookieLocale = jar.get(LOCALE_COOKIE)?.value;
  const cookieTheme = jar.get(THEME_COOKIE)?.value;
  const browser = (await headers()).get("accept-language") ?? "";
  const locale = cookieLocale ? asLocale(cookieLocale) : user ? asLocale(user.locale) : /^\s*en\b/i.test(browser) ? "en" : "ar";
  const theme = (THEMES as readonly string[]).includes(cookieTheme ?? "") ? (cookieTheme as Theme) : ((user?.theme as Theme | undefined) ?? "system");
  return { locale, theme };
});
