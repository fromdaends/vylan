"use client";

import { useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, GripVertical } from "lucide-react";
import {
  ClientCombobox,
  type ComboboxClient,
} from "@/components/clients/client-combobox";
import { createEngagementAction } from "@/app/actions/engagements";
import type { Template, TemplateItem, DocType } from "@/lib/db/templates";

type KnownErrorKey =
  | "missing_client"
  | "missing_template"
  | "missing_title"
  | "create_failed"
  | "min_2_chars"
  | "too_long";
const KNOWN_ERRORS = new Set<string>([
  "missing_client",
  "missing_template",
  "missing_title",
  "create_failed",
  "min_2_chars",
  "too_long",
]);

const DOC_TYPES: DocType[] = [
  "t4", "rl1", "t5", "rl3", "t3", "rl16", "noa",
  "bank_statement", "credit_card_statement", "receipt",
  "t2202", "rrsp", "medical", "donation", "rental",
  "gst_hst_qst", "trial_balance", "gl_export", "financials",
  "shareholder_loan", "payroll_summary", "capital_asset",
  "inventory", "invoice", "other",
];

export function EngagementBuilder({
  clients,
  templates,
  initialClientId,
  locale,
}: {
  clients: ComboboxClient[];
  templates: Template[];
  initialClientId?: string;
  locale: "fr" | "en";
}) {
  const t = useTranslations("Engagements");
  const tc = useTranslations("Common");

  const [clientId, setClientId] = useState<string | null>(
    initialClientId ?? null,
  );
  const [templateId, setTemplateId] = useState<string>(templates[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [titleTouched, setTitleTouched] = useState(false);
  const [dueDate, setDueDate] = useState("");
  const [items, setItems] = useState<TemplateItem[]>(
    templates[0]?.items ?? [],
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const selectedTemplate = templates.find((tt) => tt.id === templateId);

  // Auto-fill title from template + year when not yet edited.
  const defaultTitle = useMemo(() => {
    if (!selectedTemplate) return "";
    const year = new Date().getFullYear();
    return `${selectedTemplate.name} — ${year}`;
  }, [selectedTemplate]);
  const effectiveTitle = titleTouched ? title : defaultTitle;

  function pickTemplate(id: string) {
    setTemplateId(id);
    const tmpl = templates.find((tt) => tt.id === id);
    setItems(tmpl?.items ?? []);
    setTitleTouched(false);
  }

  function updateItem(idx: number, patch: Partial<TemplateItem>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  function addItem() {
    setItems((prev) => [
      ...prev,
      {
        label_fr: "",
        label_en: "",
        description_fr: null,
        description_en: null,
        doc_type: "other" as DocType,
        required: false,
      },
    ]);
  }

  function removeItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  function moveItem(idx: number, delta: -1 | 1) {
    setItems((prev) => {
      const next = [...prev];
      const target = idx + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  }

  async function submit(send: boolean) {
    setError(null);
    if (!clientId) {
      setError("missing_client");
      return;
    }
    if (!selectedTemplate) {
      setError("missing_template");
      return;
    }
    if (!effectiveTitle.trim() || effectiveTitle.length < 2) {
      setError("missing_title");
      return;
    }
    const cleanItems = items
      .map((i) => ({
        ...i,
        label_fr: i.label_fr.trim(),
        label_en: i.label_en.trim() || i.label_fr.trim(),
      }))
      .filter((i) => i.label_fr.length > 0);

    startTransition(async () => {
      try {
        const result = await createEngagementAction({
          client_id: clientId,
          title: effectiveTitle.trim(),
          type: selectedTemplate.type,
          due_date: dueDate || null,
          items: cleanItems,
          send,
          locale,
        });
        // If the action redirected, this code never runs.
        if (result?.error) {
          setError(result.error);
        } else if (result?.fieldErrors) {
          const first = Object.entries(result.fieldErrors)[0];
          setError(first ? `${first[0]}: ${first[1]}` : "create_failed");
        }
      } catch (e) {
        const digest = (e as { digest?: string })?.digest;
        if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")) {
          throw e;
        }
        console.error("createEngagement threw:", e);
        setError("create_failed");
      }
    });
  }

  return (
    <div className="space-y-6">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>
            {/* Known i18n keys translate; everything else (e.g. server-side
                field errors like "client_id: invalid_uuid") shows raw. */}
            {KNOWN_ERRORS.has(error)
              ? t(`errors.${error}` as KnownErrorKey)
              : error}
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("section_client")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ClientCombobox
            clients={clients}
            value={clientId}
            onChange={setClientId}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("section_template")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {templates.map((tmpl) => (
              <label
                key={tmpl.id}
                className={
                  "rounded-lg border p-3 cursor-pointer transition " +
                  (templateId === tmpl.id
                    ? "border-primary bg-muted/50"
                    : "border-border hover:bg-muted/30")
                }
              >
                <input
                  type="radio"
                  name="template"
                  checked={templateId === tmpl.id}
                  onChange={() => pickTemplate(tmpl.id)}
                  className="sr-only"
                />
                <div className="flex items-center justify-between">
                  <span className="font-medium">{tmpl.name}</span>
                  {tmpl.firm_id == null && (
                    <Badge variant="secondary" className="text-xs">
                      {t("template_builtin")}
                    </Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {tmpl.items.length} {t("items_count")}
                </div>
              </label>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("section_details")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="title">{t("field_title")}</Label>
            <Input
              id="title"
              value={effectiveTitle}
              onChange={(e) => {
                setTitle(e.target.value);
                setTitleTouched(true);
              }}
              placeholder={defaultTitle}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="due_date">{t("field_due_date_optional")}</Label>
            <Input
              id="due_date"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-fit"
            />
            <p className="text-xs text-muted-foreground">
              {t("due_date_hint")}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">
            {t("section_checklist")}{" "}
            <span className="text-muted-foreground font-normal">
              ({items.length})
            </span>
          </CardTitle>
          <Button type="button" variant="outline" size="sm" onClick={addItem}>
            <Plus className="size-4" />
            {t("add_item")}
          </Button>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-8">
              {t("checklist_empty")}
            </div>
          ) : (
            <ul className="space-y-3">
              {items.map((item, idx) => (
                <li
                  key={idx}
                  className="rounded-lg border border-border bg-card p-3"
                >
                  <div className="flex items-start gap-2">
                    <div className="flex flex-col items-center pt-1 text-muted-foreground">
                      <button
                        type="button"
                        onClick={() => moveItem(idx, -1)}
                        disabled={idx === 0}
                        className="hover:text-foreground disabled:opacity-30"
                        aria-label={t("move_up")}
                      >
                        ↑
                      </button>
                      <GripVertical className="size-3" aria-hidden />
                      <button
                        type="button"
                        onClick={() => moveItem(idx, 1)}
                        disabled={idx === items.length - 1}
                        className="hover:text-foreground disabled:opacity-30"
                        aria-label={t("move_down")}
                      >
                        ↓
                      </button>
                    </div>
                    <div className="flex-1 space-y-2">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <Input
                          value={item.label_fr}
                          onChange={(e) =>
                            updateItem(idx, { label_fr: e.target.value })
                          }
                          placeholder={t("label_fr_placeholder")}
                          aria-label={t("label_fr_placeholder")}
                        />
                        <Input
                          value={item.label_en}
                          onChange={(e) =>
                            updateItem(idx, { label_en: e.target.value })
                          }
                          placeholder={t("label_en_placeholder")}
                          aria-label={t("label_en_placeholder")}
                        />
                      </div>
                      <Textarea
                        value={item.description_fr ?? ""}
                        onChange={(e) =>
                          updateItem(idx, {
                            description_fr: e.target.value || null,
                          })
                        }
                        placeholder={t("description_fr_placeholder")}
                        rows={1}
                        className="text-xs"
                      />
                      <div className="flex items-center gap-3 text-xs">
                        <select
                          value={item.doc_type}
                          onChange={(e) =>
                            updateItem(idx, {
                              doc_type: e.target.value as DocType,
                            })
                          }
                          className="rounded-md border border-input bg-background px-2 py-1 font-mono"
                        >
                          {DOC_TYPES.map((dt) => (
                            <option key={dt} value={dt}>
                              {dt}
                            </option>
                          ))}
                        </select>
                        <label className="flex items-center gap-1.5 select-none cursor-pointer">
                          <input
                            type="checkbox"
                            checked={item.required}
                            onChange={(e) =>
                              updateItem(idx, { required: e.target.checked })
                            }
                          />
                          {t("required")}
                        </label>
                        <button
                          type="button"
                          onClick={() => removeItem(idx)}
                          className="ml-auto text-destructive hover:underline inline-flex items-center gap-1"
                        >
                          <Trash2 className="size-3" />
                          {tc("delete")}
                        </button>
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => submit(false)}
          disabled={pending}
        >
          {pending ? tc("saving") : t("save_draft")}
        </Button>
        <Button
          type="button"
          onClick={() => submit(true)}
          disabled={pending}
        >
          {pending ? tc("saving") : t("create_and_send")}
        </Button>
      </div>
    </div>
  );
}
