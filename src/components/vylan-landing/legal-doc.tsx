// Shared shell for the legal pages (privacy, terms). Uses the SAME chrome as
// the help center — the shared VylanMenu, a compact blue header, a white
// reading sheet, and the black footer — so /privacy and /terms match the rest
// of the site instead of the old floating "pill" nav they used to carry.
//
// Content comes in as plain (heading, body) sections. A body marked `list`
// is split on newlines into bullets; everything else is a paragraph. The help
// center's .vyh-prose styling does the visual work, so this stays tiny.

import { getTranslations } from "next-intl/server";
import { getPathname } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { schibsted } from "./fonts";
import { VylanMenu } from "./vylan-menu";
import { VylanFooter } from "./vylan-footer";
import "@/styles/vylan-landing.css";
import "@/styles/vylan-help.css";

export type LegalSection = { h: string; body: string; list?: boolean };

export async function LegalDoc({
  locale,
  title,
  updated,
  sections,
}: {
  locale: AppLocale;
  title: string;
  updated: string;
  sections: LegalSection[];
}) {
  const tv = await getTranslations("Vylan");

  const menu = {
    brand: tv("brand_word"),
    logoAlt: tv("logo_alt"),
    menuLabel: tv("menu_label"),
    closeLabel: tv("menu_close"),
    defTerm: tv("menu_def_term"),
    defAbbr: tv("menu_def_abbr"),
    defText: tv("menu_def_text"),
    navHome: tv("nav_home"),
    navHowItWorks: tv("nav_how_it_works"),
    navBookDemo: tv("nav_book_demo"),
    navLogin: tv("nav_login"),
    navContact: tv("nav_contact"),
    navHelp: tv("nav_help"),
    follow: tv("follow"),
  };

  // These pages don't render the lead form, so "Book a demo" resolves to the
  // landing form and "Help" opens /help in a new tab — same as the help center.
  const bookDemoHref = `${getPathname({ locale, href: "/" })}#vy-get-access`;
  const helpHref = getPathname({ locale, href: "/help" });

  return (
    <div className={`vy-root vy-help ${schibsted.variable}`}>
      <VylanMenu s={menu} bookDemoHref={bookDemoHref} helpHref={helpHref} />

      <header className="vyh-hero vyh-hero-compact">
        <h1 className="vyh-title">{title}</h1>
        <p className="vyh-sub">{updated}</p>
      </header>

      <main className="vyh-sheet">
        <article className="vyh-wrap-narrow">
          <div className="vyh-prose">
            {sections.map((s) => (
              <section key={s.h}>
                <h2>{s.h}</h2>
                {s.list ? (
                  <ul>
                    {s.body.split("\n").map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                ) : (
                  <p>{s.body}</p>
                )}
              </section>
            ))}
          </div>
        </article>
      </main>

      <VylanFooter />
    </div>
  );
}
