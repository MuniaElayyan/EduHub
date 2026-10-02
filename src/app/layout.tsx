import "@fontsource-variable/readex-pro";
import "@fontsource/ibm-plex-sans-arabic/400.css";
import "@fontsource/ibm-plex-sans-arabic/500.css";
import "@fontsource/ibm-plex-sans-arabic/600.css";
import "@fontsource/ibm-plex-sans-arabic/700.css";
import "./globals.css";
import type { Metadata, Viewport } from "next";
import { Providers } from "@/components/providers";
import { createT, dirOf } from "@/lib/i18n";
import { getCurrentUser, getPrefs } from "@/server/session";

export async function generateMetadata(): Promise<Metadata> {
  const { locale } = await getPrefs();
  const t = createT(locale);
  return {
    title: { default: `EduHub | ${t("landing.metaTitle")}`, template: "%s | EduHub" },
    description: t("landing.metaDescription"),
    manifest: "/manifest.webmanifest",
    icons: { icon: "/icon.svg", apple: "/icon.svg" },
    appleWebApp: { capable: true, title: "EduHub" },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2f5f3" },
    { media: "(prefers-color-scheme: dark)", color: "#0d1614" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [{ locale, theme }, user] = await Promise.all([getPrefs(), getCurrentUser()]);
  return (
    <html lang={locale} dir={dirOf(locale)} data-theme={theme === "system" ? undefined : theme} suppressHydrationWarning>
      <body>
        <Providers locale={locale} theme={theme} signedIn={!!user}>
          {children}
        </Providers>
      </body>
    </html>
  );
}
