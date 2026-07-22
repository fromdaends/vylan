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
// server-action form purely to add that client-side confirmation — same
// icon-only, expand-on-hover outline button as before.
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

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={send}
      disabled={pending}
      aria-label={t("send_reminder")}
      title={t("send_reminder")}
      className="group h-8 w-8 gap-0 overflow-hidden px-0 transition-[width,padding,gap] duration-200 hover:w-40 hover:gap-1.5 hover:px-3 focus-visible:w-40 focus-visible:gap-1.5 focus-visible:px-3"
    >
      {pending ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <BellRing className="size-4" />
      )}
      <span className="max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-[max-width,opacity] duration-200 group-hover:max-w-36 group-hover:opacity-100 group-focus-visible:max-w-36 group-focus-visible:opacity-100">
        {t("send_reminder")}
      </span>
    </Button>
  );
}
