"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  updateAvatarAction,
  removeAvatarAction,
  updateDisplayNameAction,
  updateLocaleAction,
  changePasswordAction,
  type ProfileActionResult,
} from "@/app/actions/profile";

type ProfileUser = {
  id: string;
  email: string;
  name: string;
  display_name: string | null;
  locale: "fr" | "en";
};

export function ProfileForm({
  user,
  displayLabel,
  firmBrandColor,
  avatarUrl,
}: {
  user: ProfileUser;
  displayLabel: string;
  firmBrandColor: string;
  avatarUrl: string | null;
}) {
  const t = useTranslations("Profile");
  const tc = useTranslations("Common");

  return (
    <div className="space-y-10">
      <AvatarSection
        avatarUrl={avatarUrl}
        displayLabel={displayLabel}
        firmBrandColor={firmBrandColor}
        t={t}
        tc={tc}
      />
      <DisplayNameSection
        current={user.display_name ?? ""}
        placeholder={user.name}
        t={t}
        tc={tc}
      />
      <EmailSection email={user.email} t={t} />
      <LanguageSection currentLocale={user.locale} t={t} tc={tc} />
      <PasswordSection t={t} tc={tc} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Avatar
// ─────────────────────────────────────────────────────────────────────────────

function AvatarSection({
  avatarUrl,
  displayLabel,
  firmBrandColor,
  t,
  tc,
}: {
  avatarUrl: string | null;
  displayLabel: string;
  firmBrandColor: string;
  t: (k: string) => string;
  tc: (k: string) => string;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(avatarUrl);

  function onPick() {
    inputRef.current?.click();
  }

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    const fd = new FormData();
    fd.append("file", file);
    startTransition(async () => {
      const res = (await updateAvatarAction(fd)) as ProfileActionResult;
      if (!res.ok) {
        setError(t(`errors.${res.error}`) || tc("loading"));
        return;
      }
      if (res.signedUrl) setPreview(res.signedUrl);
    });
  }

  function onRemove() {
    setError(null);
    startTransition(async () => {
      const res = await removeAvatarAction();
      if (!res.ok) {
        setError(t(`errors.${res.error}`) || tc("loading"));
        return;
      }
      setPreview(null);
    });
  }

  return (
    <section>
      <h2 className="text-sm font-semibold">{t("section_picture")}</h2>
      <p className="text-xs text-muted-foreground mt-1">
        {t("section_picture_hint")}
      </p>
      <div className="mt-4 flex items-center gap-4">
        <AvatarInitials
          src={preview ?? undefined}
          name={displayLabel}
          size={64}
          color={firmBrandColor}
        />
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onPick}
            disabled={pending}
          >
            {pending ? t("uploading") : t("change_picture")}
          </Button>
          {preview && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onRemove}
              disabled={pending}
            >
              {t("remove_picture")}
            </Button>
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
          className="hidden"
          onChange={onChange}
        />
      </div>
      {error && (
        <p className="mt-3 text-xs text-destructive">{error}</p>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Display name
// ─────────────────────────────────────────────────────────────────────────────

function DisplayNameSection({
  current,
  placeholder,
  t,
  tc,
}: {
  current: string;
  placeholder: string;
  t: (k: string) => string;
  tc: (k: string) => string;
}) {
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(current);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function save() {
    setSaved(false);
    setError(null);
    if (value === current) return;
    const fd = new FormData();
    fd.append("display_name", value);
    startTransition(async () => {
      const res = await updateDisplayNameAction(fd);
      if (!res.ok) {
        setError(t(`errors.${res.error}`) || tc("loading"));
        return;
      }
      setSaved(true);
    });
  }

  return (
    <section>
      <h2 className="text-sm font-semibold">{t("section_name")}</h2>
      <p className="text-xs text-muted-foreground mt-1">
        {t("section_name_hint")}
      </p>
      <div className="mt-4 max-w-sm">
        <Label htmlFor="display_name" className="sr-only">
          {t("section_name")}
        </Label>
        <Input
          id="display_name"
          name="display_name"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setSaved(false);
          }}
          onBlur={save}
          placeholder={placeholder || t("name_placeholder")}
          disabled={pending}
        />
        {saved && (
          <p className="mt-2 text-xs text-muted-foreground">{t("saved")}</p>
        )}
        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Email (read-only)
// ─────────────────────────────────────────────────────────────────────────────

function EmailSection({
  email,
  t,
}: {
  email: string;
  t: (k: string) => string;
}) {
  return (
    <section>
      <h2 className="text-sm font-semibold">{t("section_email")}</h2>
      <p className="text-xs text-muted-foreground mt-1">
        {t("section_email_hint")}
      </p>
      <div className="mt-4 max-w-sm">
        <Input value={email} disabled readOnly />
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Language — saving here flips the UI locale immediately.
// ─────────────────────────────────────────────────────────────────────────────

function LanguageSection({
  currentLocale,
  t,
  tc,
}: {
  currentLocale: "fr" | "en";
  t: (k: string) => string;
  tc: (k: string) => string;
}) {
  const router = useRouter();
  const activeLocale = useLocale();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState<"fr" | "en">(currentLocale);
  const [error, setError] = useState<string | null>(null);

  function onChange(next: "fr" | "en") {
    if (next === value) return;
    setValue(next);
    setError(null);
    const fd = new FormData();
    fd.append("locale", next);
    startTransition(async () => {
      const res = await updateLocaleAction(fd);
      if (!res.ok) {
        setError(t(`errors.${res.error}`) || tc("loading"));
        setValue(currentLocale);
        return;
      }
      // Reroute to the same page in the new locale so the in-page UI
      // flips immediately. The next-intl router handles the prefix swap.
      if (next !== activeLocale) {
        router.replace("/profile", { locale: next });
      }
    });
  }

  return (
    <section>
      <h2 className="text-sm font-semibold">{t("section_language")}</h2>
      <p className="text-xs text-muted-foreground mt-1">
        {t("section_language_hint")}
      </p>
      <div className="mt-4 inline-flex rounded-md border border-border p-0.5 bg-secondary/40">
        <LangButton
          label={t("lang_fr")}
          active={value === "fr"}
          onClick={() => onChange("fr")}
          disabled={pending}
        />
        <LangButton
          label={t("lang_en")}
          active={value === "en"}
          onClick={() => onChange("en")}
          disabled={pending}
        />
      </div>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </section>
  );
}

function LangButton({
  label,
  active,
  onClick,
  disabled,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        "px-3 py-1.5 text-sm rounded-md transition-colors " +
        (active
          ? "bg-card text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground")
      }
    >
      {label}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Password — modal with current + new + confirm
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
