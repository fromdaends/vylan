"use client";

import { useActionState } from "react";
import { useLocale, useTranslations } from "next-intl";
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
import { loginAction, type AuthActionState } from "@/app/actions/auth";

export default function LoginPage() {
  const t = useTranslations("Auth");
  const tc = useTranslations("Common");
  const locale = useLocale();
  const [state, formAction, pending] = useActionState<
    AuthActionState,
    FormData
  >(loginAction, null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("login_title")}</CardTitle>
        <CardDescription>{t("login_subtitle")}</CardDescription>
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
            <Label htmlFor="email">{t("email")}</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              aria-invalid={Boolean(state?.fieldErrors?.email)}
            />
            {state?.fieldErrors?.email && (
              <p className="text-sm text-destructive">
                {t(`errors.${state.fieldErrors.email}` as const)}
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">{t("password")}</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
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
            {pending ? tc("loading") : t("submit_login")}
          </Button>
          <div className="flex justify-between text-sm text-muted-foreground">
            <Link href="/forgot-password" className="hover:text-foreground">
              {t("forgot_link")}
            </Link>
            <span>
              {t("no_account")}{" "}
              <Link href="/signup" className="text-foreground underline">
                {t("create_account")}
              </Link>
            </span>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
