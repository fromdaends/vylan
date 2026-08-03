"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { toast } from "sonner";
import {
  MoreHorizontal,
  Lock,
  LockOpen,
  Archive,
  ArchiveRestore,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { setClientPrivacyAction } from "@/app/actions/clients";

// The client page's ⋯ menu: the actions that matter but shouldn't hold a
// button in the header all day — archive/restore, and (owner + team mode) the
// per-client privacy override. The privacy item is gated by the caller AND by
// the server action + RLS; showPrivacy only decides whether to draw it.
export function ClientActionsMenu({
  clientId,
  isPrivate,
  showPrivacy = true,
  archive,
}: {
  clientId: string;
  isPrivate: boolean;
  showPrivacy?: boolean;
  // Submits a <form> the server component renders outside this menu — a form
  // can't live inside a dropdown item, but a button can point at one by id.
  archive?: { formId: string; archived: boolean };
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
        {showPrivacy && (
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              togglePrivacy();
            }}
          >
            {priv ? <LockOpen /> : <Lock />}
            <span>{priv ? t("make_public") : t("make_private")}</span>
          </DropdownMenuItem>
        )}
        {showPrivacy && archive && <DropdownMenuSeparator />}
        {archive && (
          <DropdownMenuItem
            onSelect={() => {
              // A plain <button form="..."> does NOT work here: closing the
              // menu unmounts the button before the browser performs the
              // click's default action, so the submit is silently dropped.
              // Submitting the form ourselves is the only reliable path.
              const form = document.getElementById(archive.formId);
              if (form instanceof HTMLFormElement) form.requestSubmit();
            }}
          >
            {archive.archived ? <ArchiveRestore /> : <Archive />}
            <span>{archive.archived ? t("restore") : t("archive")}</span>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
