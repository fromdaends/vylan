"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { toast } from "sonner";
import { MoreHorizontal, Lock, LockOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { setClientPrivacyAction } from "@/app/actions/clients";

// Team Wave 4 — the per-client privacy override, tucked into a subtle 3-dots
// menu on the client page (not a big card). Owner-only in team mode; the caller
// gates rendering, and the server action + RLS enforce it regardless. The
// firm-wide default lives in Team > Firm settings; this is the per-client
// exception (share a private client with staff, or hide a shared one).
export function ClientActionsMenu({
  clientId,
  isPrivate,
}: {
  clientId: string;
  isPrivate: boolean;
}) {
  const t = useTranslations("Clients");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [priv, setPriv] = useState(isPrivate);

  function togglePrivacy() {
    const next = !priv;
    setPriv(next); // optimistic
    startTransition(async () => {
      const res = await setClientPrivacyAction(clientId, next);
      if (res.ok) {
        router.refresh();
      } else {
        setPriv(!next); // revert
        if (res.error === "unavailable") toast.info(t("private_unavailable"));
        else toast.error(t("private_failed"));
      }
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending}
          aria-label={t("more_actions")}
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            togglePrivacy();
          }}
          className="gap-2"
        >
          {priv ? (
            <LockOpen className="size-3.5" />
          ) : (
            <Lock className="size-3.5" />
          )}
          <span>{priv ? t("make_public") : t("make_private")}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
