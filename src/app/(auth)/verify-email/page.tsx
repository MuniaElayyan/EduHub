import { redirect } from "next/navigation";
import { VerifyEmail } from "@/components/auth-forms";
import { getCurrentUser, homeFor } from "@/server/session";

/** a***@example.com: enough to recognise the address, not enough to read it over a shoulder. */
const mask = (email: string) => email.replace(/^(.)[^@]*/, "$1***");

export default async function VerifyEmailPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.status !== "pending_email") redirect(homeFor(user));
  return <VerifyEmail maskedEmail={mask(user.email)} />;
}
