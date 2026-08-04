"use client";

// Retire one engagement template.
//
// A client component rather than a <form action={...}>, because
// archiveEngagementTemplateAction takes an id — not FormData — and wrapping it
// in a second FormData-shaped action purely to get a form would be a second way
// to do the same thing.
//
// It ARCHIVES rather than deletes, which is why the label is "Remove" and not
// "Delete": the template may be the reason a past engagement looks the way it
// does, and the row stays so that history keeps making sense. Same reasoning as
// the service catalogue.

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { archiveEngagementTemplateAction } from "@/app/actions/engagement-templates";

export function ArchiveEngagementTemplate({
  id,
  name,
}: {
  id: string;
  name: string;
}) {
  const t = useTranslations("Templates");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // One click arms, the second confirms. A dialog for a reversible archive is
  // heavier than the action deserves; no confirmation at all is how a template
  // disappears by accident.
  const [armed, setArmed] = useState(false);
  const [failed, setFailed] = useState(false);

  function run() {
    if (!armed) {
      setArmed(true);
      return;
    }
    startTransition(async () => {
      const res = await archiveEngagementTemplateAction(id);
      if (!res.ok) {
        setFailed(true);
        setArmed(false);
        return;
      }
      // The action revalidates /templates; refresh pulls the new list in.
      router.refresh();
    });
  }

  return (
    <>
      {failed && (
        <span className="mr-auto text-xs text-destructive">
          {t("remove_failed")}
        </span>
      )}
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={run}
        onBlur={() => setArmed(false)}
        className="text-muted-foreground hover:text-destructive"
        // The name is only in the accessible label — the visible button stays
        // short, but a screen reader says which template is going.
        aria-label={
          armed ? t("remove_confirm_a11y", { name }) : t("remove_a11y", { name })
        }
      >
        {armed ? t("remove_confirm") : t("remove")}
      </Button>
    </>
  );
}
