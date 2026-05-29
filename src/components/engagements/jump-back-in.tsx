"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { History, ArrowRight } from "lucide-react";

// "Jump back in" strip on the dashboard, under the greeting — a quick hop to
// the firm's most recent active engagement (Word-style). The label is a quiet
// lead-in; the engagement name carries the weight, with the client muted.
export function JumpBackIn({
  engagementId,
  title,
  clientName,
}: {
  engagementId: string;
  title: string;
  clientName: string | null;
}) {
  const t = useTranslations("Engagements");

  return (
    <Link
      href={`/engagements/${engagementId}`}
      className="group flex items-center gap-3.5 rounded-xl border border-border/60 bg-card px-4 py-3.5 transition-colors hover:border-foreground/20 hover:bg-secondary/30"
    >
      <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors group-hover:text-foreground">
        <History className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">{t("jump_back_in")}</p>
        <p className="mt-0.5 truncate text-sm">
          <span className="font-semibold text-foreground">{title}</span>
          {clientName ? (
            <span className="text-muted-foreground"> · {clientName}</span>
          ) : null}
        </p>
      </div>
      <ArrowRight
        className="size-4 shrink-0 text-muted-foreground/40 transition-all group-hover:translate-x-0.5 group-hover:text-foreground"
        aria-hidden
      />
    </Link>
  );
}
