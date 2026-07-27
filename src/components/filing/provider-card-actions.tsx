"use client";

// Client-side actions shared by the LIVE provider cards (Google Drive,
// Microsoft): start OAuth, disconnect with confirmation, and turn the OAuth
// callbacks' ?google= / ?microsoft= status flags into toasts. Owner-gated by
// the server routes; the buttons simply aren't rendered for non-owners.

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

export function ProviderConnectButton({
  endpoint,
  label,
}: {
  /** POST endpoint returning { url } to hand the browser to. */
  endpoint: string;
  label: string;
}) {
  const t = useTranslations("Filing");
  const [pending, setPending] = useState(false);

  async function connect() {
    setPending(true);
    try {
      const res = await fetch(endpoint, { method: "POST" });
      const json = (await res.json().catch(() => ({}))) as {
        url?: string;
        error?: string;
      };
      if (res.ok && json.url) {
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
    <Button size="sm" onClick={connect} disabled={pending}>
      {pending && <Loader2 className="animate-spin" />}
      {label}
    </Button>
  );
}

export function ProviderDisconnectButton({
  endpoint,
  providerName,
}: {
  endpoint: string;
  providerName: string;
}) {
  const t = useTranslations("Filing");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function disconnect() {
    startTransition(async () => {
      try {
        const res = await fetch(endpoint, { method: "POST" });
        if (!res.ok) throw new Error(String(res.status));
        setOpen(false);
        toast.success(t("toast_disconnected_p", { provider: providerName }));
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
            <DialogTitle>
              {t("disconnect_title_p", { provider: providerName })}
            </DialogTitle>
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

// Turns the OAuth callbacks' ?google=<flag> / ?microsoft=<flag> into a
// one-time toast, then strips the param so a refresh doesn't re-toast.
// Microsoft's "choose" flag is deliberately NOT handled here — the
// destination picker owns it (it auto-opens and clears the param itself).
export function FilingStatusToasts() {
  const t = useTranslations("Filing");
  const router = useRouter();
  const params = useSearchParams();
  const fired = useRef(false);

  useEffect(() => {
    const google = params.get("google");
    const microsoft = params.get("microsoft");
    const dropbox = params.get("dropbox");
    const flag = google ?? microsoft ?? dropbox;
    if (!flag || fired.current) return;
    if (microsoft === "choose") return; // the picker's cue, not a toast
    fired.current = true;
    const provider = google
      ? "Google Drive"
      : microsoft
        ? "SharePoint / OneDrive"
        : "Dropbox";
    if (flag === "connected") {
      toast.success(t("toast_connected_p", { provider }));
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
