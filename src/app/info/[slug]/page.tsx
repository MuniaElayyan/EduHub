import Link from "next/link";
import { notFound } from "next/navigation";
import { Logo } from "@/components/ui";
import { createT } from "@/lib/i18n";
import { CONTACT_EMAIL } from "@/lib/site";
import { getPrefs } from "@/server/session";

const SLUGS = ["about", "contact", "help", "privacy", "terms"];

export default async function InfoPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!SLUGS.includes(slug)) notFound();
  const t = createT((await getPrefs()).locale);
  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <Link href="/" aria-label="EduHub"><Logo /></Link>
      <main className="mt-10">
        <h1 className="text-3xl font-bold">{t(`info.${slug}.title`)}</h1>
        <p className="mt-4 whitespace-pre-line text-lg text-muted">{t(`info.${slug}.body`)}</p>
        {slug === "contact" && CONTACT_EMAIL && (
          <p className="mt-4"><a className="font-semibold text-brand underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a></p>
        )}
        <Link href="/" className="btn btn-outline mt-8">{t("common.back")}</Link>
      </main>
    </div>
  );
}
