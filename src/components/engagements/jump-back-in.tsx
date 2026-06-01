"use client";

import { useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { FileText } from "lucide-react";
import { formatDate, type AppLocale } from "@/lib/format";
import { readRecentOpenId } from "@/lib/jump-back";

// localStorage doesn't change while the dashboard is open, so a no-op
// subscription is fine; getServerSnapshot returns null so SSR + hydration
// agree before the client reads the real value.
const noopSubscribe = () => () => {};

type Engagement = {
  id: string;
  title: string;
  clientName: string | null;
  recencyAt: string;
};

// "Jump back in" card on the dashboard, styled after Microsoft Word/Excel.
// Only shows when the user has opened an engagement recently (tracked per
// device in localStorage, expires after a week) — so it stays hidden for a
// fresh or long-idle account and returns once an engagement is opened again.
export function JumpBackIn({
  engagements,
  locale,
}: {
  engagements: Engagement[];
  locale: AppLocale;
}) {
  const t = useTranslations("Engagements");
  const openId = useSyncExternalStore(
    noopSubscribe,
    () => readRecentOpenId(),
    () => null,
  );

  const engagement = openId
    ? (engagements.find((e) => e.id === openId) ?? null)
    : null;
  if (!engagement) return null;

  const date = formatDate(engagement.recencyAt, locale, "medium");

  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold tracking-tight text-foreground">
        {t("jump_back_in")}
      </h2>

      <Link
        href={`/engagements/${engagement.id}`}
        className="group flex w-full max-w-md flex-col gap-4 rounded-xl border border-border/50 bg-card/50 p-5 shadow-[0_2px_12px_-4px_rgba(0,0,0,0.5)] transition-all hover:-translate-y-0.5 hover:border-border/70 hover:shadow-[0_10px_24px_-6px_rgba(0,0,0,0.6)] motion-reduce:transition-none"
      >
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">
            {t("last_updated", { date })}
          </p>
          <p className="mt-1 truncate text-base font-semibold text-foreground">
            {engagement.title}
          </p>
          {engagement.clientName ? (
            <p className="truncate text-sm text-muted-foreground">
              {engagement.clientName}
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
