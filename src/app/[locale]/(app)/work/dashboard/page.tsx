// The work dashboard / overview is GONE (founder: "remove the work overview
// page ... there's no need for it").
//
// This redirect stays and now lands on the task list. It has forwarded two
// different URLs in its life and both are sitting in bookmarks and old
// notification emails; a 404 is a worse answer than the firm's to-do list.
export const dynamic = "force-dynamic";

import { redirect } from "@/i18n/navigation";
import { assertLocale } from "@/lib/locale";

export default async function MovedWorkDashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  redirect({ href: "/work", locale: assertLocale(rawLocale) });
}
