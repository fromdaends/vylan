import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { Link, getPathname } from "@/i18n/navigation";
import { brand } from "@/lib/brand";

export default async function OnboardingLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const supabase = await getServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    redirect(getPathname({ locale, href: "/login" }));
  }

  const firm = await getCurrentFirm();
  if (firm?.onboarded_at) {
    redirect(getPathname({ locale, href: "/dashboard" }));
  }

  return (
    <div className="flex-1 flex flex-col">
      <header className="border-b border-border bg-card/50">
        <div className="mx-auto max-w-6xl px-6 py-4">
          <Link href="/" className="font-semibold tracking-tight text-lg">
            {brand.name}
          </Link>
        </div>
      </header>
      <main className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-xl">{children}</div>
      </main>
    </div>
  );
}
