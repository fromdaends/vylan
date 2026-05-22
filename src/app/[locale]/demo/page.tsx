// Public 3-step demo qualifying form. The founder needs firm size,
// client volume, and current tool BEFORE the sales call so they can
// quote intelligently — so we ask up-front, save progressively, then
// hand off to cal.com (Phase 4) for the actual booking.

import { setRequestLocale } from "next-intl/server";
import { assertLocale } from "@/lib/locale";
import { PublicNav } from "@/components/public/public-nav";
import { PublicFooter } from "@/components/public/public-footer";
import { DemoFormFlow } from "./demo-form";

export default async function DemoPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);

  return (
    <>
      <PublicNav />
      <main className="relative isolate min-h-screen flex flex-col">
        <div className="mx-auto w-full max-w-xl px-5 sm:px-6 pt-28 sm:pt-32 pb-16 flex-1">
          <DemoFormFlow locale={locale === "fr" ? "fr" : "en"} />
        </div>
        <PublicFooter />
      </main>
    </>
  );
}
