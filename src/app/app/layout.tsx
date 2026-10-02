import { WorkspaceShell } from "@/components/workspace";
import { publicUser } from "@/server/auth";
import { listCourses, listSubjects } from "@/server/services/courses";
import { storageUsed } from "@/server/services/resources";
import { requireTeacher } from "@/server/session";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireTeacher();
  const [courses, subjects, used] = await Promise.all([listCourses(user.id), listSubjects(), storageUsed(user.id)]);
  return (
    <WorkspaceShell user={publicUser(user)} courses={courses} subjects={subjects} storage={{ used, quota: user.storageQuotaBytes }}>
      {children}
    </WorkspaceShell>
  );
}
