"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
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
  submitStep2,
  skipStep,
  type OnboardingState,
} from "@/app/actions/onboarding";

const CA_TIMEZONES = [
  ["America/Toronto", "Toronto / Ottawa / Montréal (Eastern)"],
  ["America/Halifax", "Halifax (Atlantic)"],
  ["America/St_Johns", "St. John's (Newfoundland)"],
  ["America/Winnipeg", "Winnipeg / Regina (Central)"],
  ["America/Edmonton", "Edmonton / Calgary (Mountain)"],
  ["America/Vancouver", "Vancouver (Pacific)"],
] as const;

export function Step2Form({
  locale,
  initialTimezone,
  initialLocaleDefault,
}: {
  locale: "fr" | "en";
  initialTimezone: string;
  initialLocaleDefault: "fr" | "en";
}) {
  const t = useTranslations("Onboarding");
  const tc = useTranslations("Common");
  const [state, action, pending] = useActionState<OnboardingState, FormData>(
    submitStep2,
    null,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("step2_title")}</CardTitle>
        <CardDescription>{t("step2_subtitle")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-5">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="step" value="2" />
          {state?.error && (
            <Alert variant="destructive">
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="timezone">{t("step2_timezone")}</Label>
            <Select name="timezone" defaultValue={initialTimezone}>
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
            <Label htmlFor="locale_default">{t("step2_locale")}</Label>
            <Select name="locale_default" defaultValue={initialLocaleDefault}>
              <SelectTrigger id="locale_default" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="fr">{t("step2_locale_fr")}</SelectItem>
                <SelectItem value="en">{t("step2_locale_en")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={pending} className="flex-1">
              {pending ? tc("saving") : tc("continue")}
            </Button>
            <Button type="submit" variant="ghost" formAction={skipStep}>
              {tc("skip_for_now")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
