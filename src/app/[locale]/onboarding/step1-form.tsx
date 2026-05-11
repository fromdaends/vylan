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
  submitStep1,
  type OnboardingState,
} from "@/app/actions/onboarding";

export function Step1Form({
  locale,
  initialName,
  initialColor,
}: {
  locale: "fr" | "en";
  initialName: string;
  initialColor: string;
}) {
  const t = useTranslations("Onboarding");
  const tAuth = useTranslations("Auth");
  const tc = useTranslations("Common");
  const [state, action, pending] = useActionState<OnboardingState, FormData>(
    submitStep1,
    null,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("step1_title")}</CardTitle>
        <CardDescription>{t("step1_subtitle")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-5">
          <input type="hidden" name="locale" value={locale} />
          {state?.error && (
            <Alert variant="destructive">
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="firm_name">{t("step1_firm_name")}</Label>
            <Input
              id="firm_name"
              name="firm_name"
              defaultValue={initialName}
              placeholder={t("step1_firm_name_placeholder")}
              required
              minLength={2}
              maxLength={120}
              aria-invalid={Boolean(state?.fieldErrors?.firm_name)}
            />
            {state?.fieldErrors?.firm_name && (
              <p className="text-sm text-destructive">
                {tAuth(`errors.${state.fieldErrors.firm_name}` as const)}
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="brand_color">{t("step1_brand_color")}</Label>
            <div className="flex items-center gap-3">
              <Input
                id="brand_color"
                name="brand_color"
                type="color"
                defaultValue={initialColor}
                className="h-10 w-20 p-1"
              />
              <span className="text-sm text-muted-foreground font-mono">
                {initialColor}
              </span>
            </div>
          </div>
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? tc("saving") : tc("continue")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
