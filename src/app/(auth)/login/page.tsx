import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth-forms";
import { googleConfigured } from "@/server/config";
import { getCurrentUser, homeFor } from "@/server/session";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await getCurrentUser();
  if (user && user.status !== "suspended") redirect(homeFor(user));
  return <LoginForm google={googleConfigured()} oauthError={(await searchParams).error === "oauth"} />;
}
