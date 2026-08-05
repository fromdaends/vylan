import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { assertLocale } from "@/lib/locale";
import { listTaskTemplates } from "@/lib/db/task-templates";
import { getCurrentUser } from "@/lib/db/users";
import { can } from "@/lib/auth/capabilities";
import { ServiceBuilder } from "@/components/templates/service-builder";

/**
 * Create a service.
 *
 * Its OWN route now, like every other builder. It used to be a modal dialog on
 * the list page — a third chrome for the same act, which is what the founder
 * was looking at: "ALL THE UIS FOR BUILDING EVERYTHING TEMPLATES SHOULD ALL BE
 * THE SAME."
 */
export default async function NewServicePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);

  const [user, taskTemplates] = await Promise.all([
    getCurrentUser(),
    // So a service can name the work it implies (1620).
    listTaskTemplates(),
  ]);

  // Editing what the firm SELLS is a firm-settings decision, not something
  // anyone with an engagement can do. The server action enforces this too;
  // this stops the screen being reachable at all.
  if (user == null || !can(user, "firm.settings")) notFound();

  return (
    <ServiceBuilder
      locale={locale}
      taskTemplates={taskTemplates.map((tt) => ({
        id: tt.id,
        name: tt.name,
        // The steps travel WITH the name so the form can show what it just
        // attached rather than only what it is called.
        steps: tt.payload.subtasks.map((x) => x.title),
      }))}
    />
  );
}
