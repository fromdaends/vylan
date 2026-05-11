"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
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
  forgotPasswordAction,
  type AuthActionState,
} from "@/app/actions/auth";

export default function ForgotPasswordPage() {
  const t = useTranslations("Auth");
  const tc = useTranslations("Common");
  const [state, formAction, pending] = useActionState<
    AuthActionState,
    FormData
  >(forgotPasswordAction, null);

  const sent = state?.error === "reset_sent";

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("forgot_title")}</CardTitle>
        <CardDescription>{t("forgot_subtitle")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4">
          {state?.error && (
            <Alert variant={sent ? "default" : "destructive"}>
              <AlertDescription>{t(`errors.${state.error}`)}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="email">{t("email")}</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
            />
            {state?.fieldErrors?.email && (
              <p className="text-sm text-destructive">
                {t(`errors.${state.fieldErrors.email}` as const)}
              </p>
            )}
          </div>
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? tc("loading") : t("submit_forgot")}
          </Button>
          <div className="text-sm text-muted-foreground text-center">
            <Link href="/login" className="text-foreground underline">
              {t("sign_in")}
            </Link>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
