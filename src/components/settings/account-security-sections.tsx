"use client";

import { useState, useTransition } from "react";
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
  updateEmailAction,
  changePasswordAction,
} from "@/app/actions/profile";
// Email + Password sign-in sections, extracted verbatim from the old /profile
// form so Settings can reuse the exact same flows. Email opens a
// confirm-to-new-address dialog; Password opens a current/new/confirm dialog.
// Two-factor (MfaSection) lives separately under Security & privacy. Strings
// stay in the Profile namespace.
export function AccountSignInSections({ email }: { email: string }) {
  const t = useTranslations("Profile");
  const tc = useTranslations("Common");
  return (
    <div className="space-y-10">
      <EmailSection email={email} t={t} />
      <PasswordSection t={t} tc={tc} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Email — current email shown read-only, "Change email" opens a modal that
// triggers a Supabase confirmation email to the NEW address.
// ─────────────────────────────────────────────────────────────────────────────

function EmailSection({ email, t }: { email: string; t: (k: string) => string }) {
  const [open, setOpen] = useState(false);
  return (
    <section>
      <h2 className="text-sm font-semibold">{t("section_email")}</h2>
      <p className="text-xs text-muted-foreground mt-1">
        {t("section_email_hint")}
      </p>
      <div className="mt-4 max-w-sm flex items-center gap-2">
        <Input value={email} disabled readOnly className="flex-1" />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setOpen(true)}
        >
          {t("change_email")}
        </Button>
      </div>
      <EmailChangeDialog
        open={open}
        currentEmail={email}
        onClose={() => setOpen(false)}
      />
    </section>
  );
}

function EmailChangeDialog({
  open,
  currentEmail,
  onClose,
}: {
  open: boolean;
  currentEmail: string;
  onClose: () => void;
}) {
  // Typed hook directly so the success message can interpolate {email}.
  const t = useTranslations("Profile");
  const tc = useTranslations("Common");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const newEmail = String(fd.get("email") ?? "").trim();
    startTransition(async () => {
      const res = await updateEmailAction(fd);
      if (!res.ok) {
        setError(t(`errors.${res.error}`) || tc("loading"));
        return;
      }
      setPendingEmail(newEmail);
    });
  }

  function handleClose() {
    setError(null);
    setPendingEmail(null);
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("email_modal_title")}</DialogTitle>
          <DialogDescription>{t("email_modal_subtitle")}</DialogDescription>
        </DialogHeader>
        {pendingEmail ? (
          <div className="space-y-3">
            <p className="text-sm">
              {t("email_check_inbox", { email: pendingEmail })}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("email_check_inbox_hint")}
            </p>
            <DialogFooter>
              <Button type="button" onClick={handleClose}>
                {tc("close")}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="current_email">{t("section_email")}</Label>
              <Input id="current_email" value={currentEmail} disabled readOnly />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new_email">{t("new_email")}</Label>
              <Input
                id="new_email"
                name="email"
                type="email"
                autoComplete="email"
                required
                placeholder={t("new_email_placeholder")}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={handleClose}
                disabled={pending}
              >
                {tc("cancel")}
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? tc("saving") : t("submit_email")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Password — modal with current + new + confirm.
// ─────────────────────────────────────────────────────────────────────────────

function PasswordSection({
  t,
  tc,
}: {
  t: (k: string) => string;
  tc: (k: string) => string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section>
      <h2 className="text-sm font-semibold">{t("section_password")}</h2>
      <p className="text-xs text-muted-foreground mt-1">
        {t("section_password_hint")}
      </p>
      <div className="mt-4">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setOpen(true)}
        >
          {t("change_password")}
        </Button>
      </div>
      <PasswordDialog open={open} onClose={() => setOpen(false)} t={t} tc={tc} />
    </section>
  );
}

function PasswordDialog({
  open,
  onClose,
  t,
  tc,
}: {
  open: boolean;
  onClose: () => void;
  t: (k: string) => string;
  tc: (k: string) => string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    const fd = new FormData(e.currentTarget);
    const newPw = String(fd.get("new_password") ?? "");
    const confirm = String(fd.get("new_password_confirm") ?? "");
    if (newPw !== confirm) {
      setError(t("errors.mismatch"));
      return;
    }
    startTransition(async () => {
      const res = await changePasswordAction(fd);
      if (!res.ok) {
        setError(t(`errors.${res.error}`) || tc("loading"));
        return;
      }
      setSuccess(true);
      setTimeout(() => {
        setSuccess(false);
        onClose();
      }, 1200);
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("password_modal_title")}</DialogTitle>
          <DialogDescription>{t("password_modal_subtitle")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="current_password">{t("current_password")}</Label>
            <Input
              id="current_password"
              name="current_password"
              type="password"
              autoComplete="current-password"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new_password">{t("new_password")}</Label>
            <Input
              id="new_password"
              name="new_password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new_password_confirm">
              {t("new_password_confirm")}
            </Label>
            <Input
              id="new_password_confirm"
              name="new_password_confirm"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {success && (
            <p className="text-sm text-success">{t("password_changed")}</p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              disabled={pending}
            >
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? tc("saving") : t("submit_password")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
