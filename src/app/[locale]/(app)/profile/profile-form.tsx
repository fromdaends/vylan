"use client";

import { useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Check } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import {
  updateAvatarAction,
  removeAvatarAction,
  updateDisplayNameAction,
  type ProfileActionResult,
} from "@/app/actions/profile";

type ProfileUser = {
  id: string;
  email: string;
  name: string;
  display_name: string | null;
};

// /profile keeps the personal basics: photo + display name. Email, Password,
// and Two-factor live in Settings → Security; the subscription summary lives
// in Settings → Billing.
export function ProfileForm({
  user,
  displayLabel,
  brandColor,
  avatarUrl,
}: {
  user: ProfileUser;
  displayLabel: string;
  brandColor: string;
  avatarUrl: string | null;
}) {
  const t = useTranslations("Profile");
  const tc = useTranslations("Common");

  return (
    <div className="space-y-12">
      <AvatarSection
        avatarUrl={avatarUrl}
        displayLabel={displayLabel}
        firmBrandColor={brandColor}
        t={t}
        tc={tc}
      />
      <DisplayNameSection
        current={user.display_name ?? ""}
        placeholder={user.name}
        t={t}
        tc={tc}
      />
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
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(current);
  // The last SAVED value — the Save button lights up only while the field
  // differs from it, and it advances on a successful save.
  const [baseline, setBaseline] = useState(current);
  const [justSaved, setJustSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = value.trim() !== baseline.trim();

  function save() {
    setError(null);
    if (!dirty || pending) return;
    const next = value.trim();
    const fd = new FormData();
    fd.append("display_name", next);
    startTransition(async () => {
      const res = await updateDisplayNameAction(fd);
      if (!res.ok) {
        setError(t(`errors.${res.error}`) || tc("loading"));
        return;
      }
      setValue(next);
      setBaseline(next);
      setJustSaved(true);
      toast.success(t("name_saved"));
      // Push the new name to every surface that shows it (sidebar, roster,
      // assignee, comments, activity) without a manual reload.
      router.refresh();
    });
  }

  return (
    <section>
      <h2 className="text-sm font-semibold">{t("section_name")}</h2>
      <p className="text-xs text-muted-foreground mt-1">
        {t("section_name_hint")}
      </p>
      <div className="mt-4 flex max-w-sm items-start gap-2">
        <div className="flex-1">
          <Label htmlFor="display_name" className="sr-only">
            {t("section_name")}
          </Label>
          <Input
            id="display_name"
            name="display_name"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setJustSaved(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                save();
              }
            }}
            placeholder={placeholder || t("name_placeholder")}
            disabled={pending}
          />
          {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
        </div>
        <Button
          type="button"
          onClick={save}
          disabled={!dirty || pending}
          className="shrink-0"
        >
          {pending ? (
            tc("loading")
          ) : justSaved && !dirty ? (
            <>
              <Check className="size-4" />
              {t("saved")}
            </>
          ) : (
            t("save")
          )}
        </Button>
      </div>
    </section>
  );
}
