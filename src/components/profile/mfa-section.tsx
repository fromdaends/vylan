"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  enrollMfaAction,
  verifyMfaEnrollAction,
  disableMfaAction,
} from "@/app/actions/mfa";
import { ShieldCheck, ShieldAlert, Copy, Check } from "lucide-react";

// Three steps inside the enrollment dialog: show the QR (scan), enter
// the first 6-digit code (verify), and show the recovery codes (save).
type EnrollStep = "qr" | "verify" | "recovery";

export function MfaSection({ initialEnabled }: { initialEnabled: boolean }) {
  const t = useTranslations("Profile");
  const tc = useTranslations("Common");
  const [enabled, setEnabled] = useState(initialEnabled);
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);

  return (
    <section>
      <h2 className="text-sm font-semibold">{t("mfa_title")}</h2>
      <p className="text-xs text-muted-foreground mt-1">{t("mfa_hint")}</p>
      <div className="mt-4 flex items-center gap-3">
        {enabled ? (
          <>
            <ShieldCheck className="size-5 text-success" aria-hidden />
            <span className="text-sm font-medium">{t("mfa_on_label")}</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDisableOpen(true)}
              className="ml-auto"
            >
              {t("mfa_disable")}
            </Button>
          </>
        ) : (
          <>
            <ShieldAlert
              className="size-5 text-muted-foreground"
              aria-hidden
            />
            <span className="text-sm text-muted-foreground">
              {t("mfa_off_label")}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setEnrollOpen(true)}
              className="ml-auto"
            >
              {t("mfa_setup")}
            </Button>
          </>
        )}
      </div>

      <EnrollDialog
        open={enrollOpen}
        onClose={() => setEnrollOpen(false)}
        onEnabled={() => setEnabled(true)}
        t={t}
        tc={tc}
      />

      <DisableDialog
        open={disableOpen}
        onClose={() => setDisableOpen(false)}
        onDisabled={() => setEnabled(false)}
        t={t}
        tc={tc}
      />
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Enrollment dialog
// ─────────────────────────────────────────────────────────────────────────────

function EnrollDialog({
  open,
  onClose,
  onEnabled,
  t,
  tc,
}: {
  open: boolean;
  onClose: () => void;
  onEnabled: () => void;
  t: (k: string) => string;
  tc: (k: string) => string;
}) {
  const router = useRouter();
  const [step, setStep] = useState<EnrollStep>("qr");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [secret, setSecret] = useState<string>("");
  const [factorId, setFactorId] = useState<string>("");
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [savedConfirmed, setSavedConfirmed] = useState(false);

  function reset() {
    setStep("qr");
    setError(null);
    setQrCode(null);
    setSecret("");
    setFactorId("");
    setCode("");
    setRecoveryCodes([]);
    setSavedConfirmed(false);
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      // Closing the dialog mid-flow is fine — the unverified factor will
      // be cleaned up the next time the user starts enrollment.
      reset();
      onClose();
    }
  }

  function startEnroll() {
    setError(null);
    startTransition(async () => {
      const res = await enrollMfaAction();
      if (!res.ok) {
        setError(t(`errors.${res.error}`));
        return;
      }
      setQrCode(res.qr_code);
      setSecret(res.secret);
      setFactorId(res.factor_id);
    });
  }

  function verifyCode(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData();
    fd.append("factor_id", factorId);
    fd.append("code", code);
    startTransition(async () => {
      const res = await verifyMfaEnrollAction(fd);
      if (!res.ok) {
        setError(t(`errors.${res.error}`));
        return;
      }
      setRecoveryCodes(res.recovery_codes);
      setStep("recovery");
    });
  }

  function finish() {
    onEnabled();
    handleOpenChange(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("mfa_setup_title")}</DialogTitle>
          <DialogDescription>{t(`mfa_step_${step}_subtitle`)}</DialogDescription>
        </DialogHeader>

        {step === "qr" && !qrCode && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t("mfa_step_qr_intro")}
            </p>
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => handleOpenChange(false)}
                disabled={pending}
              >
                {tc("cancel")}
              </Button>
              <Button type="button" onClick={startEnroll} disabled={pending}>
                {pending ? tc("loading") : t("mfa_step_qr_generate")}
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "qr" && qrCode && (
          <div className="space-y-4">
            <div className="flex justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qrCode}
                alt={t("mfa_qr_alt")}
                width={200}
                height={200}
                className="rounded-md bg-white p-2"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t("mfa_secret_label")}</Label>
              <SecretField value={secret} />
            </div>
            <p className="text-xs text-muted-foreground">
              {t("mfa_step_qr_help")}
            </p>
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => handleOpenChange(false)}
                disabled={pending}
              >
                {tc("cancel")}
              </Button>
              <Button type="button" onClick={() => setStep("verify")}>
                {t("mfa_step_qr_next")}
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "verify" && (
          <form onSubmit={verifyCode} className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t("mfa_step_verify_intro")}
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="mfa-code">{t("mfa_code_label")}</Label>
              <Input
                id="mfa-code"
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                value={code}
                onChange={(e) =>
                  setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
                placeholder="123456"
                className="font-mono text-lg tracking-widest"
              />
            </div>
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setStep("qr")}
                disabled={pending}
              >
                {tc("back")}
              </Button>
              <Button type="submit" disabled={pending || code.length !== 6}>
                {pending ? tc("loading") : t("mfa_step_verify_confirm")}
              </Button>
            </DialogFooter>
          </form>
        )}

        {step === "recovery" && (
          <div className="space-y-4">
            <p className="text-sm font-medium text-success">
              {t("mfa_step_recovery_success")}
            </p>
            <p className="text-sm text-muted-foreground">
              {t("mfa_step_recovery_intro")}
            </p>
            <div className="grid grid-cols-2 gap-2 rounded-md border border-border bg-muted/30 p-3">
              {recoveryCodes.map((c) => (
                <code
                  key={c}
                  className="text-xs font-mono tracking-wider select-all"
                >
                  {c}
                </code>
              ))}
            </div>
            <label className="flex items-start gap-2 text-sm select-none cursor-pointer">
              <input
                type="checkbox"
                checked={savedConfirmed}
                onChange={(e) => setSavedConfirmed(e.target.checked)}
                className="mt-1"
              />
              <span>{t("mfa_step_recovery_saved_confirm")}</span>
            </label>
            <DialogFooter>
              <Button
                type="button"
                onClick={finish}
                disabled={!savedConfirmed}
              >
                {t("mfa_step_recovery_done")}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SecretField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(value).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-2.5 py-1.5">
      <code className="text-xs font-mono flex-1 truncate select-all">
        {value}
      </code>
      <Button type="button" variant="ghost" size="sm" onClick={copy}>
        {copied ? (
          <Check className="size-3.5" />
        ) : (
          <Copy className="size-3.5" />
        )}
      </Button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Disable dialog
// ─────────────────────────────────────────────────────────────────────────────

function DisableDialog({
  open,
  onClose,
  onDisabled,
  t,
  tc,
}: {
  open: boolean;
  onClose: () => void;
  onDisabled: () => void;
  t: (k: string) => string;
  tc: (k: string) => string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setPassword("");
    setError(null);
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      reset();
      onClose();
    }
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData();
    fd.append("password", password);
    startTransition(async () => {
      const res = await disableMfaAction(fd);
      if (!res.ok) {
        setError(t(`errors.${res.error}`));
        return;
      }
      onDisabled();
      handleOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("mfa_disable_title")}</DialogTitle>
          <DialogDescription>{t("mfa_disable_subtitle")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="mfa-disable-pw">{t("mfa_disable_password")}</Label>
            <Input
              id="mfa-disable-pw"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => handleOpenChange(false)}
              disabled={pending}
            >
              {tc("cancel")}
            </Button>
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending ? tc("loading") : t("mfa_disable_confirm")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
