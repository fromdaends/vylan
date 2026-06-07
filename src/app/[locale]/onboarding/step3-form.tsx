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
  submitStep3,
  skipStep,
  type OnboardingState,
} from "@/app/actions/onboarding";

export function Step3Form({ locale }: { locale: "fr" | "en" }) {
  const t = useTranslations("Onboarding");
  const tc = useTranslations("Common");
  const [state, action, pending] = useActionState<OnboardingState, FormData>(
    submitStep3,
    null,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("step3_title")}</CardTitle>
        <CardDescription>{t("step3_subtitle")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-5">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="step" value="3" />
          {state?.error && (
            <Alert variant="destructive">
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="emails">{t("step3_emails_label")}</Label>
            <textarea
              id="emails"
              name="emails"
              rows={5}
              placeholder={t("step3_emails_placeholder")}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
            <p className="text-xs text-muted-foreground">
              {t("step3_invites_help")}
            </p>
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={pending} className="flex-1">
              {pending ? tc("saving") : t("finish")}
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
