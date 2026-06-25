"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { CheckCheck, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

// "Approve all ready" (Stage 4, Phase 4). Approves every READY draft in the
// current view (optionally scoped to the selected client) in one server request,
// behind a confirm. Renders nothing when there's nothing ready. Still READ-ONLY
// on QuickBooks; each approval can be reopened individually.
export function ApproveReadyButton({
  readyCount,
  client,
}: {
  readyCount: number;
  // The active client filter (null = all clients), passed to the endpoint so the
  // bulk action matches exactly what the queue is showing.
  client: string | null;
}) {
  const t = useTranslations("Quickbooks");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  if (readyCount <= 0) return null;

  async function run() {
    setFailed(false);
    setPending(true);
    try {
      const r = await fetch("/api/quickbooks/suggestions/approve-ready", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ client }),
      });
      const res = (await r.json().catch(() => null)) as { ok?: boolean } | null;
      if (r.ok && res?.ok) {
        setOpen(false);
        router.refresh();
      } else {
        setFailed(true);
      }
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setFailed(false);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary" className="gap-1.5">
          <CheckCheck className="h-4 w-4" aria-hidden="true" />
          {t("approve_ready", { count: readyCount })}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("approve_ready_title")}</DialogTitle>
          <DialogDescription>
            {t("approve_ready_confirm", { count: readyCount })}
          </DialogDescription>
        </DialogHeader>
        {failed && (
          <p role="alert" className="text-sm text-warning">
            {t("approve_ready_failed")}
          </p>
        )}
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            {t("approve_ready_cancel")}
          </Button>
          <Button onClick={run} disabled={pending} className="gap-1.5">
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <CheckCheck className="h-4 w-4" aria-hidden="true" />
            )}
            {t("approve_ready_go", { count: readyCount })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
