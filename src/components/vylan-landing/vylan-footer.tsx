// Shared footer for the public "vylan" pages (landing, manifesto, contact) so
// they can never drift. The top row mirrors the old per-page footers (brand /
// nav links / copyright). The faint line underneath carries phone / email /
// location — deliberately low-key ("there if you really look") now that
// Contact lives on its own page instead of as a landing section.
//
// The "for firms" / "book a demo" links scroll to the lead form (id
// "vy-get-access"), which every page that renders this footer also renders.

import { Link } from "@/i18n/navigation";
import { brand } from "@/lib/brand";

// The two business lines. E.164 in the tel: href, human-friendly in the label.
// Also rendered (larger) on the /contact page.
export const VYLAN_PHONES = [
  { tel: "+14508306455", label: "450-830-6455" },
  { tel: "+14383415160", label: "438-341-5160" },
] as const;

export type VylanFooterStrings = {
  brand: string;
  howItWorks: string;
  forFirms: string;
  bookDemo: string;
  contact: string;
  login: string;
  copyright: string;
  location: string;
};

export function VylanFooter({ s }: { s: VylanFooterStrings }) {
  return (
    <footer className="vy-footer">
      <div className="vy-fbrand">{s.brand}</div>
      <div className="vy-links">
        <Link href="/how-it-works">{s.howItWorks}</Link>
        <a href="#vy-get-access">{s.forFirms}</a>
        <a href="#vy-get-access">{s.bookDemo}</a>
        <Link href="/contact">{s.contact}</Link>
        <Link href="/login">{s.login}</Link>
      </div>
      <div className="vy-cr">{s.copyright}</div>

      {/* Subtle always-there contact details. */}
      <div className="vy-fcontact">
        {VYLAN_PHONES.map((p) => (
          <a key={p.tel} href={`tel:${p.tel}`}>
            {p.label}
          </a>
        ))}
        <a href={`mailto:${brand.supportEmail}`}>{brand.supportEmail}</a>
        <span>{s.location}</span>
      </div>
    </footer>
  );
}
