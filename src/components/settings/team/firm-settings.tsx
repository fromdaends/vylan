"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { toast } from "sonner";
import { Lock } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { setClientsPrivateDefault } from "@/app/actions/team";

// Team Wave 4 — owner-only "Firm settings" section at the bottom of the team
// page. Firm-wide switches (starting with the privacy default). Enabling the
// privacy default also backfills every existing client to private.
export function FirmSettings({
  clientsPrivateByDefault,
}: {
  clientsPrivateByDefault: boolean;
}) {
  const t = useTranslations("Team");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [on, setOn] = useState(clientsPrivateByDefault);

  function toggle(next: boolean) {
    if (pending) return;
    setOn(next); // optimistic
    startTransition(async () => {
      const res = await setClientsPrivateDefault(next);
      if (res.ok) {
        router.refresh();
        if (next) toast.success(t("firm_private_default_enabled"));
      } else {
        setOn(!next); // revert
        toast.error(t("firm_private_default_failed"));
      }
    });
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold">{t("firm_settings_title")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("firm_settings_subtitle")}
        </p>
      </div>
      <div className="flex items-start gap-3 rounded-lg border border-border/60 bg-card/40 px-4 py-3">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Lock className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium">
              {t("firm_private_default_label")}
            </span>
            <Switch
              checked={on}
              onCheckedChange={toggle}
              disabled={pending}
              ariaLabel={t("firm_private_default_label")}
            />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("firm_private_default_help")}
          </p>
        </div>
      </div>
    </section>
  );
}
