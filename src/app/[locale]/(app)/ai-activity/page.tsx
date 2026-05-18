import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { assertLocale } from "@/lib/locale";
import { listAiActivityForFirm, type AiActivityEntry } from "@/lib/db/ai-activity";
import { formatRelative } from "@/lib/format";
import { ArrowLeft, ChevronRight, Sparkles } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AiActivityPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);

  const entries = await listAiActivityForFirm(200);

  const t = await getTranslations("AiActivity");
  const tActivity = await getTranslations("Activity");

  return (
    <div className="space-y-6">
      <Link
        href="/dashboard"
        className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
      >
        <ArrowLeft className="size-3.5" />
        {t("back")}
      </Link>

      <header className="flex flex-wrap items-end justify-between gap-4 animate-in-up">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-primary" />
            {t("title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1.5">
            {t("subtitle")}
          </p>
        </div>
      </header>

      <div className="rounded-xl border border-border bg-card animate-in-up">
        {entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
            <Sparkles className="h-6 w-6 opacity-50" aria-hidden />
            <p className="text-sm">{t("empty")}</p>
          </div>
        ) : (
          <ol className="divide-y divide-border/60">
            {entries.map((e) => (
              <AiActivityRow
                key={e.id}
                entry={e}
                locale={locale}
                tActivity={tActivity}
              />
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

function AiActivityRow({
  entry,
  locale,
  tActivity,
}: {
  entry: AiActivityEntry;
  locale: "fr" | "en";
  tActivity: Awaited<ReturnType<typeof getTranslations<"Activity">>>;
}) {
  const description = describeAiEntry(entry, tActivity);
  const href = entry.engagement_id
    ? `/engagements/${entry.engagement_id}`
    : null;

  const body = (
    <div className="flex items-start gap-3 py-3.5 px-5 group">
      <span
        className="mt-1.5 size-1.5 rounded-full shrink-0 bg-primary"
        aria-hidden
      />
      <div className="flex-1 min-w-0">
        <div className="text-sm leading-snug">{description}</div>
        <div className="text-xs text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
          {entry.engagement_title && (
            <span className="font-medium text-foreground/80 truncate max-w-[24rem]">
              {entry.engagement_title}
            </span>
          )}
          {entry.client_display_name && (
            <>
              <span aria-hidden>·</span>
              <span className="truncate max-w-[16rem]">
                {entry.client_display_name}
              </span>
            </>
          )}
          <span aria-hidden>·</span>
          <span>{formatRelative(entry.created_at, locale)}</span>
        </div>
      </div>
      {href && (
        <ChevronRight
          className="h-4 w-4 text-muted-foreground/50 group-hover:text-foreground transition-colors mt-2 shrink-0"
          aria-hidden
        />
      )}
    </div>
  );

  return (
    <li>
      {href ? (
        <Link
          href={href}
          className="block hover:bg-secondary/40 transition-colors"
        >
          {body}
        </Link>
      ) : (
        body
      )}
    </li>
  );
}

function describeAiEntry(
  entry: AiActivityEntry,
  t: Awaited<ReturnType<typeof getTranslations<"Activity">>>,
): string {
  const meta = entry.metadata as Record<string, string | number | undefined>;
  switch (entry.action) {
    case "ai_classified": {
      const conf =
        typeof meta.confidence === "number"
          ? `${Math.round(meta.confidence * 100)}%`
          : "—";
      return t("ai_classified", {
        document_type: String(meta.document_type ?? "?"),
        confidence: conf,
      });
    }
    case "ai_auto_rejected": {
      const conf = pct(meta.usability_confidence);
      const issue = String(meta.primary_issue ?? "");
      return t("ai_auto_rejected", { issue, confidence: conf });
    }
    case "ai_escalated_to_accountant": {
      const conf = pct(meta.usability_confidence);
      const issue = String(meta.primary_issue ?? "");
      return t("ai_escalated_to_accountant", { issue, confidence: conf });
    }
    case "ai_quality_flagged": {
      const conf = pct(meta.usability_confidence);
      const issue = String(meta.primary_issue ?? "");
      return t("ai_quality_flagged", { issue, confidence: conf });
    }
    case "ai_rejection_overridden":
      return t("ai_rejection_overridden");
    default:
      return entry.action;
  }
}

function pct(v: unknown): string {
  return typeof v === "number" ? `${Math.round(v * 100)}%` : "—";
}
