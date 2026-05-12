"use client";

import { useActionState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { loginAction, type AuthActionState } from "@/app/actions/auth";
import { ArrowRight } from "lucide-react";

export default function LoginPage() {
  const t = useTranslations("Auth");
  const tc = useTranslations("Common");
  const locale = useLocale();
  const [state, formAction, pending] = useActionState<
    AuthActionState,
    FormData
  >(loginAction, null);

  return (
    <div>
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("login_title")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("login_subtitle")}
        </p>
      </div>

      <form action={formAction} className="space-y-4">
        <input type="hidden" name="locale" value={locale} />
        {state?.error && (
          <Alert variant="destructive" className="animate-in-fade">
            <AlertDescription>{t(`errors.${state.error}`)}</AlertDescription>
          </Alert>
        )}
        <div className="space-y-2">
          <Label htmlFor="email">{t("email")}</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@firm.com"
            required
            aria-invalid={Boolean(state?.fieldErrors?.email)}
          />
          {state?.fieldErrors?.email && (
            <p className="text-xs text-destructive">
              {t(`errors.${state.fieldErrors.email}` as const)}
            </p>
          )}
        </div>
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <Label htmlFor="password">{t("password")}</Label>
            <Link
              href="/forgot-password"
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {t("forgot_link")}
            </Link>
          </div>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            placeholder="••••••••"
            required
            aria-invalid={Boolean(state?.fieldErrors?.password)}
          />
          {state?.fieldErrors?.password && (
            <p className="text-xs text-destructive">
              {t(`errors.${state.fieldErrors.password}` as const)}
            </p>
          )}
        </div>
        <Button
          type="submit"
          size="lg"
          className="w-full mt-2"
          disabled={pending}
        >
          {pending ? tc("loading") : t("submit_login")}
          {!pending && <ArrowRight className="h-4 w-4" />}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        {t("no_account")}{" "}
        <Link
          href="/signup"
          className="text-foreground font-medium hover:underline underline-offset-4"
        >
          {t("create_account")}
        </Link>
      </p>
    </div>
  );
}
