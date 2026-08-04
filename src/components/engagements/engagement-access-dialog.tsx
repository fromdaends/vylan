"use client";

// "Let someone see just this job", in the header's "..." menu.
//
// Founder: "hide this somewhere more subtle. it doesnt deserve to be on the
// main page." It was a row of chips and a button sitting under the title — a
// rare, deliberate act wearing the clothes of a daily control.
//
// ⚠️ THIS IS THE OTHER HALF OF THAT CHANGE, AND THE HALF THAT MATTERS. Hiding
// the row without giving it a new door left granting access on a job with no
// guests unreachable. Deleting the entry point is the fatal half of moving a
// feature; this is the door.
//
// ── WHY A DIALOG FROM A MENU ITEM, AND WHY IT NEEDS THE preventDefault ─────
//
// Radix unmounts a dropdown's content when the menu closes. A dialog rendered
// as a plain child of a DropdownMenuItem therefore dies the instant the item is
// chosen, and nothing opens. ReminderAutomationDialog in this same menu already
// solved it: the dialog owns the item as its `trigger`, and the item calls
// preventDefault on select so the menu does not close underneath it.
//
// Copied deliberately rather than reinvented — and NOT the page-level `?panel=`
// route the invoice dialog uses, because that exists so Billing can deep-link
// in from OUTSIDE the menu. Nothing links to this from elsewhere.

import { type ReactNode } from "react";
import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  EngagementAccess,
  type AccessPerson,
} from "@/components/engagements/engagement-access";

export function EngagementAccessDialog({
  engagementId,
  guests,
  candidates,
  trigger,
}: {
  engagementId: string;
  guests: AccessPerson[];
  candidates: AccessPerson[];
  trigger: ReactNode;
}) {
  const t = useTranslations("Engagements");
  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("access_dialog_title")}</DialogTitle>
          {/* Says what this actually does, because "access" on an engagement
              could mean three different things and the wrong guess here hands
              someone a client's papers. */}
          <DialogDescription>{t("access_hint")}</DialogDescription>
        </DialogHeader>
        {/* The SAME component the page rendered, unchanged. It moved rooms; it
            did not become a second implementation of who-can-see-this. */}
        <EngagementAccess
          engagementId={engagementId}
          guests={guests}
          candidates={candidates}
        />
      </DialogContent>
    </Dialog>
  );
}
