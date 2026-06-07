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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  createClientAction,
  updateClientAction,
  type ClientFormState,
} from "@/app/actions/clients";
import type { Client } from "@/lib/db/clients";
import { PROVINCES, TIMEZONES, INDUSTRIES } from "@/lib/clients/fields";
import { emailChangeNeedsConfirm } from "./email-change";
import { Plus, Pencil } from "lucide-react";
import { toast } from "sonner";

type Props = {
  mode: "create" | "edit";
  locale: "fr" | "en";
  client?: Client;
  trigger?: React.ReactNode;
};

export function ClientFormDialog({ mode, locale, client, trigger }: Props) {
  const t = useTranslations("Clients");
  const tc = useTranslations("Common");
  const tAuth = useTranslations("Auth");
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const action = mode === "create" ? createClientAction : updateClientAction;
  const [state, formAction, pending] = useActionState<
    ClientFormState,
    FormData
  >(action, null);

  useEffect(() => {
    if (!state?.ok) return;
    // Defer to next tick so we don't synchronously setState during the
    // effect body — keeps react-hooks/set-state-in-effect happy.
    queueMicrotask(() => {
      setOpen(false);
      router.refresh();
      toast.success(mode === "create" ? t("created_toast") : t("saved_toast"));
    });
    // `mode` and `t` are constant for a mounted dialog, so they're
    // intentionally left out of the deps — success then fires exactly
    // once per save (in lockstep with the refresh), never on a re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, router]);

  // Changing a client's email is consequential — it's the address that
  // document-request links and reminders are sent to — so editing it
  // pauses for a deliberate confirmation before the save goes through.
  // Every other field saves without the extra step.
  //
  // Submission is driven manually (preventDefault, then dispatch the action
  // ourselves) rather than via the form's `action` attribute, so the email
  // guard can never be bypassed by a stray native submit.
  const formRef = useRef<HTMLFormElement>(null);
  const [emailConfirm, setEmailConfirm] = useState<{
    from: string;
    to: string;
  } | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    // Native field validation first (required name, email format).
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const nextEmail = String(data.get("email") ?? "");
    if (emailChangeNeedsConfirm(mode, client?.email, nextEmail)) {
      // Hold the save until confirmed. The fields are uncontrolled, so
      // Cancel just returns to the open editor with the pending email
      // still typed in — nothing is discarded.
      setEmailConfirm({
        from: (client?.email ?? "").trim(),
        to: nextEmail.trim(),
      });
      return;
    }
    formAction(data);
  }

  function confirmEmailChange() {
    const form = formRef.current;
    setEmailConfirm(null);
    if (form) formAction(new FormData(form));
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ??
          (mode === "edit" ? (
            <Button size="sm">
              <Pencil className="size-4" />
              {t("edit_client")}
            </Button>
          ) : (
            <Button size="sm">
              <Plus className="size-4" />
              {t("add_client")}
            </Button>
          ))}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? t("add_client") : t("edit_client")}
          </DialogTitle>
          <DialogDescription>
            {mode === "create" ? t("add_subtitle") : t("edit_subtitle")}
          </DialogDescription>
        </DialogHeader>
        <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
          <input type="hidden" name="__app_locale" value={locale} />
          {client && <input type="hidden" name="id" value={client.id} />}
          {state?.error && (
            <Alert variant="destructive">
              <AlertDescription>{t("save_error")}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="display_name">{t("field_name")}</Label>
            <Input
              id="display_name"
              name="display_name"
              defaultValue={client?.display_name}
              required
              minLength={2}
              maxLength={160}
              aria-invalid={Boolean(state?.fieldErrors?.display_name)}
            />
            {state?.fieldErrors?.display_name && (
              <p className="text-sm text-destructive">
                {tAuth(
                  `errors.${state.fieldErrors.display_name}` as const,
                )}
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="type">{t("field_type")}</Label>
              <Select name="type" defaultValue={client?.type ?? "individual"}>
                <SelectTrigger id="type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="individual">
                    {t("type_individual")}
                  </SelectItem>
                  <SelectItem value="business">
                    {t("type_business")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="locale">{t("field_locale")}</Label>
              <Select name="locale" defaultValue={client?.locale ?? "fr"}>
                <SelectTrigger id="locale" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fr">Français</SelectItem>
                  <SelectItem value="en">English</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="email">{t("field_email")}</Label>
              <Input
                id="email"
                name="email"
                type="email"
                defaultValue={client?.email ?? ""}
                aria-invalid={Boolean(state?.fieldErrors?.email)}
              />
              {state?.fieldErrors?.email && (
                <p className="text-sm text-destructive">
                  {tAuth(`errors.${state.fieldErrors.email}` as const)}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="phone">{t("field_phone")}</Label>
              <Input
                id="phone"
                name="phone"
                type="tel"
                defaultValue={client?.phone ?? ""}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="province">{t("field_province")}</Label>
              <Select name="province" defaultValue={client?.province ?? "none"}>
                <SelectTrigger id="province" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("field_unset")}</SelectItem>
                  {PROVINCES.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {locale === "fr" ? p.fr : p.en}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="timezone">{t("field_timezone")}</Label>
              <Select name="timezone" defaultValue={client?.timezone ?? "none"}>
                <SelectTrigger id="timezone" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("field_unset")}</SelectItem>
                  {TIMEZONES.map((tz) => (
                    <SelectItem key={tz.value} value={tz.value}>
                      {locale === "fr" ? tz.fr : tz.en}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="industry">{t("field_industry")}</Label>
            <Select name="industry" defaultValue={client?.industry ?? "none"}>
              <SelectTrigger id="industry" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("field_unset")}</SelectItem>
                {INDUSTRIES.map((ind) => (
                  <SelectItem key={ind.value} value={ind.value}>
                    {locale === "fr" ? ind.fr : ind.en}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="external_ref">{t("field_external_ref")}</Label>
            <Input
              id="external_ref"
              name="external_ref"
              defaultValue={client?.external_ref ?? ""}
              className="font-mono text-xs"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="notes">{t("field_notes")}</Label>
            <Textarea
              id="notes"
              name="notes"
              defaultValue={client?.notes ?? ""}
              rows={3}
            />
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
              {pending
                ? tc("saving")
                : mode === "create"
                  ? t("create")
                  : tc("save")}
            </Button>
          </DialogFooter>
        </form>

        {/* Deliberate confirmation for an email change — this address
            drives where document links + reminders are sent. Cancel
            returns to the open editor with the pending change intact. */}
        <Dialog
          open={emailConfirm !== null}
          onOpenChange={(o) => {
            if (!o) setEmailConfirm(null);
          }}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{t("email_confirm_title")}</DialogTitle>
              <DialogDescription>
                {t("email_confirm_desc", {
                  from: emailConfirm?.from || t("email_confirm_none"),
                  to: emailConfirm?.to || t("email_confirm_none"),
                })}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEmailConfirm(null)}
              >
                {tc("cancel")}
              </Button>
              <Button type="button" onClick={confirmEmailChange}>
                {t("email_confirm_confirm")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}
