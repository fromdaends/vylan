"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { toast } from "sonner";
import { Lock, BellRing, ClipboardCheck } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { setClientsPrivateDefault, setFirmTeamFlag } from "@/app/actions/team";

// Team Wave 4 — the owner-only team firm settings. ONE reusable block rendered
// in both places: Settings → Team, and the team page's ⋯ "Firm settings" dialog.
// Each row is an optimistic Switch backed by an owner-gated server action.

function ToggleRow({
  icon,
  label,
  help,
  checked,
  disabled,
  onToggle,
}: {
  icon: ReactNode;
  label: string;
  help: string;
  checked: boolean;
  disabled: boolean;
  onToggle: (next: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border/60 bg-card/40 px-4 py-3">
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium">{label}</span>
          <Switch
            checked={checked}
            onCheckedChange={onToggle}
            disabled={disabled}
            ariaLabel={label}
          />
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{help}</p>
      </div>
    </div>
  );
}

export function TeamSettings({
  clientsPrivateByDefault,
  notifyOnAssignment,
  requireReviewSignoff,
}: {
  clientsPrivateByDefault: boolean;
  notifyOnAssignment: boolean;
  requireReviewSignoff: boolean;
}) {
  const t = useTranslations("Team");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [priv, setPriv] = useState(clientsPrivateByDefault);
  const [notify, setNotify] = useState(notifyOnAssignment);
  const [signoff, setSignoff] = useState(requireReviewSignoff);

  // Shared optimistic runner: flip local state now, call the action, revert +
  // toast on failure. `onEnabled` fires a success toast only when turning ON.
  function run(
    setLocal: (v: boolean) => void,
    next: boolean,
    call: () => Promise<{ ok: boolean; error?: string }>,
    onEnabled?: () => void,
  ) {
    if (pending) return;
    setLocal(next);
    startTransition(async () => {
      const res = await call();
      if (res.ok) {
        router.refresh();
        if (next) onEnabled?.();
      } else {
        setLocal(!next);
        toast.error(
          res.error === "unavailable"
            ? t("firm_private_default_unavailable")
            : t("firm_private_default_failed"),
        );
      }
    });
  }

  return (
    <div className="space-y-3">
      <ToggleRow
        icon={<Lock className="size-4" aria-hidden="true" />}
        label={t("firm_private_default_label")}
        help={t("firm_private_default_help")}
        checked={priv}
        disabled={pending}
        onToggle={(next) =>
          run(setPriv, next, () => setClientsPrivateDefault(next), () =>
            toast.success(t("firm_private_default_enabled")),
          )
        }
      />
      <ToggleRow
        icon={<BellRing className="size-4" aria-hidden="true" />}
        label={t("notify_assignment_label")}
        help={t("notify_assignment_help")}
        checked={notify}
        disabled={pending}
        onToggle={(next) =>
          run(setNotify, next, () =>
            setFirmTeamFlag("notify_on_assignment", next),
          )
        }
      />
      <ToggleRow
        icon={<ClipboardCheck className="size-4" aria-hidden="true" />}
        label={t("signoff_label")}
        help={t("signoff_help")}
        checked={signoff}
        disabled={pending}
        onToggle={(next) =>
          run(setSignoff, next, () =>
            setFirmTeamFlag("require_review_signoff", next),
          )
        }
      />
    </div>
  );
}
