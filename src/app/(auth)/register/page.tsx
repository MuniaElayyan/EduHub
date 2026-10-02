import { redirect } from "next/navigation";
import { RegisterWizard } from "@/components/auth-forms";
import { academicYears } from "@/lib/constants";
import { googleConfigured } from "@/server/config";
import { listSubjects } from "@/server/services/courses";
import { getCurrentUser, homeFor } from "@/server/session";

export default async function RegisterPage() {
  const user = await getCurrentUser();
  if (user) redirect(homeFor(user));
  return <RegisterWizard reference={{ subjects: await listSubjects(), academicYears: academicYears(), google: googleConfigured() }} />;
}
