"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  addSignatureItemAction,
  finalizeSignaturePlacementAction,
  type SignatureActionState,
} from "@/app/actions/signatures";
import { openSignWellSession } from "@/components/signwell/embed-loader";
import { PenLine, Upload, Loader2 } from "lucide-react";

export function AddSignatureDialog({ engagementId }: { engagementId: string }) {
  const t = useTranslations("Engagements");
  const tc = useTranslations("Common");
  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  // "form" = filling the dialog; "placing" = briefly, while the SignWell
  // field-placement editor is being opened. Once it's open we close this whole
  // dialog (so it doesn't sit on top of the editor), so "placing" is only ever
  // shown for the moment between submit and the editor appearing. "place
  // anywhere" mode only.
  const [phase, setPhase] = useState<"form" | "placing">("form");
  const fileRef = useRef<HTMLInputElement>(null);
  // Guards against opening the editor twice for the same result (React strict
  // mode double-invokes effects in dev).
  const openedRef = useRef<string | null>(null);
  const router = useRouter();
  const [state, action, pending] = useActionState<
    SignatureActionState,
    FormData
  >(addSignatureItemAction, null);

  useEffect(() => {
    if (!state?.ok) return;

    const close = () => {
      setOpen(false);
      setFileName(null);
      setPhase("form");
      router.refresh();
    };

    const editUrl = state.editUrl;
    const itemId = state.itemId;

    // Fallback mode (auto signature page): the request is already sent — just
    // close and refresh, exactly as before.
    if (!editUrl || !itemId) {
      queueMicrotask(close);
      return;
    }

    // "Place anywhere" mode: open SignWell's editor so the accountant positions
    // the signature field, then finalize (which sends it + notifies the client).
    if (openedRef.current === itemId) return;
    openedRef.current = itemId;
    setPhase("placing");
    void (async () => {
      try {
        await openSignWellSession({
          url: editUrl,
          onCompleted: async () => {
            try {
              await finalizeSignaturePlacementAction(itemId);
            } catch {
              // Best-effort: the webhook/reconcile still self-heal, and the
              // refresh below shows the true status.
            }
            close();
          },
          // Closed without finishing: leave the draft pending — the engagement
          // row offers "Finish placing signature" to resume.
          onClosed: () => close(),
          onError: () => close(),
        });
        // The SignWell editor is now open and covers the page. Close our own
        // dialog so its "opening…" card doesn't sit on top of the editor (our
        // dialog stacks above SignWell's overlay). The completed/closed callbacks
        // above still fire — this component stays mounted while it's closed.
        setOpen(false);
        setFileName(null);
      } catch {
        // Couldn't open the editor (script/network) — leave the draft pending so
        // it can be resumed from the row.
        close();
      }
    })();
  }, [state, router]);

  const busy = pending || phase !== "form";

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        // Don't let a stray click dismiss the dialog while the editor is opening.
        if (!o && phase !== "form") return;
        setOpen(o);
        if (!o) setFileName(null);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <PenLine className="size-4" />
          {t("request_signature")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("request_signature_title")}</DialogTitle>
          <DialogDescription>
            {t("request_signature_subtitle")}
          </DialogDescription>
        </DialogHeader>

        {phase !== "form" ? (
          <div className="flex items-center gap-3 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
            <span>{t("sig_placement_opening")}</span>
          </div>
        ) : (
          <form action={action} className="space-y-3">
            <input type="hidden" name="engagement_id" value={engagementId} />
            {state?.error && (
              <Alert variant="destructive">
                <AlertDescription>
                  {t(state.error === "file" ? "sig_err_file" : "sig_err_generic")}
                </AlertDescription>
              </Alert>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="sig_label_fr">{t("label_fr_placeholder")}</Label>
                <Input
                  id="sig_label_fr"
                  name="label_fr"
                  required
                  maxLength={200}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sig_label_en">{t("label_en_placeholder")}</Label>
                <Input
                  id="sig_label_en"
                  name="label_en"
                  required
                  maxLength={200}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sig_file">{t("signing_document")}</Label>
              <input
                ref={fileRef}
                id="sig_file"
                type="file"
                name="file"
                required
                accept="application/pdf"
                className="hidden"
                onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
              />
              <Button
                type="button"
                variant="outline"
                className="w-full justify-start font-normal"
                onClick={() => fileRef.current?.click()}
              >
                <Upload className="size-4 shrink-0" />
                <span className="truncate">
                  {fileName ?? t("choose_document")}
                </span>
              </Button>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setOpen(false)}
                disabled={busy}
              >
                {tc("cancel")}
              </Button>
              <Button type="submit" disabled={busy}>
                {pending ? tc("saving") : t("request_signature")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
