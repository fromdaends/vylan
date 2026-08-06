// THE DETAILS BOX (design 2a) — the engagement's facts, right rail, replacing
// the wide details card. A pure presenter: the page resolves every value.
//
// Rows the design carries that Vylan has no fact for (a year-end field) are
// ABSENT rather than invented — a box that prints a guessed date is worse
// than a shorter box. Rows render only when their fact exists, except Client
// and Service, which always render (an em dash is an honest "none yet").

import { getTranslations } from "next-intl/server";
import { Repeat, Link2 } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { formatDate, type AppLocale } from "@/lib/format";
import {
  RailBox,
  RailRow,
  RailDivider,
} from "@/components/engagements/engagement-rail-box";

export async function EngagementDetailsBox({
  locale,
  client,
  relationshipLine,
  services,
  sentAt,
  acceptedAt,
  dueDate,
  repeatLabel,
  style,
}: {
  locale: AppLocale;
  client: { id: string; name: string } | null;
  /** "Owned by X · 100%" / "2 linked clients" — points at the profile card. */
  relationshipLine: string | null;
  services: string[];
  sentAt: string | null;
  acceptedAt: string | null;
  dueDate: string | null;
  /** "Yearly" / "Monthly" / … when the job repeats, else null. */
  repeatLabel: string | null;
  style?: React.CSSProperties;
}) {
  const t = await getTranslations("Engagements");
  const value = "text-[13px] font-medium text-right";

  return (
    <RailBox
      title={t("box_details")}
      className="animate-card-in"
      style={style}
    >
      <div className="mt-3 flex flex-col gap-[9px] text-[13px]">
        <RailRow label={t("box_details_client")}>
          {client ? (
            <Link
              href={`/clients/${client.id}`}
              className="truncate text-[13px] font-medium text-accent transition-colors hover:text-accent-hover"
            >
              {client.name}
            </Link>
          ) : (
            <span className={value}>—</span>
          )}
        </RailRow>
        {relationshipLine && client && (
          <Link
            href={`/clients/${client.id}#relationships`}
            className="-mt-1 inline-flex items-center gap-1 self-end text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <Link2 className="size-3" aria-hidden />
            {relationshipLine}
          </Link>
        )}
        <RailRow label={t("box_details_service")}>
          <span className={value}>
            {services.length > 0 ? services.join(", ") : "—"}
          </span>
        </RailRow>
        {(sentAt || acceptedAt || dueDate) && <RailDivider />}
        {sentAt && (
          <RailRow label={t("box_details_sent")}>
            <span className={`${value} tabular-nums`}>
              {formatDate(sentAt, locale, "medium")}
            </span>
          </RailRow>
        )}
        {acceptedAt && (
          <RailRow label={t("box_details_accepted")}>
            <span className={`${value} tabular-nums`}>
              {formatDate(acceptedAt, locale, "medium")}
            </span>
          </RailRow>
        )}
        {dueDate && (
          <RailRow label={t("box_details_due")}>
            <span className="text-right text-[13px] font-semibold tabular-nums text-accent">
              {formatDate(dueDate, locale, "medium")}
            </span>
          </RailRow>
        )}
        {repeatLabel && (
          <RailRow label={t("repeat_frequency_label")} align="center">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-xs font-medium">
              <Repeat className="size-[11px]" aria-hidden />
              {repeatLabel}
            </span>
          </RailRow>
        )}
      </div>
    </RailBox>
  );
}
