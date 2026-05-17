"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  updateFirmLogoAction,
  removeFirmLogoAction,
} from "@/app/actions/profile";
import { updateFirmSettings } from "@/app/actions/settings";
import { type SettingsState } from "@/app/actions/settings.schema";

type FirmInfo = {
  name: string;
  brand_color: string;
  timezone: string;
  locale_default: "fr" | "en";
};

export function FirmForm({
  firm,
  firmLogoUrl,
}: {
  firm: FirmInfo;
  firmLogoUrl: string | null;
}) {
  const t = useTranslations("Profile");
  const tc = useTranslations("Common");

  return (
    <div className="space-y-12">
      <FirmLogoSection
        firmLogoUrl={firmLogoUrl}
        firmName={firm.name}
        firmBrandColor={firm.brand_color}
        t={t}
        tc={tc}
      />
      <FirmSection initial={firm} t={t} tc={tc} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Firm logo — writes to firms.logo_url and is scoped to the whole firm
// (any member sees the change after refresh). Mirrors the avatar pattern
// on /profile.
// ─────────────────────────────────────────────────────────────────────────────

function FirmLogoSection({
  firmLogoUrl,
  firmName,
  firmBrandColor,
  t,
  tc,
}: {
  firmLogoUrl: string | null;
  firmName: string;
  firmBrandColor: string;
  t: (k: string) => string;
  tc: (k: string) => string;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(firmLogoUrl);

  function onPick() {
    inputRef.current?.click();
  }

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    const fd = new FormData();
    fd.append("file", file);
    startTransition(async () => {
      const res = await updateFirmLogoAction(fd);
      if (!res.ok) {
        setError(t(`errors.${res.error}`) || tc("loading"));
        return;
      }
      if (res.signedUrl) setPreview(res.signedUrl);
    });
  }

  function onRemove() {
    setError(null);
    startTransition(async () => {
      const res = await removeFirmLogoAction();
      if (!res.ok) {
        setError(t(`errors.${res.error}`) || tc("loading"));
        return;
      }
      setPreview(null);
    });
  }

  return (
    <section>
      <h2 className="text-sm font-semibold">{t("section_firm_logo")}</h2>
      <p className="text-xs text-muted-foreground mt-1">
        {t("section_firm_logo_hint")}
      </p>
      <div className="mt-4 flex items-center gap-4">
        <AvatarInitials
          src={preview ?? undefined}
          name={firmName}
          size={64}
          color={firmBrandColor}
        />
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onPick}
            disabled={pending}
          >
            {pending ? t("uploading") : t("change_firm_logo")}
          </Button>
          {preview && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onRemove}
              disabled={pending}
            >
              {t("remove_firm_logo")}
            </Button>
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
          className="hidden"
          onChange={onChange}
        />
      </div>
      {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Firm details — name, brand color, timezone, default language for client
// emails. Saved via the existing updateFirmSettings server action.
// ─────────────────────────────────────────────────────────────────────────────

const CA_TIMEZONES: ReadonlyArray<readonly [string, string]> = [
  ["America/Toronto", "Toronto / Ottawa / Montréal (Eastern)"],
  ["America/Halifax", "Halifax (Atlantic)"],
  ["America/St_Johns", "St. John's (Newfoundland)"],
  ["America/Winnipeg", "Winnipeg / Regina (Central)"],
  ["America/Edmonton", "Edmonton / Calgary (Mountain)"],
  ["America/Vancouver", "Vancouver (Pacific)"],
];

function FirmSection({
  initial,
  t,
  tc,
}: {
  initial: FirmInfo;
  t: (k: string) => string;
  tc: (k: string) => string;
}) {
  const tOnb = useTranslations("Onboarding");
  const [state, action, pending] = useActionState<SettingsState, FormData>(
    updateFirmSettings,
    null,
  );

  return (
    <form action={action} className="space-y-5">
      <h2 className="text-sm font-semibold">{t("firm_title")}</h2>
      <p className="text-xs text-muted-foreground mt-1 -mt-4">
        {t("firm_hint")}
      </p>

      <div className="space-y-2">
        <Label htmlFor="name">{tOnb("step1_firm_name")}</Label>
        <Input
          id="name"
          name="name"
          defaultValue={initial.name}
          required
          minLength={2}
          maxLength={120}
          className="max-w-sm"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="brand_color">{tOnb("step1_brand_color")}</Label>
        <div className="flex items-center gap-3">
          <Input
            id="brand_color"
            name="brand_color"
            type="color"
            defaultValue={initial.brand_color}
            className="h-10 w-20 p-1 cursor-pointer"
          />
          <span className="text-xs text-muted-foreground font-mono">
            {initial.brand_color.toUpperCase()}
          </span>
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="timezone">{tOnb("step2_timezone")}</Label>
        <Select name="timezone" defaultValue={initial.timezone}>
          <SelectTrigger id="timezone" className="max-w-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CA_TIMEZONES.map(([tz, label]) => (
              <SelectItem key={tz} value={tz}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="locale_default">{t("firm_client_lang")}</Label>
        <p className="text-xs text-muted-foreground">
          {t("firm_client_lang_hint")}
        </p>
        <Select name="locale_default" defaultValue={initial.locale_default}>
          <SelectTrigger id="locale_default" className="max-w-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="fr">Français</SelectItem>
            <SelectItem value="en">English</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center gap-3 pt-2">
        <Button type="submit" disabled={pending}>
          {pending ? tc("saving") : tc("save")}
        </Button>
        {state?.ok && (
          <span className="text-xs text-muted-foreground">{t("saved")}</span>
        )}
        {state?.error && (
          <span className="text-xs text-destructive">
            {t("errors.save_failed")}
          </span>
        )}
      </div>
    </form>
  );
}
