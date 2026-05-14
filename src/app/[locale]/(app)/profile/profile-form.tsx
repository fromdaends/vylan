"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  updateAvatarAction,
  removeAvatarAction,
  updateDisplayNameAction,
  changePasswordAction,
  type ProfileActionResult,
} from "@/app/actions/profile";
import {
  updateFirmSettings,
  type SettingsState,
} from "@/app/actions/settings";

type ProfileUser = {
  id: string;
  email: string;
  name: string;
  display_name: string | null;
};

type FirmInfo = {
  name: string;
  brand_color: string;
  timezone: string;
  locale_default: "fr" | "en";
  auto_reject_unusable_docs: boolean;
};

export function ProfileForm({
  user,
  displayLabel,
  firm,
  avatarUrl,
}: {
  user: ProfileUser;
  displayLabel: string;
  firm: FirmInfo;
  avatarUrl: string | null;
}) {
  const t = useTranslations("Profile");
  const tc = useTranslations("Common");

  return (
    <div className="space-y-12">
      {/* ──── You ──── */}
      <SectionHeader title={t("group_you")} subtitle={t("group_you_hint")} />

      <AvatarSection
        avatarUrl={avatarUrl}
        displayLabel={displayLabel}
        firmBrandColor={firm.brand_color}
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
      <PasswordSection t={t} tc={tc} />

      <Divider />

      {/* ──── Firm ──── */}
      <SectionHeader title={t("group_firm")} subtitle={t("group_firm_hint")} />
      <FirmSection initial={firm} t={t} tc={tc} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Layout helpers
// ─────────────────────────────────────────────────────────────────────────────

function SectionHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground font-medium">
        {title}
      </div>
      <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
    </div>
  );
}

function Divider() {
  return <div className="border-t border-border/60" />;
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
      {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
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

// ─────────────────────────────────────────────────────────────────────────────
// Firm — name, brand color, timezone, default language for client emails
// ─────────────────────────────────────────────────────────────────────────────

const CA_TIMEZONES: ReadonlyArray<readonly [string, string]> = [
  ["America/Toronto", "Toronto / Ottawa / Montréal (Eastern)"],
  ["America/Halifax", "Halifax (Atlantic)"],
  ["America/St_Johns", "St. John's (Newfoundland)"],
  ["America/Winnipeg", "Winnipeg / Regina (Central)"],
  ["America/Edmonton", "Edmonton / Calgary (Mountain)"],
  ["America/Vancouver", "Vancouver (Pacific)"],
];

function FirmSection({
  initial,
  t,
  tc,
}: {
  initial: FirmInfo;
  t: (k: string) => string;
  tc: (k: string) => string;
}) {
  const tOnb = useTranslations("Onboarding");
  const [state, action, pending] = useActionState<SettingsState, FormData>(
    updateFirmSettings,
    null,
  );

  return (
    <form action={action} className="space-y-5">
      <h2 className="text-sm font-semibold">{t("firm_title")}</h2>
      <p className="text-xs text-muted-foreground mt-1 -mt-4">
        {t("firm_hint")}
      </p>

      <div className="space-y-2">
        <Label htmlFor="name">{tOnb("step1_firm_name")}</Label>
        <Input
          id="name"
          name="name"
          defaultValue={initial.name}
          required
          minLength={2}
          maxLength={120}
          className="max-w-sm"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="brand_color">{tOnb("step1_brand_color")}</Label>
        <div className="flex items-center gap-3">
          <Input
            id="brand_color"
            name="brand_color"
            type="color"
            defaultValue={initial.brand_color}
            className="h-10 w-20 p-1 cursor-pointer"
          />
          <span className="text-xs text-muted-foreground font-mono">
            {initial.brand_color.toUpperCase()}
          </span>
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="timezone">{tOnb("step2_timezone")}</Label>
        <Select name="timezone" defaultValue={initial.timezone}>
          <SelectTrigger id="timezone" className="max-w-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CA_TIMEZONES.map(([tz, label]) => (
              <SelectItem key={tz} value={tz}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="locale_default">{t("firm_client_lang")}</Label>
        <p className="text-xs text-muted-foreground">
          {t("firm_client_lang_hint")}
        </p>
        <Select name="locale_default" defaultValue={initial.locale_default}>
          <SelectTrigger id="locale_default" className="max-w-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="fr">Français</SelectItem>
            <SelectItem value="en">English</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="pt-2">
        <h3 className="text-sm font-semibold">
          {t("firm_doc_quality_section")}
        </h3>
        <label
          htmlFor="auto_reject_unusable_docs"
          className="mt-3 flex items-start gap-3 max-w-xl cursor-pointer select-none"
        >
          <input
            id="auto_reject_unusable_docs"
            name="auto_reject_unusable_docs"
            type="checkbox"
            defaultChecked={initial.auto_reject_unusable_docs}
            className="size-4 mt-0.5 accent-foreground"
          />
          <div className="space-y-1">
            <span className="text-sm font-medium">
              {t("firm_ai_rejection_label")}
            </span>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {t("firm_ai_rejection_help")}
            </p>
          </div>
        </label>
      </div>
      <div className="flex items-center gap-3 pt-2">
        <Button type="submit" disabled={pending}>
          {pending ? tc("saving") : tc("save")}
        </Button>
        {state?.ok && (
          <span className="text-xs text-muted-foreground">{t("saved")}</span>
        )}
        {state?.error && (
          <span className="text-xs text-destructive">
            {t("errors.save_failed")}
          </span>
        )}
      </div>
    </form>
  );
}
