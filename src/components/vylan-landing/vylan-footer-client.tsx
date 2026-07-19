"use client";

// The two interactive islands inside the (otherwise server-rendered) black
// footer. Kept deliberately tiny: the footer is on every public page, and a
// footer is the last place that should ship JavaScript to render a link list.

import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { useLocale } from "next-intl";

// Language switcher: swaps the locale prefix on the CURRENT page, so a reader
// halfway into a French help article lands on the same article in English,
// not back on the home page. usePathname (i18n flavour) returns the path
// without its locale prefix, which is exactly what Link + locale needs.
export function FooterLangSwitch({ label }: { label: string }) {
  const pathname = usePathname();
  const locale = useLocale();
  return (
    <nav className="vyf-lang" aria-label={label}>
      <Link href={pathname} locale="en" aria-current={locale === "en"}>
        English
      </Link>
      <span className="vyf-lang-sep" aria-hidden="true">
        ·
      </span>
      <Link href={pathname} locale="fr" aria-current={locale === "fr"}>
        Français
      </Link>
    </nav>
  );
}

// "Book a demo": every page that carries the lead form gives it the id
// vy-get-access. If the form is on the CURRENT page, scroll to it smoothly
// (JS smooth — the global CSS scroll-behavior rule is gone on purpose, see
// the commit that removed it: it made every route change animate). If it
// isn't (help center, privacy, terms), fall through to a normal client-side
// navigation to the landing page's form.
export function FooterDemoLink({ label }: { label: string }) {
  const router = useRouter();
  return (
    <Link
      href="/#vy-get-access"
      onClick={(e) => {
        const el = document.getElementById("vy-get-access");
        e.preventDefault();
        if (el) {
          el.scrollIntoView({ behavior: "smooth" });
        } else {
          router.push("/#vy-get-access");
        }
      }}
    >
      {label}
    </Link>
  );
}
