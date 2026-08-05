"use client";

// A built-in template, readable without the editor's machinery.
//
// Lives here rather than inside a builder because BOTH the route (for a
// built-in, which nobody may edit) and any future surface that wants to show
// "what is in this template" need the same rendering. It used to be private to
// `template-detail-shell.tsx`, which is why that file outlived its own purpose.

import { useTranslations } from "next-intl";
import type { Template } from "@/lib/db/templates";
import type { WorkflowDefinition } from "@/lib/workflow/definition";

/** One automation the template's flow may have been copied FROM. */
export type PickerAutomation = {
  id: string;
  firmId: string | null;
  name: string;
  definition: WorkflowDefinition | null;
};

export function ReadOnlyItems({
  template,
  locale,
}: {
  template: Template;
  locale: "fr" | "en";
}) {
  const t = useTranslations("Templates");
  return (
    <ul className="overflow-hidden rounded-xl border border-border">
      {template.items.map((item, i) => (
        <li
          key={i}
          className="flex items-center gap-3 border-b border-border px-4 py-2.5 text-sm last:border-b-0"
        >
          {locale === "en" ? item.label_en : item.label_fr}
          {item.required && (
            <span className="ml-auto rounded-full bg-accent-subtle px-2 py-0.5 text-[11px] text-accent">
              {t("required_chip")}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
