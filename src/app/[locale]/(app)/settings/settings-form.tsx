"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  updateFirmSettings,
  type SettingsState,
} from "@/app/actions/settings";

const CA_TIMEZONES = [
  ["America/Toronto", "Toronto / Ottawa / Montréal (Eastern)"],
  ["America/Halifax", "Halifax (Atlantic)"],
  ["America/St_Johns", "St. John's (Newfoundland)"],
  ["America/Winnipeg", "Winnipeg / Regina (Central)"],
  ["America/Edmonton", "Edmonton / Calgary (Mountain)"],
  ["America/Vancouver", "Vancouver (Pacific)"],
] as const;

export function SettingsForm({
  locale,
  initial,
}: {
  locale: "fr" | "en";
  initial: {
    name: string;
    brand_color: string;
    timezone: string;
    locale_default: "fr" | "en";
  };
}) {
  const t = useTranslations("App");
  const tOnb = useTranslations("Onboarding");
  const tc = useTranslations("Common");
  const [state, action, pending] = useActionState<SettingsState, FormData>(
    updateFirmSettings,
    null,
  );

  return (
    <div className="space-y-6 max-w-2xl">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("settings_title")}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t("settings_subtitle")}
        </p>
      </header>
      <Card>
        <CardHeader>
          <CardTitle>{tOnb("step1_title")}</CardTitle>
          <CardDescription>{tOnb("step1_subtitle")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={action} className="space-y-5">
            <input type="hidden" name="locale" value={locale} />
            {state?.ok && (
              <Alert>
                <AlertDescription>{t("settings_saved")}</AlertDescription>
              </Alert>
            )}
            {state?.error && (
              <Alert variant="destructive">
                <AlertDescription>{state.error}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="name">{tOnb("step1_firm_name")}</Label>
              <Input
                id="name"
                name="name"
                defaultValue={initial.name}
                required
                minLength={2}
                maxLength={120}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="brand_color">{tOnb("step1_brand_color")}</Label>
              <Input
                id="brand_color"
                name="brand_color"
                type="color"
                defaultValue={initial.brand_color}
                className="h-10 w-20 p-1"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="timezone">{tOnb("step2_timezone")}</Label>
              <Select name="timezone" defaultValue={initial.timezone}>
                <SelectTrigger id="timezone" className="w-full">
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
            <div className="space-y-1.5">
              <Label htmlFor="locale_default">{tOnb("step2_locale")}</Label>
              <Select
                name="locale_default"
                defaultValue={initial.locale_default}
              >
                <SelectTrigger id="locale_default" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fr">{tOnb("step2_locale_fr")}</SelectItem>
                  <SelectItem value="en">{tOnb("step2_locale_en")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" disabled={pending}>
              {pending ? tc("saving") : tc("save")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
