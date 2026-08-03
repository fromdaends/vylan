"use client";

// The client's name, with a dropdown — the same object as the firm name.
//
// The founder's instruction was literal: "the same process of the down arrow,
// that should exist on the client page with the exact same process that it is
// on the member's page. So literally do the exact same thing." So this shares
// NameMenu with FirmMenu and only supplies its own items.
//
// It replaces BOTH the pen beside the name and the "⋯" in the corner. Those
// were two anonymous controls for one question — what can I do to this client —
// which is exactly the shape the firm page just got rid of.

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import {
  Archive,
  ArchiveRestore,
  FolderOpen,
  Pencil,
  ScrollText,
  Users,
} from "lucide-react";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { NameMenu } from "@/components/ui/name-menu";
import { ClientFormDialog } from "@/components/clients/client-form-dialog";
import { clientTabHref } from "@/lib/clients/tabs";
import type { Client } from "@/lib/db/clients";

export function ClientNameMenu({
  client,
  locale,
  canManage,
  isOwner,
  /** Submits the archive/restore <form> the page renders outside the menu — a
   *  form cannot be a dropdown item, but a button can point at one by id. */
  archiveFormId,
}: {
  client: Client;
  locale: "fr" | "en";
  canManage: boolean;
  isOwner: boolean;
  archiveFormId: string;
}) {
  const t = useTranslations("Clients");
  const [editOpen, setEditOpen] = useState(false);
  const archived = client.archived_at != null;

  return (
    <>
      <NameMenu
        name={client.display_name}
        label={t("more_actions")}
        enabled={canManage}
        className="text-2xl"
      >
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            setEditOpen(true);
          }}
          className="gap-2"
        >
          <Pencil className="size-4" aria-hidden />
          {t("edit_client")}
        </DropdownMenuItem>
        {/* Two destinations that were only reachable by finding the right tab
            first. They are things you DO to this client, so they belong with
            the rest of them. */}
        <DropdownMenuItem asChild className="gap-2">
          <Link href={clientTabHref(client.id, "organizers")}>
            <Users className="size-4" aria-hidden />
            {t("tab_organizers")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className="gap-2">
          <Link href={`/clients/${client.id}/archive`}>
            <FolderOpen className="size-4" aria-hidden />
            {t("tab_files")}
          </Link>
        </DropdownMenuItem>
        {/* Owner-only, matching the audit log's own gate — offering it to
            somebody who would land on a 404 is worse than not offering it. */}
        {isOwner && (
          <DropdownMenuItem asChild className="gap-2">
            <Link href={`/settings/audit?client=${client.id}`}>
              <ScrollText className="size-4" aria-hidden />
              {t("menu_activity")}
            </Link>
          </DropdownMenuItem>
        )}
        {/* The two privacy items that used to sit here are GONE. Who can
            see a client is decided by its Organizers list now, so
            "Make visible to staff" and "Let the whole firm see it exists"
            were two more answers to a question that already has one —
            the founder's word for them was redundant, and it was right. */}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            // A plain <button form="..."> does NOT work here: closing the menu
            // unmounts the button before the browser performs the click's
            // default action, so the submit is silently dropped. Submitting the
            // form ourselves is the only reliable path.
            const form = document.getElementById(archiveFormId);
            if (form instanceof HTMLFormElement) form.requestSubmit();
          }}
          className="gap-2"
        >
          {archived ? (
            <ArchiveRestore className="size-4" aria-hidden />
          ) : (
            <Archive className="size-4" aria-hidden />
          )}
          {archived ? t("restore") : t("archive")}
        </DropdownMenuItem>
      </NameMenu>

      {/* Controlled: a DialogTrigger inside a dropdown item never fires,
          because selecting the item unmounts it first. */}
      <ClientFormDialog
        mode="edit"
        locale={locale}
        client={client}
        open={editOpen}
        onOpenChange={setEditOpen}
      />
    </>
  );
}
