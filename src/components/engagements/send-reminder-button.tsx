"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { BellRing, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { sendReminderAction } from "@/app/actions/engagements";

// The engagement header's "Send reminder" action. Fires the manual reminder
// email, then pops a checkmark toast so the accountant gets clear confirmation
// it actually went out (founder request). This replaces the old plain
// server-action form purely to add that client-side confirmation.
//
// The feedback has to be LOUD the moment it's clicked. The button is normally a
// 32px icon that only reveals its label on hover, so the earlier bare icon-swap
// spinner was too easy to miss — after clicking, the cursor usually moves away,
// the button collapses back to 32px, and all that's left is a tiny spinner
// (founder: "it's not clear it's being clicked, it takes a second to load").
// So while the send is in flight we PIN the button open — spinner + "Sending…"
// — regardless of where the cursor is, then confirm with the toast.
export function SendReminderButton({ engagementId }: { engagementId: string }) {
  const t = useTranslations("Engagements");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function send() {
    if (pending) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.set("id", engagementId);
      try {
        const res = await sendReminderAction(fd);
        if (res.ok) {
          toast.success(t("reminder_sent"));
          router.refresh();
        } else {
          toast.error(t("reminder_failed"));
        }
      } catch {
        toast.error(t("reminder_failed"));
      }
    });
  }

  // Default = collapsed 32px icon that expands on hover/focus. While pending we
  // apply the SAME expanded metrics unconditionally so the spinner + "Sending…"
  // are unmistakable even once the cursor has left the button.
  const shell = pending
    ? "w-40 gap-1.5 px-3"
    : "w-8 gap-0 px-0 hover:w-40 hover:gap-1.5 hover:px-3 focus-visible:w-40 focus-visible:gap-1.5 focus-visible:px-3";
  const label = pending
    ? "max-w-36 opacity-100"
    : "max-w-0 opacity-0 group-hover:max-w-36 group-hover:opacity-100 group-focus-visible:max-w-36 group-focus-visible:opacity-100";

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={send}
      disabled={pending}
      aria-busy={pending}
      aria-label={t("send_reminder")}
      title={t("send_reminder")}
      className={
        "group h-8 overflow-hidden transition-[width,padding,gap] duration-200 " +
        shell
      }
    >
      {pending ? (
        <Loader2 className="size-4 shrink-0 animate-spin" />
      ) : (
        <BellRing className="size-4 shrink-0" />
      )}
      <span
        className={
          "overflow-hidden whitespace-nowrap transition-[max-width,opacity] duration-200 " +
          label
        }
      >
        {pending ? t("sending_reminder") : t("send_reminder")}
      </span>
    </Button>
  );
}
