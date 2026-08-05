"use client";

// One engagement template, as a row.
//
// A thin client wrapper around the shared TemplateRow: the ⋮ menu's items are
// callbacks, and archiving is a server action called from a transition, so the
// row that carries them has to be a client component. Everything about how the
// row LOOKS lives in TemplateRow, shared with every other template type — this
// file only says what an engagement template's menu does.

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { resolveTemplateIcon } from "@/components/templates/template-card";
import { TemplateRow } from "@/components/templates/template-row";
import { archiveEngagementTemplateAction } from "@/app/actions/engagement-templates";

export function EngagementTemplateRow({
  id,
  name,
  type,
  meta,
  isDraft,
  isPrivate,
}: {
  id: string;
  name: string;
  type: string;
  meta: string;
  isDraft: boolean;
  isPrivate: boolean;
}) {
  const t = useTranslations("Templates");
  const router = useRouter();
  const [, startTransition] = useTransition();

  const href = `/templates/engagements/${id}`;

  return (
    <TemplateRow
      icon={resolveTemplateIcon(name, type)}
      name={name}
      meta={meta}
      href={href}
      badges={
        <>
          {/* A DRAFT is called out first: reaching for a half-written template
              is the mistake this badge exists to prevent. */}
          {isDraft && (
            <span className="shrink-0 rounded-full bg-destructive/15 px-2 py-0.5 text-[10px] font-medium tracking-wide uppercase text-destructive">
              {t("draft_badge")}
            </span>
          )}
          {isPrivate && (
            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium tracking-wide uppercase text-muted-foreground">
              {t("access_private")}
            </span>
          )}
        </>
      }
      actions={[
        { label: t("edit"), onSelect: () => router.push(href) },
        {
          label: t("use_in_new"),
          onSelect: () =>
            router.push(`/engagements/new?engagement_template=${id}`),
        },
        {
          label: t("remove"),
          destructive: true,
          onSelect: () =>
            startTransition(async () => {
              // Archive, not delete — the template may be the reason a past
              // engagement looks the way it does.
              const res = await archiveEngagementTemplateAction(id);
              if (res.ok) router.refresh();
            }),
        },
      ]}
    />
  );
}
