import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { Link, getPathname } from "@/i18n/navigation";
import { brand } from "@/lib/brand";
import { Logo } from "@/components/brand/logo";

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
    <div className="flex-1 flex flex-col relative overflow-hidden">
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top_right,oklch(0.62_0.18_264/.06),transparent_50%),radial-gradient(circle_at_bottom_left,oklch(0.62_0.18_264/.04),transparent_50%)] dark:bg-[radial-gradient(circle_at_top_right,oklch(0.7_0.16_264/.10),transparent_50%),radial-gradient(circle_at_bottom_left,oklch(0.7_0.16_264/.08),transparent_50%)]"
      />
      <header className="border-b border-border/60 backdrop-blur-md bg-background/50">
        <div className="mx-auto max-w-6xl px-6 py-3.5">
          <Link
            href="/"
            className="flex items-center gap-2 font-semibold tracking-tight group"
          >
            <Logo
              size={24}
              priority
              className="transition-transform group-hover:scale-110 group-hover:rotate-3"
            />
            {brand.name}
          </Link>
        </div>
      </header>
      <main className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-xl animate-in-up">{children}</div>
      </main>
    </div>
  );
}
