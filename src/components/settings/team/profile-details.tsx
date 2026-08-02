"use client";

// Job title and hours a week, edited in place in the profile's About panel.
//
// DELIBERATELY NOT A FORM WITH A SAVE BUTTON PARKED UNDER IT. The founder's
// standing objection is controls that sit on a screen doing nothing. These read
// as two ordinary label/value rows until you click one; the Save appears only
// once something has actually changed, and disappears again when it is saved.
//
// Read-only for anyone who cannot manage the roster — they still see the values,
// because knowing a colleague is part-time is the point of recording it.

import { useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { saveTeammateProfileAction } from "@/app/actions/team-profile";

export function ProfileDetails({
  userId,
  jobTitle,
  weeklyHours,
  canEdit,
}: {
  userId: string;
  jobTitle: string | null;
  weeklyHours: number | null;
  canEdit: boolean;
}) {
  const t = useTranslations("Team");
  const router = useRouter();
  const [, startTransition] = useTransition();

  const initialTitle = jobTitle ?? "";
  const initialHours = weeklyHours == null ? "" : String(weeklyHours);
  const [title, setTitle] = useState(initialTitle);
  const [hours, setHours] = useState(initialHours);
  const [saving, setSaving] = useState(false);

  const dirty = title !== initialTitle || hours !== initialHours;

  async function save() {
    setSaving(true);
    try {
      const result = await saveTeammateProfileAction({
        userId,
        jobTitle: title,
        weeklyHours: hours,
      });
      if (result.ok) {
        toast.success(t("profile_details_saved"));
        startTransition(() => router.refresh());
        return;
      }
      if (result.needsMigration) {
        toast.error(t("profile_details_needs_migration"));
        return;
      }
      toast.error(
        result.error === "bad_hours"
          ? t("profile_details_bad_hours")
          : t("profile_details_failed"),
      );
    } finally {
      setSaving(false);
    }
  }

  if (!canEdit) {
    return (
      <>
        <Row label={t("profile_job_title")} value={jobTitle ?? t("profile_not_recorded")} />
        <Row
          label={t("profile_weekly_hours")}
          value={
            weeklyHours == null
              ? t("profile_not_recorded")
              : t("profile_hours_value", { hours: weeklyHours })
          }
        />
      </>
    );
  }

  return (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <dt className="shrink-0 text-muted-foreground">{t("profile_job_title")}</dt>
        <dd className="min-w-0 flex-1 text-right">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("profile_not_recorded")}
            maxLength={120}
            aria-label={t("profile_job_title")}
            className="w-full rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-right text-foreground placeholder:text-muted-foreground hover:border-border focus-visible:border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </dd>
      </div>
      <div className="flex items-baseline justify-between gap-3">
        <dt className="shrink-0 text-muted-foreground">
          {t("profile_weekly_hours")}
        </dt>
        <dd className="min-w-0 flex-1 text-right">
          <input
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            placeholder={t("profile_not_recorded")}
            inputMode="decimal"
            aria-label={t("profile_weekly_hours")}
            className="w-full rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-right tabular-nums text-foreground placeholder:text-muted-foreground hover:border-border focus-visible:border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </dd>
      </div>
      {dirty && (
        <div className="flex justify-end pt-1">
          <Button size="sm" variant="secondary" onClick={save} disabled={saving}>
            {t("profile_details_save")}
          </Button>
        </div>
      )}
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1 truncate text-right">{value}</dd>
    </div>
  );
}
