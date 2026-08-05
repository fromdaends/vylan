"use client";

// One client-request template, as a row.
//
// The founder: "client request templates are not consistent with how the
// engagement template and the task templates work. And there's no ability to
// edit them... make the client request templates look like how the task and
// engagement templates look."
//
// Both halves were true. They still rendered as CARDS while everything else had
// become rows, and their only actions were Clone and Use — the firm's own were
// editable through a link, the built-ins not at all, and neither had the ⋮ menu
// every other template type had grown.
//
// Same thin-client-wrapper shape as the other two: TemplateRow owns how it
// looks, this file only says what this type's menu does.

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { resolveTemplateIcon } from "@/components/templates/template-card";
import { TemplateRow } from "@/components/templates/template-row";
import {
  cloneTemplateAction,
  deleteTemplateAction,
} from "@/app/actions/templates";

export function RequestTemplateRow({
  id,
  name,
  type,
  meta,
  builtin,
  locale,
}: {
  id: string;
  name: string;
  type: string;
  meta: string;
  /** Ships with Vylan: clone it to change it, never edit in place. */
  builtin: boolean;
  locale: string;
}) {
  const t = useTranslations("Templates");
  const router = useRouter();
  const [, startTransition] = useTransition();

  // The firm's own open their editor. A built-in opens the same route, which
  // renders it READ-ONLY with a Clone button — so clicking a built-in still
  // shows you what is in it rather than doing nothing, which is what the
  // founder means by viewing and editing being the same thing.
  const href = `/templates/${id}`;

  function clone() {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("id", id);
      await cloneTemplateAction(fd);
      router.refresh();
    });
  }

  return (
    <TemplateRow
      icon={resolveTemplateIcon(name, type)}
      name={name}
      meta={meta}
      href={href}
      badges={
        builtin ? (
          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium tracking-wide uppercase text-muted-foreground">
            {t("builtin_badge")}
          </span>
        ) : null
      }
      actions={[
        // A built-in cannot be edited, so its first action is the one that
        // makes an editable copy. Offering "Edit" on something read-only would
        // be a menu item that opens a page and then refuses.
        builtin
          ? { label: t("clone"), onSelect: clone }
          : { label: t("edit"), onSelect: () => router.push(href) },
        {
          label: t("use_in_new"),
          onSelect: () => router.push(`/engagements/new?template=${id}`),
        },
        ...(builtin
          ? []
          : [
              { label: t("clone"), onSelect: clone },
              {
                label: t("delete"),
                destructive: true,
                onSelect: () =>
                  startTransition(async () => {
                    const fd = new FormData();
                    fd.set("id", id);
                    fd.set("__app_locale", locale);
                    await deleteTemplateAction(fd);
                    router.refresh();
                  }),
              },
            ]),
      ]}
    />
  );
}
