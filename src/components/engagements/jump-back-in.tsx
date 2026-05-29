"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { FileText } from "lucide-react";

// "Jump back in" card on the dashboard, styled after Microsoft Word/Excel:
// a heading, then a card with the last-updated date + engagement name + an
// "Open engagement" button. The whole card links to the engagement.
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
        className="group flex w-full max-w-md flex-col gap-5 rounded-xl border border-border/60 bg-card p-5 transition-colors hover:border-foreground/20"
      >
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
      </Link>
    </section>
  );
}
