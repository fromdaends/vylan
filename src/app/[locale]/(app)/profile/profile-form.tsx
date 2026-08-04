"use client";

import { useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Check } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AvatarPicker } from "@/components/ui/avatar-picker";
import {
  updateAvatarAction,
  removeAvatarAction,
  updateDisplayNameAction,
  updateWorkDetailsAction,
  type ProfileActionResult,
} from "@/app/actions/profile";

type ProfileUser = {
  id: string;
  email: string;
  name: string;
  display_name: string | null;
  job_title?: string | null;
  weekly_hours?: number | null;
};

// /profile keeps the personal basics: photo, display name, and what you do
// here. Email, Password, and Two-factor live in Settings → Security; the
// subscription summary lives in Settings → Billing.
//
// NOTHING OWNER-CONTROLLED BELONGS ON THIS PAGE. Your permissions, your rank
// and whether you are still active are the firm's to set and stay on the
// teammate page where the owner sets them. What is here is what is yours: how
// you appear, and what you do.
export function ProfileForm({
  user,
  displayLabel,
  brandColor,
  avatarUrl,
}: {
  user: ProfileUser;
  displayLabel: string;
  brandColor: string;
  avatarUrl: string | null;
}) {
  const t = useTranslations("Profile");
  const tc = useTranslations("Common");

  return (
    <div className="space-y-12">
      <AvatarSection
        avatarUrl={avatarUrl}
        displayLabel={displayLabel}
        firmBrandColor={brandColor}
        t={t}
        tc={tc}
      />
      <DisplayNameSection
        current={user.display_name ?? ""}
        placeholder={user.name}
        t={t}
        tc={tc}
      />
      <WorkDetailsSection
        jobTitle={user.job_title ?? ""}
        weeklyHours={user.weekly_hours == null ? "" : String(user.weekly_hours)}
        t={t}
        tc={tc}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Avatar
// ─────────────────────────────────────────────────────────────────────────────

function AvatarSection({
  avatarUrl,
  displayLabel,
  firmBrandColor,
  t,
  tc,
}: {
  avatarUrl: string | null;
  displayLabel: string;
  firmBrandColor: string;
  t: (k: string) => string;
  tc: (k: string) => string;
}) {
  // The picker itself now lives in components/ui/avatar-picker, shared with the
  // CLIENT edit form. This section keeps the heading, the hint and the wiring to
  // THIS page's actions — the parts that are genuinely about your own profile.
  return (
    <section>
      <h2 className="text-sm font-semibold">{t("section_picture")}</h2>
      <p className="text-xs text-muted-foreground mt-1">
        {t("section_picture_hint")}
      </p>
      <AvatarPicker
        className="mt-4"
        currentUrl={avatarUrl}
        name={displayLabel}
        size={64}
        color={firmBrandColor}
        onUpload={async (fd) => {
          const res = (await updateAvatarAction(fd)) as ProfileActionResult;
          return { ok: res.ok, signedUrl: res.ok ? res.signedUrl : null };
        }}
        onRemove={async () => {
          const res = await removeAvatarAction();
          return { ok: res.ok };
        }}
        labels={{
          change: t("change_picture"),
          uploading: t("uploading"),
          remove: t("remove_picture"),
          error: (code) => t(`errors.${code}`) || tc("loading"),
        }}
      />
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Display name
// ─────────────────────────────────────────────────────────────────────────────

function DisplayNameSection({
  current,
  placeholder,
  t,
  tc,
}: {
  current: string;
  placeholder: string;
  t: (k: string) => string;
  tc: (k: string) => string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(current);
  // The last SAVED value — the Save button lights up only while the field
  // differs from it, and it advances on a successful save.
  const [baseline, setBaseline] = useState(current);
  const [justSaved, setJustSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = value.trim() !== baseline.trim();

  function save() {
    setError(null);
    if (!dirty || pending) return;
    const next = value.trim();
    const fd = new FormData();
    fd.append("display_name", next);
    startTransition(async () => {
      const res = await updateDisplayNameAction(fd);
      if (!res.ok) {
        setError(t(`errors.${res.error}`) || tc("loading"));
        return;
      }
      setValue(next);
      setBaseline(next);
      setJustSaved(true);
      toast.success(t("name_saved"));
      // Push the new name to every surface that shows it (sidebar, roster,
      // assignee, comments, activity) without a manual reload.
      router.refresh();
    });
  }

  return (
    <section>
      <h2 className="text-sm font-semibold">{t("section_name")}</h2>
      <p className="text-xs text-muted-foreground mt-1">
        {t("section_name_hint")}
      </p>
      <div className="mt-4 flex max-w-sm items-start gap-2">
        <div className="flex-1">
          <Label htmlFor="display_name" className="sr-only">
            {t("section_name")}
          </Label>
          <Input
            id="display_name"
            name="display_name"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setJustSaved(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                save();
              }
            }}
            placeholder={placeholder || t("name_placeholder")}
            disabled={pending}
          />
          {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
        </div>
        <Button
          type="button"
          onClick={save}
          disabled={!dirty || pending}
          className="shrink-0"
        >
          {pending ? (
            tc("loading")
          ) : justSaved && !dirty ? (
            <>
              <Check className="size-4" />
              {t("saved")}
            </>
          ) : (
            t("save")
          )}
        </Button>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Your role at the firm
// ─────────────────────────────────────────────────────────────────────────────

// What you do, and how many hours you have in a normal week.
//
// Both show on your teammate page, which is the point — the owner plans around
// your hours, and a colleague looking you up learns what you do. But you are
// the one who sets them: a job title somebody assigned you without asking is a
// strange thing for a product to enable, and hours you did not agree to are
// worse. One row in the database, one place to change it, so the two pages can
// never disagree.
function WorkDetailsSection({
  jobTitle,
  weeklyHours,
  t,
  tc,
}: {
  jobTitle: string;
  weeklyHours: string;
  t: (k: string) => string;
  tc: (k: string) => string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState(jobTitle);
  const [hours, setHours] = useState(weeklyHours);
  const [baseline, setBaseline] = useState({ title: jobTitle, hours: weeklyHours });
  const [justSaved, setJustSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = title.trim() !== baseline.title.trim() || hours.trim() !== baseline.hours.trim();

  function save() {
    setError(null);
    if (!dirty || pending) return;
    const fd = new FormData();
    fd.append("job_title", title.trim());
    fd.append("weekly_hours", hours.trim());
    startTransition(async () => {
      const res = await updateWorkDetailsAction(fd);
      if (!res.ok) {
        setError(
          res.error === "invalid" ? t("work_hours_invalid") : t("errors.save_failed"),
        );
        return;
      }
      setBaseline({ title: title.trim(), hours: hours.trim() });
      setJustSaved(true);
      toast.success(t("work_saved"));
      router.refresh();
    });
  }

  return (
    <section>
      <h2 className="text-sm font-semibold">{t("section_work")}</h2>
      <p className="mt-1 text-xs text-muted-foreground">{t("section_work_hint")}</p>
      <div className="mt-4 flex max-w-sm flex-col gap-3">
        <div>
          <Label htmlFor="job_title">{t("work_job_title")}</Label>
          <Input
            id="job_title"
            name="job_title"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setJustSaved(false);
            }}
            placeholder={t("work_job_title_placeholder")}
            maxLength={120}
            disabled={pending}
            className="mt-1.5"
          />
        </div>
        <div>
          <Label htmlFor="weekly_hours">{t("work_weekly_hours")}</Label>
          <Input
            id="weekly_hours"
            name="weekly_hours"
            value={hours}
            onChange={(e) => {
              setHours(e.target.value);
              setJustSaved(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                save();
              }
            }}
            inputMode="decimal"
            placeholder={t("work_weekly_hours_placeholder")}
            disabled={pending}
            className="mt-1.5 tabular-nums"
          />
          <p className="mt-1.5 text-xs text-muted-foreground">
            {t("work_weekly_hours_hint")}
          </p>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <Button
          type="button"
          onClick={save}
          disabled={!dirty || pending}
          className="self-start"
        >
          {pending ? (
            tc("loading")
          ) : justSaved && !dirty ? (
            <>
              <Check className="size-4" />
              {t("saved")}
            </>
          ) : (
            t("save")
          )}
        </Button>
      </div>
    </section>
  );
}
