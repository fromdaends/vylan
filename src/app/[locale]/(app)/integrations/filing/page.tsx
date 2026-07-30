import { redirect } from "@/i18n/navigation";

// Document filing moved into the Vylan hub (/vylan?tab=filing): the providers
// are third-party connections, but the FEATURE is Vylan-native automation, so it
// belongs beside the other automated jobs rather than under Integrations.
//
// This route stays as a redirect rather than being deleted — the filing OAuth
// callbacks, older emails, and any bookmark a firm already has all point here.
export default async function FilingPageRedirect({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect({ href: "/vylan?tab=filing", locale });
}
