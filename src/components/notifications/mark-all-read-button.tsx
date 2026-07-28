"use client";

import { useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { CheckCheck } from "lucide-react";
import { markAllNotificationsReadAction } from "@/app/actions/notifications";

// Server-rendered page, so this refreshes rather than holding local state — the
// list, the filter counts and the header badge all come from the server and
// must move together.
export function MarkAllReadButton({ label }: { label: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await markAllNotificationsReadAction();
          router.refresh();
        })
      }
      className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50"
    >
      <CheckCheck className="h-3.5 w-3.5" aria-hidden />
      {label}
    </button>
  );
}
