import { getTranslations } from "next-intl/server";
import { Bell, FolderUp, Receipt, Repeat, Sparkles } from "lucide-react";
import { Link } from "@/i18n/navigation";

// "Automated jobs" — the scaffold for per-client custom automations (founder:
// build the structure now, expand later). Deliberately NOT an empty "coming
// soon" box: until the builder exists, this orients the accountant by naming
// what Vylan already automates and linking straight to each control, so the tab
// is useful on day one instead of a dead end.
export async function AutomatedJobsPanel() {
  const t = await getTranslations("VylanHub");

  const today: {
    icon: typeof Bell;
    title: string;
    body: string;
    href: string;
    cta: string;
  }[] = [
    {
      icon: Bell,
      title: t("today_reminders_title"),
      body: t("today_reminders_body"),
      href: "/settings?tab=automation",
      cta: t("today_open_settings"),
    },
    {
      icon: Receipt,
      title: t("today_invoices_title"),
      body: t("today_invoices_body"),
      href: "/settings?tab=automation",
      cta: t("today_open_settings"),
    },
    {
      icon: Repeat,
      title: t("today_repeat_title"),
      body: t("today_repeat_body"),
      href: "/engagements",
      cta: t("today_open_engagements"),
    },
    {
      icon: FolderUp,
      title: t("today_filing_title"),
      body: t("today_filing_body"),
      href: "/files?tab=settings",
      cta: t("today_open_filing"),
    },
  ];

  return (
    <>
      {/* What's coming. Honest about not being built yet — no fake controls. */}
      <section
        aria-labelledby="jobs-soon"
        className="rounded-xl border border-accent/30 bg-accent-subtle p-5"
      >
        <h2
          id="jobs-soon"
          className="flex items-center gap-2 text-sm font-semibold text-foreground"
        >
          <Sparkles className="size-4 shrink-0 text-accent" aria-hidden />
          {t("soon_title")}
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          {t("soon_body")}
        </p>
      </section>

      {/* What already works, with a direct link to each control. */}
      <section aria-labelledby="jobs-today" className="mt-10">
        <h2
          id="jobs-today"
          className="text-sm font-semibold uppercase tracking-wide text-muted-foreground"
        >
          {t("today_section")}
        </h2>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {today.map(({ icon: Icon, title, body, href, cta }) => (
            <li
              key={title}
              className="flex flex-col rounded-xl border border-border/60 bg-card p-4"
            >
              <div className="flex items-center gap-2.5">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-subtle text-accent">
                  <Icon className="size-4" aria-hidden />
                </span>
                <h3 className="text-sm font-medium text-foreground">{title}</h3>
              </div>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">
                {body}
              </p>
              <Link
                href={href}
                className="mt-3 text-sm font-medium text-accent hover:underline"
              >
                {cta}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
