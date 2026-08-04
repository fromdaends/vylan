"use client";

// "Save as template" — the one place Vylan deliberately goes past the reference.
//
// Canopy does NOT have this: their create flow ends at Save as draft / Save and
// send, and engagement templates are only built from scratch under Templates.
// Verified from their own docs. The founder wanted it anyway — "Create the save
// as template button why not. 1 step at a time getting better than canopy" —
// and they are right that it is the obvious moment: you have just decided what
// this kind of work looks like, and that is exactly when you know it.
//
// It saves a SHAPE, not this engagement. The client is deliberately left out —
// a template is a kind of work, not a kind of work for one person.

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { saveEngagementAsTemplateAction } from "@/app/actions/engagement-templates";
import type { EngagementTemplatePayload } from "@/lib/engagements/template-payload";

export function SaveAsTemplateDialog({
  open,
  onOpenChange,
  /** Built fresh when the dialog opens, so it reflects the CURRENT form. */
  payload,
  suggestedName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payload: EngagementTemplatePayload;
  suggestedName: string;
}) {
  const t = useTranslations("Engagements");
  const [name, setName] = useState(suggestedName);
  const [access, setAccess] = useState<"team" | "private">("team");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (busy || name.trim() === "") return;
    setBusy(true);
    try {
      const res = await saveEngagementAsTemplateAction({
        name: name.trim(),
        access,
        payload,
      });
      if (res.ok) {
        toast.success(t("save_template_saved"));
        onOpenChange(false);
        return;
      }
      toast.error(
        res.needsMigration
          ? t("save_template_needs_migration")
          : res.error === "empty"
            ? t("save_template_empty")
            : t("save_template_failed"),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        // Re-seed the name each time it opens: the title may have changed since
        // the last time, and a stale suggestion is worse than none.
        if (o) setName(suggestedName);
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("save_template_title")}</DialogTitle>
          <DialogDescription>{t("save_template_hint")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="tpl-name">{t("save_template_name")}</Label>
            <Input
              id="tpl-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("save_template_name_placeholder")}
              className="mt-1"
              autoFocus
            />
          </div>

          <div>
            <Label htmlFor="tpl-access">{t("save_template_access")}</Label>
            <select
              id="tpl-access"
              value={access}
              onChange={(e) =>
                setAccess(e.target.value === "private" ? "private" : "team")
              }
              className="mt-1 h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {/* Firm-wide first: a template nobody else can use is the rarer
                  intention, and it is the one worth choosing deliberately. */}
              <option value="team">{t("save_template_access_team")}</option>
              <option value="private">
                {t("save_template_access_private")}
              </option>
            </select>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {t("services_cancel")}
          </Button>
          <Button
            type="button"
            onClick={save}
            disabled={busy || name.trim() === ""}
          >
            {t("save_template_save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
