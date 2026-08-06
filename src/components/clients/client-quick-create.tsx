"use client";

// Add a client — the wizard's SINGLE-CARD shape.
//
// ── WHY THIS IS FOUR FIELDS AND NOT ELEVEN ─────────────────────────────────
//
// The design handoff calls client, invoice and import "the genuinely simple
// ones", and collapses each to one small card with no steps rail. It is right
// about this one. Adding a client used to open the full profile editor: name,
// type, language, email, phone, province, timezone, industry, your own
// reference, a team picker and a picture. Eleven controls to answer a question
// that is almost always "Marie Tremblay, marie@example.com".
//
// Everything omitted is still there — on the client's own page, which is where
// you are standing when you actually know their timezone. The footnote says so
// out loud, because a form that visibly asks for less has to promise that the
// rest has not been taken away.
//
// ── WHY IT REPLACED THE CREATE MODE RATHER THAN JOINING IT ─────────────────
//
// CLAUDE.md: "Never create a second copy of UI that already exists." Two ways
// to add a client would be exactly that, and the one nobody opened would drift.
// So `ClientFormDialog` is EDIT-ONLY now — this is the only way a client gets
// made, and the full field set is what you edit afterwards.

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  TemplateBuilderShell,
  Field,
  Segmented,
} from "@/components/templates/template-builder-shell";
import { createClientAction } from "@/app/actions/clients";

export function ClientQuickCreate({
  locale,
  /** Opens on FIRST render — for arriving from the rail's Create popover,
   *  which sends ?new=1. Once closed it stays closed; it does not fight you. */
  defaultOpen = false,
}: {
  locale: "fr" | "en";
  defaultOpen?: boolean;
}) {
  const t = useTranslations("Clients");
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen);
  const [pending, startTransition] = useTransition();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [type, setType] = useState<"business" | "individual">("individual");
  // Their EMAIL language, not yours. Defaulted to the firm's own locale
  // because most books are kept in one language, and it is one click to change.
  const [emailLocale, setEmailLocale] = useState<"fr" | "en">(locale);
  const [error, setError] = useState<string | null>(null);

  function save() {
    if (!name.trim() || pending) return;
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("display_name", name.trim());
      fd.set("type", type);
      fd.set("locale", emailLocale);
      if (email.trim()) fd.set("email", email.trim());
      fd.set("__app_locale", locale);

      // The action's state type is nullable because useActionState starts it
      // that way; calling it directly, a null back means "no complaint".
      const res = await createClientAction({}, fd);
      if (res?.fieldErrors?.email) {
        setError(t("inline_error_invalid_email"));
        return;
      }
      if (res?.error || res?.fieldErrors) {
        setError(
          res.error === "forbidden" ? t("create_forbidden") : t("save_error"),
        );
        return;
      }
      toast.success(t("quick_created_toast", { name: name.trim() }));
      setOpen(false);
      setName("");
      setEmail("");
      router.refresh();
    });
  }

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        <Plus className="size-4" />
        {t("add_client")}
      </Button>

      {open && (
        <TemplateBuilderShell
          title={t("add_client")}
          explainer={t("quick_client_explainer")}
          // ONE step. The shell reads that as "no steps box", shrinks the card
          // to 560px and puts nothing in the footer but the thing you came to
          // do — the handoff's single-card flow, from the same component that
          // draws the five-step ones.
          tabs={[{ key: "only", label: t("add_client") }]}
          activeTab="only"
          onTabChange={() => {}}
          finalAction={{
            label: t("add_client"),
            disabled: !name.trim() || pending,
            onClick: save,
          }}
          onClose={() => setOpen(false)}
          error={error}
        >
          <div className="space-y-3.5">
            <Field label={t("field_name")} htmlFor="qc-name" required>
              <Input
                id="qc-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("quick_name_placeholder")}
                autoFocus
              />
            </Field>

            <Field label={t("field_email")} htmlFor="qc-email">
              <Input
                id="qc-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t("quick_email_placeholder")}
              />
            </Field>

            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
              <Field label={t("field_type")}>
                <Segmented
                  value={type}
                  onChange={setType}
                  label={t("field_type")}
                  options={[
                    { value: "business" as const, label: t("type_business") },
                    {
                      value: "individual" as const,
                      label: t("type_individual"),
                    },
                  ]}
                />
              </Field>
              <Field label={t("quick_email_language")}>
                <Segmented
                  value={emailLocale}
                  onChange={setEmailLocale}
                  label={t("quick_email_language")}
                  options={[
                    { value: "en" as const, label: "English" },
                    { value: "fr" as const, label: "Français" },
                  ]}
                />
              </Field>
            </div>

            {/* The promise that makes four fields honest. */}
            <p className="pt-1 text-[11.5px] leading-relaxed text-muted-foreground">
              {t("quick_client_footnote")}
            </p>
          </div>
        </TemplateBuilderShell>
      )}
    </>
  );
}
