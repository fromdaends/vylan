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
import {
  ClientTeamEditor,
  type TeamRow,
} from "@/components/clients/client-team-editor";
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
  updateClientAvatarAction,
  removeClientAvatarAction,
  type ClientFormState,
} from "@/app/actions/clients";
import type { Client } from "@/lib/db/clients";
import {
  PROVINCES,
  TIMEZONES,
  INDUSTRIES,
  timezoneForProvince,
} from "@/lib/clients/fields";
import { SearchableSelect } from "./searchable-select";
import { emailChangeNeedsConfirm } from "./email-change";
import { Plus, Pencil } from "lucide-react";
import { toast } from "sonner";
import { AvatarPicker } from "@/components/ui/avatar-picker";

type Props = {
  mode: "create" | "edit";
  locale: "fr" | "en";
  client?: Client;
  /** A SIGNED URL for the client's existing picture, minted by the server that
   *  renders this (clients.avatar_path stores a path, and only the server can
   *  sign it). Omitted simply means the picker starts on initials — which is
   *  also the correct state for a client who has no picture. */
  avatarUrl?: string | null;
  trigger?: React.ReactNode;
  /** Active teammates, for the create-time team picker. Empty in a solo firm,
   *  which hides the control entirely. */
  teammates?: { id: string; name: string }[];
  /** Opens on FIRST render only — for arriving from a link that means "make one
   *  now" (the rail's Create panel sends ?new=1). Unlike `open` it does not
   *  fight the user: once closed it stays closed. */
  defaultOpen?: boolean;
  /** Controlled mode. Pass both to open this from somewhere that cannot host a
   *  trigger — a dropdown item, for instance: the menu unmounts the item on
   *  select, so a DialogTrigger inside one never gets to fire. */
  open?: boolean;
  onOpenChange?: (next: boolean) => void;
};

export function ClientFormDialog({
  mode,
  locale,
  client,
  avatarUrl,
  trigger,
  teammates = [],
  defaultOpen = false,
  open: openProp,
  onOpenChange,
}: Props) {
  const t = useTranslations("Clients");
  const tc = useTranslations("Common");
  const tAuth = useTranslations("Auth");
  const controlled = openProp !== undefined;
  // Seeded rather than forced — see AddTaskDialog. The rail's Create panel
  // links here with ?new=1 and expects the form already open.
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const open = controlled ? openProp : uncontrolledOpen;
  const setOpen = (next: boolean) => {
    if (!controlled) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };
  // Province + timezone are controlled so picking a province auto-fills the
  // timezone (timezone stays editable for the rare multi-zone override).
  const [province, setProvince] = useState(client?.province ?? "none");
  const [timezone, setTimezone] = useState(client?.timezone ?? "none");
  // Who else works on this, chosen at creation. You are always on it — the
  // server adds the creator regardless — so this only ever covers OTHER people,
  // which is why the picker does not list you.
  //
  // Draft rows: nothing is saved until the form is submitted, because there is
  // no client to attach anybody to yet. Same editor the client page uses, in
  // its draft mode.
  const [team, setTeam] = useState<TeamRow[]>([]);
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
      {/* No trigger at all in controlled mode — whoever owns `open` owns the
          affordance too, and an invisible default button would still take a
          tab stop. */}
      {!controlled && (
      <DialogTrigger asChild>
        {trigger ??
          (mode === "edit" ? (
            <Button size="sm">
              <Pencil className="size-4" />
              {t("edit_client")}
            </Button>
          ) : (
            /* The one coloured button on the Clients list (UI kit rule 1),
               sized to match the search box it sits beside. */
            <Button className="h-[42px] gap-2 rounded-[11px] px-5 text-[14.5px] font-semibold shadow-[0_4px_14px_oklch(0.55_0.18_258_/_0.28)]">
              <Plus className="size-[18px]" />
              {t("add_client")}
            </Button>
          ))}
      </DialogTrigger>
      )}
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

          {/* The client's picture — the founder: "theres no way for a client to
              upload a pfp or even the accountant. Its a redudant circle. Add the
              ability for a accountant to do it for now in the profile section of
              the client when they edit them."

              EDIT ONLY, and that is a real constraint rather than an oversight.
              The storage path is keyed on the client's id
              (firms/{firm}/clients/{client}/avatar-…), so there is nowhere to
              put a file for a client that does not exist yet. Offering the
              control while creating would mean either inventing an id before the
              save or holding the bytes in memory across a form submit — both
              worse than picking the picture a moment later.

              It writes IMMEDIATELY, not on Save, because it is not a form field:
              it uploads through its own action the instant you choose a file.
              That is why it sits visually apart from the fields below it. */}
          {client && (
            <div className="pb-1">
              <AvatarPicker
                currentUrl={avatarUrl}
                name={client.display_name}
                size={56}
                onUpload={async (fd) => {
                  const res = await updateClientAvatarAction(client.id, fd);
                  return {
                    ok: res.ok,
                    signedUrl: res.ok ? res.signedUrl : null,
                  };
                }}
                onRemove={async () => {
                  const res = await removeClientAvatarAction(client.id);
                  return { ok: res.ok };
                }}
                labels={{
                  change: t("picture_change"),
                  uploading: t("picture_uploading"),
                  remove: t("picture_remove"),
                  error: () => t("picture_error"),
                }}
              />
            </div>
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
              <Select
                name="province"
                value={province}
                onValueChange={(v) => {
                  setProvince(v);
                  // Auto-fill the timezone from the chosen province.
                  const tz = timezoneForProvince(v);
                  if (tz) setTimezone(tz);
                }}
              >
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
              <Select name="timezone" value={timezone} onValueChange={setTimezone}>
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
            <SearchableSelect
              name="industry"
              triggerId="industry"
              defaultValue={client?.industry ?? "none"}
              options={INDUSTRIES.map((ind) => ({
                value: ind.value,
                label: locale === "fr" ? ind.fr : ind.en,
              }))}
              unsetLabel={t("field_unset")}
              searchPlaceholder={t("industry_search")}
              emptyText={t("industry_empty")}
            />
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
            {/* Who else can see this client. Create-time only, hidden in a
                solo firm, and the SAME editor as the client page's panel — so
                positions can be set here too and the two surfaces cannot drift
                into different shapes. It writes the same client_members rows
                that panel reads. */}
            {mode === "create" && teammates.length > 0 && (
              <div className="space-y-1.5">
                <Label>{t("create_team_label")}</Label>
                <input
                  type="hidden"
                  name="members"
                  value={JSON.stringify(
                    team.map((m) => ({ userId: m.userId, position: m.position })),
                  )}
                />
                <div className="rounded-lg border border-border/60 p-3">
                  <ClientTeamEditor
                    rows={team}
                    candidates={teammates.filter(
                      (m) => !team.some((r) => r.userId === m.id),
                    )}
                    canEdit
                    emptyLabel={t("create_team_just_you")}
                    mode="draft"
                    onAdd={(userId) => {
                      const person = teammates.find((m) => m.id === userId);
                      if (!person) return;
                      setTeam((prev) => [
                        ...prev,
                        { userId, name: person.name, position: null },
                      ]);
                    }}
                    onRemove={(userId) =>
                      setTeam((prev) => prev.filter((r) => r.userId !== userId))
                    }
                    onPosition={(userId, position) =>
                      setTeam((prev) =>
                        prev.map((r) =>
                          r.userId === userId ? { ...r, position } : r,
                        ),
                      )
                    }
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("create_team_hint")}
                </p>
              </div>
            )}

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
