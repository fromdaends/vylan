"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { toast } from "sonner";
import { Lock } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { setClientPrivacyAction } from "@/app/actions/clients";

// Team Wave 4 — owner-only "Private to me" toggle on the client detail page.
// Flipping it on hides this client (and its engagements, files, messages,
// comments, drafts, activity) from STAFF while keeping it visible to all owners.
// The caller renders this ONLY for owners in team mode; the server action +
// RLS enforce that regardless. Optimistic, reverts on failure.
export function ClientPrivacyToggle({
  clientId,
  initialPrivate,
}: {
  clientId: string;
  initialPrivate: boolean;
}) {
  const t = useTranslations("Clients");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [isPrivate, setIsPrivate] = useState(initialPrivate);

  function onToggle(next: boolean) {
    if (pending) return;
    setIsPrivate(next); // optimistic
    startTransition(async () => {
      const res = await setClientPrivacyAction(clientId, next);
      if (res.ok) {
        router.refresh();
      } else {
        setIsPrivate(!next); // revert
        if (res.error === "unavailable") {
          toast.info(t("private_unavailable"));
        } else {
          toast.error(t("private_failed"));
        }
      }
    });
  }

  return (
    <div className="flex items-start gap-3 rounded-lg border border-border/60 bg-card/40 px-3 py-2.5">
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Lock className="size-3.5" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium">{t("private_label")}</span>
          <Switch
            checked={isPrivate}
            onCheckedChange={onToggle}
            disabled={pending}
            ariaLabel={t("private_label")}
          />
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{t("private_help")}</p>
      </div>
    </div>
  );
}
