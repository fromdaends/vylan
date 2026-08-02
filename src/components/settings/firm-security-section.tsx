"use client";

// The firm's half of Settings → Security.
//
// Everything above it on that page is about YOU — your two-step verification,
// your sign-in. This is about the firm, and it is the page a client's auditor
// asks to see. It is owner-only: the settings here decide what other people may
// do, so deciding them cannot be one of the things other people may do.
//
// One setting today, deliberately. The plan named four — who may invite,
// require two-step verification, email-domain auto-join, session length — and
// only the first is shipped here because only the first is fully enforced end
// to end. A switch under a Security heading that half-works is worse than a
// heading with one switch under it.

import { useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { setInvitePolicy } from "@/app/actions/team";

export function FirmSecuritySection({
  invitePolicy,
}: {
  invitePolicy: "owner" | "members";
}) {
  const t = useTranslations("Settings");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [policy, setPolicy] = useState(invitePolicy);

  function choose(next: "owner" | "members") {
    if (next === policy || pending) return;
    const previous = policy;
    // Optimistic: the radio moves under the cursor, and puts itself back if the
    // server disagrees. A security control that lags feels broken, and a
    // security control that lies is worse — so it does both halves.
    setPolicy(next);
    startTransition(async () => {
      const res = await setInvitePolicy(next);
      if (!res.ok) {
        setPolicy(previous);
        toast.error(
          res.error === "unavailable"
            ? t("security_invite_unavailable")
            : t("security_invite_failed"),
        );
        return;
      }
      toast.success(t("security_invite_saved"));
      router.refresh();
    });
  }

  return (
    <section>
      <h2 className="text-sm font-semibold">{t("security_firm_title")}</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        {t("security_firm_hint")}
      </p>

      <fieldset className="mt-4 max-w-xl">
        <legend className="text-sm font-medium">
          {t("security_invite_legend")}
        </legend>
        <div className="mt-3 space-y-2">
          <Choice
            name="invite_policy"
            checked={policy === "owner"}
            onSelect={() => choose("owner")}
            disabled={pending}
            label={t("security_invite_owner")}
            hint={t("security_invite_owner_hint")}
          />
          <Choice
            name="invite_policy"
            checked={policy === "members"}
            onSelect={() => choose("members")}
            disabled={pending}
            label={t("security_invite_members")}
            hint={t("security_invite_members_hint")}
          />
        </div>
      </fieldset>
    </section>
  );
}

function Choice({
  name,
  checked,
  onSelect,
  disabled,
  label,
  hint,
}: {
  name: string;
  checked: boolean;
  onSelect: () => void;
  disabled: boolean;
  label: string;
  hint: string;
}) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
        checked
          ? "border-border bg-secondary/40"
          : "border-transparent hover:bg-muted/40"
      } ${disabled ? "opacity-60" : ""}`}
    >
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onSelect}
        disabled={disabled}
        className="mt-1 shrink-0"
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">
          {hint}
        </span>
      </span>
    </label>
  );
}
