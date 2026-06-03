import { Link } from "@/i18n/navigation";
import { brand } from "@/lib/brand";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Logo } from "@/components/brand/logo";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex-1 flex flex-col relative overflow-hidden">
      {/* Ambient gradient backdrop */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top_right,oklch(0.62_0.18_264/.06),transparent_50%),radial-gradient(circle_at_bottom_left,oklch(0.62_0.18_264/.04),transparent_50%)] dark:bg-[radial-gradient(circle_at_top_right,oklch(0.7_0.16_264/.10),transparent_50%),radial-gradient(circle_at_bottom_left,oklch(0.7_0.16_264/.08),transparent_50%)]"
      />

      <header className="border-b border-border/60 backdrop-blur-md bg-background/50">
        <div className="mx-auto max-w-6xl flex items-center justify-between px-6 py-3.5">
          <Link
            href="/"
            className="flex items-center gap-2.5 font-semibold tracking-tight text-base group"
          >
            <Logo
              size={36}
              priority
              className="transition-transform duration-300 group-hover:scale-110 group-hover:rotate-3"
            />
            {brand.name}
          </Link>
          <ThemeToggle />
        </div>
      </header>

      {/* No `animate-in-up` here: its `transform` (kept by `both` fill-mode)
          would create a containing block that traps the blue login's
          fixed full-bleed layer at this max-w-sm width. */}
      <main className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}
