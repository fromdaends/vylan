"use client";

// One task template, as a row.
//
// Same thin-client-wrapper shape as EngagementTemplateRow: how the row LOOKS is
// TemplateRow's business, shared with every other template type; this file only
// says what a task template's ⋮ menu does.
//
// Task templates used to render as their own bordered `<li>` with an inline
// expand form, which is why the founder said the Templates pages did not look
// like each other. They now render the same row as everything else.

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { ListChecks } from "lucide-react";
import { TemplateRow } from "@/components/templates/template-row";
import { archiveTaskTemplateAction } from "@/app/actions/task-templates";

export function TaskTemplateRow({
  id,
  name,
  meta,
}: {
  id: string;
  name: string;
  meta: string;
}) {
  const t = useTranslations("Templates");
  const router = useRouter();
  const [, startTransition] = useTransition();
  const href = `/templates/tasks/${id}`;

  return (
    <TemplateRow
      icon={ListChecks}
      name={name}
      meta={meta}
      // Clicking the row IS editing it — the founder's rule: viewing and
      // editing are the same thing. It opens the builder on its own route now,
      // the same way an engagement template's row does.
      href={href}
      // NO access badge — the Team / Private pills above the list already say
      // it, and repeating it per row said the same word once per template.
      // `isPrivate` still decides which pill this row lands behind.
      actions={[
        { label: t("edit"), onSelect: () => router.push(href) },
        {
          label: t("remove"),
          destructive: true,
          onSelect: () =>
            startTransition(async () => {
              const res = await archiveTaskTemplateAction(id);
              if (res.ok) router.refresh();
            }),
        },
      ]}
    />
  );
}
