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
import { signupAction, type AuthActionState } from "@/app/actions/auth";

export default function SignupPage() {
  const t = useTranslations("Auth");
  const tc = useTranslations("Common");
  const locale = useLocale();
  const [state, formAction, pending] = useActionState<
    AuthActionState,
    FormData
  >(signupAction, null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("signup_title")}</CardTitle>
        <CardDescription>{t("signup_subtitle")}</CardDescription>
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
            <Label htmlFor="name">{t("name")}</Label>
            <Input
              id="name"
              name="name"
              type="text"
              autoComplete="name"
              required
              aria-invalid={Boolean(state?.fieldErrors?.name)}
            />
            {state?.fieldErrors?.name && (
              <p className="text-sm text-destructive">
                {t(`errors.${state.fieldErrors.name}` as const)}
              </p>
            )}
          </div>
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
            {pending ? tc("loading") : t("submit_signup")}
          </Button>
          <div className="text-sm text-muted-foreground text-center">
            {t("have_account")}{" "}
            <Link href="/login" className="text-foreground underline">
              {t("sign_in")}
            </Link>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
