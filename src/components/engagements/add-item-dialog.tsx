"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
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
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Plus } from "lucide-react";
import { DocTypePicker } from "@/components/engagements/doc-type-picker";
import type { DocType } from "@/lib/db/templates";

export function AddItemDialog({
  engagementId,
  province,
}: {
  engagementId: string;
  // The engagement's client province — limits the doc-type picker to the
  // documents that apply there (no Quebec slips for an Ontario client).
  province?: string | null;
}) {
  const t = useTranslations("Engagements");
  const tc = useTranslations("Common");
  const router = useRouter();
  const [open, setOpen] = useState(false);

  // The label/description fields are UNCONTROLLED and read straight from the
  // form at submit time via FormData. This is deliberate: Safari autofill (and
  // some IME paths) set an input's value WITHOUT firing React's onChange, so a
  // controlled mirror could read empty while the box visibly shows text — which
  // is exactly the "fill in both labels even though they're filled" bug (it
  // only "worked" after ticking Required because that re-render synced state).
  // Reading the live DOM value sidesteps that entirely. doc_type stays
  // controlled (the picker needs it) and rides along via a hidden input.
  const [docType, setDocType] = useState<DocType>("other");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    setError(null);

    const formEl = e.currentTarget;
    const fd = new FormData(formEl);
    const label = String(fd.get("label") ?? "").trim();

    // Validate the REAL field value (typed or autofilled), not React state.
    if (!label) {
      setError(t("add_item_check_field"));
      return;
    }
    const description = String(fd.get("description") ?? "").trim();
    fd.set("label", label);
    fd.set("description", description);
    fd.set("doc_type", docType);

    setPending(true);
    try {
      // POST to a STABLE URL (not a Server Action) so a deploy/version mismatch
      // can't make the call fail before it reaches the server. The endpoint
      // returns { ok } | { fieldErrors, detail } | { error, detail }.
      const r = await fetch(`/api/engagements/${engagementId}/items`, {
        method: "POST",
        body: fd,
      });
      const res = (await r.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        detail?: string;
        fieldErrors?: Record<string, string>;
      } | null;
      if (res?.ok) {
        formEl.reset();
        setDocType("other");
        setOpen(false);
        // Toast confirms success even when the new row lands far down a long
        // checklist; the route revalidated the cache, refresh re-renders it.
        toast.success(t("item_added"));
        router.refresh();
      } else if (res?.detail) {
        // Raw server reason — so a hidden DB/RLS/validation error is visible.
        setError(res.detail);
      } else {
        setError(t("add_item_error"));
      }
    } catch {
      setError(t("add_item_error"));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // Radix unmounts the content on close, so the uncontrolled fields reset
        // themselves; just clear the bits that live in React state.
        if (!next) {
          setDocType("other");
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Plus className="size-4" />
          {t("add_item")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("add_item_title")}</DialogTitle>
          <DialogDescription>{t("add_item_subtitle")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          <input type="hidden" name="engagement_id" value={engagementId} />
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="label">{t("label_placeholder")}</Label>
            {/* One label, uncontrolled — read from the form at submit
                (autofill-safe). Stored for both client languages. */}
            <Input id="label" name="label" maxLength={200} autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="description">
              {t("description_placeholder")}
            </Label>
            <Textarea
              id="description"
              name="description"
              rows={2}
              maxLength={500}
            />
          </div>
          <div className="flex items-center gap-3 text-sm">
            <div className="space-y-1.5 flex-1">
              <Label htmlFor="doc_type">{t("doc_type")}</Label>
              <DocTypePicker
                id="doc_type"
                value={docType}
                onChange={setDocType}
                className="w-full"
                province={province}
              />
            </div>
            <label className="flex items-center gap-1.5 select-none cursor-pointer pt-5">
              <input type="checkbox" name="required" />
              {t("required")}
            </label>
          </div>
          {/* Optional per-item rules for the AI document checker. Uncontrolled,
              read from FormData at submit like the other fields. */}
          <div className="space-y-1.5">
            <Label htmlFor="ai_rules">{t("ai_rules_label")}</Label>
            <Textarea
              id="ai_rules"
              name="ai_rules"
              rows={2}
              maxLength={2000}
              placeholder={t("ai_rules_placeholder")}
            />
            <p className="text-xs text-muted-foreground leading-relaxed">
              {t("ai_rules_hint")}
            </p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              {pending ? tc("saving") : t("add_item")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
