"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ArrowRight } from "lucide-react";
import { verifyMfaChallengeAction } from "@/app/actions/mfa";
import { logoutAction } from "@/app/actions/auth";

type Mode = "totp" | "recovery";

export function MfaChallengeForm({ locale }: { locale: "fr" | "en" }) {
  const t = useTranslations("Auth");
  const tc = useTranslations("Common");
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("totp");
  const [code, setCode] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [recoveryNotice, setRecoveryNotice] = useState(false);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData();
    fd.append("code", code);
    startTransition(async () => {
      const res = await verifyMfaChallengeAction(fd);
      if (!res.ok) {
        setError(t(`mfa_errors.${res.error}`));
        return;
      }
      if (res.recovery_used) {
        // Brief notice on the same page, then redirect. The user needs
        // to know MFA is off and they should re-enroll.
        setRecoveryNotice(true);
        setTimeout(() => {
          router.replace(`/${locale}/profile`);
        }, 2500);
        return;
      }
      // Land on /dashboard (the post-login landing), matching every other
      // post-auth path in the app.
      router.replace(`/${locale}/dashboard`);
    });
  }

  if (recoveryNotice) {
    return (
      <Alert>
        <AlertDescription className="text-sm">
          {t("mfa_recovery_used_notice")}
        </AlertDescription>
      </Alert>
    );
  }

  const isTotp = mode === "totp";

  return (
    <>
      <form onSubmit={submit} className="space-y-4">
      {error && (
        <Alert variant="destructive" className="animate-in-fade">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="space-y-2">
        <Label htmlFor="code">
          {isTotp ? t("mfa_code_label") : t("mfa_recovery_label")}
        </Label>
        <Input
          id="code"
          name="code"
          inputMode={isTotp ? "numeric" : "text"}
          autoComplete="one-time-code"
          pattern={isTotp ? "[0-9]{6}" : undefined}
          maxLength={isTotp ? 6 : 32}
          required
          value={code}
          onChange={(e) =>
            setCode(
              isTotp
                ? e.target.value.replace(/\D/g, "").slice(0, 6)
                : e.target.value.slice(0, 32),
            )
          }
          placeholder={isTotp ? "123456" : "abcd-1234-ef56"}
          className="font-mono text-lg tracking-widest"
          autoFocus
        />
      </div>
      <Button
        type="submit"
        size="lg"
        className="w-full mt-2"
        disabled={pending || code.length === 0}
      >
        {pending ? tc("loading") : t("mfa_challenge_submit")}
        {!pending && <ArrowRight className="h-4 w-4" />}
      </Button>
      <div className="text-center text-sm">
        <button
          type="button"
          onClick={() => {
            setMode(isTotp ? "recovery" : "totp");
            setCode("");
            setError(null);
          }}
          className="text-muted-foreground hover:text-foreground underline underline-offset-4"
        >
          {isTotp ? t("mfa_use_recovery") : t("mfa_use_totp")}
        </button>
      </div>
      </form>
      {/* Sibling form, NOT nested — nested <form> is invalid HTML and
          browsers ignore the inner one, which meant the "Cancel and
          log out" button was actually submitting the outer MFA-verify
          form with whatever (empty) code was in the field instead of
          calling logoutAction. */}
      <form action={logoutAction}>
        <button
          type="submit"
          className="w-full text-xs text-muted-foreground hover:text-foreground mt-4 text-center underline underline-offset-4"
        >
          {t("mfa_cancel_and_logout")}
        </button>
      </form>
    </>
  );
}
