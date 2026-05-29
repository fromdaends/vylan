"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { FileText } from "lucide-react";

// "Jump back in" card on the dashboard, styled after Microsoft Word/Excel:
// a heading, then a card with the last-updated date + engagement name + an
// "Open" button on the left, and a stacked document-preview thumbnail on the
// right. The whole card links to the engagement.
export function JumpBackIn({
  engagementId,
  title,
  clientName,
  date,
}: {
  engagementId: string;
  title: string;
  clientName: string | null;
  date: string;
}) {
  const t = useTranslations("Engagements");

  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold tracking-tight text-foreground">
        {t("jump_back_in")}
      </h2>

      <Link
        href={`/engagements/${engagementId}`}
        className="group flex w-full max-w-2xl items-stretch overflow-hidden rounded-xl border border-border/60 bg-card transition-colors hover:border-foreground/20"
      >
        {/* Left: metadata + name + open affordance */}
        <div className="flex flex-1 flex-col justify-between gap-5 p-5">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">
              {t("last_updated", { date })}
            </p>
            <p className="mt-1 truncate text-base font-semibold text-foreground">
              {title}
            </p>
            {clientName ? (
              <p className="truncate text-sm text-muted-foreground">
                {clientName}
              </p>
            ) : null}
          </div>
          <span className="inline-flex w-fit items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground transition-colors group-hover:border-foreground/30 group-hover:bg-secondary/40">
            <FileText className="size-4 text-primary" aria-hidden />
            {t("open_engagement")}
          </span>
        </div>

        {/* Right: stacked document-preview thumbnail (decorative). The pane
            clips the offset card behind so it reads as a peeking stack. */}
        <div
          className="relative hidden w-44 shrink-0 items-center justify-center overflow-hidden border-l border-border/60 bg-muted/20 sm:flex"
          aria-hidden
        >
          <div className="absolute h-24 w-32 translate-x-3 translate-y-3 rounded-md border border-border/50 bg-muted/40" />
          <div className="relative h-24 w-32 overflow-hidden rounded-md border border-border/60 bg-background p-2.5 shadow-sm">
            <div className="h-1.5 w-2/3 rounded-full bg-foreground/15" />
            <div className="mt-2.5 space-y-1.5">
              {["80%", "65%", "72%", "50%"].map((w, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <div className="size-1.5 shrink-0 rounded-full bg-foreground/15" />
                  <div
                    className="h-1.5 rounded-full bg-foreground/10"
                    style={{ width: w }}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </Link>
    </section>
  );
}
