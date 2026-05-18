"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  updateClientFieldAction,
  type InlineUpdateResult,
} from "@/app/actions/clients";

// Inline-editable contact card. Each input saves on blur via the
// per-field server action. Mirrors the save-on-blur pattern used on
// /profile for display name — the field always renders as a real
// Input, no edit-mode toggle, so it feels like editing in place.
//
// Edit button + modal at the top of the page still works as a backup
// for editing every field at once.

type Client = {
  id: string;
  email: string | null;
  phone: string | null;
  external_ref: string | null;
  notes: string | null;
};

type Field = "email" | "phone" | "external_ref" | "notes";

export function ClientDetailForm({ client }: { client: Client }) {
  const t = useTranslations("Clients");

  return (
    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5 text-sm">
      <InlineField
        clientId={client.id}
        field="email"
        label={t("col_email")}
        initial={client.email}
        placeholder={t("inline_placeholder_email")}
        inputType="email"
      />
      <InlineField
        clientId={client.id}
        field="phone"
        label={t("col_phone")}
        initial={client.phone}
        placeholder={t("inline_placeholder_phone")}
        inputType="tel"
        mono
      />
      <InlineField
        clientId={client.id}
        field="external_ref"
        label={t("field_external_ref")}
        initial={client.external_ref}
        placeholder={t("inline_placeholder_external_ref")}
        mono
      />
      <InlineField
        clientId={client.id}
        field="notes"
        label={t("field_notes")}
        initial={client.notes}
        placeholder={t("inline_placeholder_notes")}
        wide
        multiline
      />
    </dl>
  );
}

function InlineField({
  clientId,
  field,
  label,
  initial,
  placeholder,
  inputType = "text",
  mono = false,
  wide = false,
  multiline = false,
}: {
  clientId: string;
  field: Field;
  label: string;
  initial: string | null;
  placeholder: string;
  inputType?: "text" | "email" | "tel";
  mono?: boolean;
  wide?: boolean;
  multiline?: boolean;
}) {
  const t = useTranslations("Clients");
  const [value, setValue] = useState(initial ?? "");
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // `initial` changes whenever the surrounding server component
  // re-renders with fresh DB data (e.g. after another tab edited the
  // same client). Sync local state without clobbering an in-progress
  // edit — only adopt the upstream value if the user isn't actively
  // typing and the value differs from what they've already entered.
  const lastInitialRef = useRef(initial);
  useEffect(() => {
    if (lastInitialRef.current !== initial && !pending) {
      lastInitialRef.current = initial;
      setValue(initial ?? "");
    }
  }, [initial, pending]);

  // Hide the "Saved" pill after ~1.6s.
  useEffect(() => {
    if (savedAt == null) return;
    const id = window.setTimeout(() => setSavedAt(null), 1600);
    return () => window.clearTimeout(id);
  }, [savedAt]);

  function save() {
    const trimmed = value.trim();
    const current = initial ?? "";
    if (trimmed === current.trim()) return; // no-op blur
    setError(null);
    const fd = new FormData();
    fd.append("id", clientId);
    fd.append("field", field);
    fd.append("value", trimmed);
    startTransition(async () => {
      const res: InlineUpdateResult = await updateClientFieldAction(fd);
      if (res.ok) {
        setSavedAt(Date.now());
      } else {
        // Translate known error codes; fall back to a generic message.
        const key = `inline_error_${res.error}`;
        const fallback = t("inline_error_update_failed");
        try {
          const translated = t(key);
          setError(translated === key ? fallback : translated);
        } catch {
          setError(fallback);
        }
        // Revert to the server's truth so the visual state matches what
        // got persisted (which is: nothing).
        setValue(initial ?? "");
      }
    });
  }

  const baseClasses =
    (mono ? "font-mono " : "") +
    "bg-transparent border-transparent hover:border-input/60 focus:border-input transition-colors";

  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <dt className="text-muted-foreground text-xs uppercase tracking-wide flex items-center gap-2">
        <span>{label}</span>
        {pending && (
          <span className="text-[10px] normal-case tracking-normal text-muted-foreground/60">
            {t("inline_saving")}
          </span>
        )}
        {savedAt != null && !pending && (
          <span className="text-[10px] normal-case tracking-normal text-success">
            {t("inline_saved")}
          </span>
        )}
      </dt>
      <dd className="mt-1">
        {multiline ? (
          <Textarea
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            onBlur={save}
            placeholder={placeholder}
            disabled={pending}
            rows={3}
            className={baseClasses + " resize-y"}
          />
        ) : (
          <Input
            type={inputType}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            onBlur={save}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.currentTarget.blur();
              }
              if (e.key === "Escape") {
                setValue(initial ?? "");
                setError(null);
                e.currentTarget.blur();
              }
            }}
            placeholder={placeholder}
            disabled={pending}
            className={baseClasses}
          />
        )}
        {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      </dd>
    </div>
  );
}
