"use client";

import { useActionState } from "react";
import { useLocale, useTranslations } from "next-intl";
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
  resetPasswordAction,
  type AuthActionState,
} from "@/app/actions/auth";

export default function ResetPasswordPage() {
  const t = useTranslations("Auth");
  const tc = useTranslations("Common");
  const locale = useLocale();
  const [state, formAction, pending] = useActionState<
    AuthActionState,
    FormData
  >(resetPasswordAction, null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("reset_title")}</CardTitle>
        <CardDescription>{t("reset_subtitle")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="locale" value={locale} />
          {state?.error && (
            <Alert variant="destructive">
              <AlertDescription>{t(`errors.${state.error}`)}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="password">{t("password")}</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              aria-invalid={Boolean(state?.fieldErrors?.password)}
            />
            {state?.fieldErrors?.password && (
              <p className="text-sm text-destructive">
                {t(`errors.${state.fieldErrors.password}` as const)}
              </p>
            )}
          </div>
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? tc("loading") : t("submit_reset")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
