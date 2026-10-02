import { redirect } from "next/navigation";
import { CompleteProfile } from "@/components/auth-forms";
import { academicYears } from "@/lib/constants";
import { googleConfigured } from "@/server/config";
import { listSubjects } from "@/server/services/courses";
import { getCurrentUser, homeFor } from "@/server/session";

export default async function CompleteProfilePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.status !== "pending_profile") redirect(homeFor(user));
  return (
    <CompleteProfile
      reference={{ subjects: await listSubjects(), academicYears: academicYears(), google: googleConfigured() }}
      email={user.email}
      firstName={user.firstName ?? ""}
      lastName={user.lastName ?? ""}
    />
  );
}
