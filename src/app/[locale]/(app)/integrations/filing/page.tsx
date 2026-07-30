import { redirect } from "@/i18n/navigation";

// Document filing now lives in the Files section (/files?tab=settings), beside
// the documents it files: a firm editing a folder template wants the browser one
// click away to see the result.
//
// This route has been a redirect since filing left Integrations, and it stays
// one — the storage OAuth callbacks, older emails, and any bookmark a firm
// already has all still point here. It now forwards STRAIGHT to the new home
// rather than hopping through /vylan?tab=filing, so there is one redirect
// instead of two.
export default async function FilingPageRedirect({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect({ href: "/files?tab=settings", locale });
}
