"use client";

// Client-side actions for the Google Drive provider card: start OAuth,
// disconnect (with confirmation), and turn the callback's ?google= status
// flag into a toast. Owner-gated by the server routes; the buttons simply
// aren't rendered for non-owners.

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function GoogleConnectButton({
  variant = "default",
  label,
}: {
  variant?: "default" | "outline";
  label: string;
}) {
  const t = useTranslations("Filing");
  const [pending, setPending] = useState(false);

  async function connect() {
    setPending(true);
    try {
      const res = await fetch("/api/integrations/filing/google/connect", {
        method: "POST",
      });
      const json = (await res.json().catch(() => ({}))) as {
        url?: string;
        error?: string;
      };
      if (res.ok && json.url) {
        // Hand the browser to Google; the callback route brings us home.
        window.location.href = json.url;
        return;
      }
      toast.error(
        json.error === "not_configured" || json.error === "encryption_required"
          ? t("toast_error_not_configured")
          : json.error === "other_provider"
            ? t("toast_error_other_provider")
            : t("toast_error_generic"),
      );
    } catch {
      toast.error(t("toast_error_generic"));
    } finally {
      setPending(false);
    }
  }

  return (
    <Button variant={variant} size="sm" onClick={connect} disabled={pending}>
      {pending && <Loader2 className="animate-spin" />}
      {label}
    </Button>
  );
}

export function GoogleDisconnectButton() {
  const t = useTranslations("Filing");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function disconnect() {
    startTransition(async () => {
      try {
        const res = await fetch("/api/integrations/filing/google/disconnect", {
          method: "POST",
        });
        if (!res.ok) throw new Error(String(res.status));
        setOpen(false);
        toast.success(t("toast_disconnected"));
        router.refresh();
      } catch {
        toast.error(t("toast_error_generic"));
      }
    });
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        {t("action_disconnect")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("disconnect_title")}</DialogTitle>
            <DialogDescription>{t("disconnect_body")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              {t("cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={disconnect}
              disabled={pending}
            >
              {pending && <Loader2 className="animate-spin" />}
              {t("action_disconnect")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// Turns the OAuth callback's ?google=<flag> into a one-time toast, then
// strips the param so a refresh doesn't re-toast.
export function FilingStatusToasts() {
  const t = useTranslations("Filing");
  const router = useRouter();
  const params = useSearchParams();
  const fired = useRef(false);

  useEffect(() => {
    const flag = params.get("google");
    if (!flag || fired.current) return;
    fired.current = true;
    if (flag === "connected") {
      toast.success(t("toast_connected"));
    } else if (flag === "denied") {
      toast.error(t("toast_error_denied"));
    } else if (flag === "other_provider") {
      toast.error(t("toast_error_other_provider"));
    } else if (flag === "config") {
      toast.error(t("toast_error_not_configured"));
    } else {
      toast.error(t("toast_error_generic"));
    }
    router.replace("/integrations/filing", { scroll: false });
  }, [params, router, t]);

  return null;
}
