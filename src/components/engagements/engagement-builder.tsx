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
import { Switch } from "@/components/ui/switch";
import { Plus, Trash2, GripVertical, Sparkles } from "lucide-react";
import {
  ClientCombobox,
  type ComboboxClient,
} from "@/components/clients/client-combobox";
import { createEngagementAction } from "@/app/actions/engagements";
import type { Template, TemplateItem, DocType } from "@/lib/db/templates";
import { DocTypePicker } from "@/components/engagements/doc-type-picker";
import { appliesToProvince } from "@/lib/doc-types";
import { localizedTemplateName } from "@/lib/templates/builtin-names";

type KnownErrorKey =
  | "missing_client"
  | "missing_template"
  | "missing_title"
  | "create_failed"
  | "min_2_chars"
  | "too_long"
  | "no_documents";
const KNOWN_ERRORS = new Set<string>([
  "missing_client",
  "missing_template",
  "missing_title",
  "create_failed",
  "min_2_chars",
  "too_long",
  "no_documents",
]);

export function EngagementBuilder({
  clients,
  templates,
  initialClientId,
  locale,
  includeQuebecForms = true,
}: {
  clients: ComboboxClient[];
  templates: Template[];
  initialClientId?: string;
  locale: "fr" | "en";
  // Firm-wide setting (migration 0350). When false, the Quebec-only RL slips
  // never appear in this firm's checklists, whatever the client's province.
  includeQuebecForms?: boolean;
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
  // "AI Analyze" toggle — on by default. When off, no document the client
  // uploads to this engagement is sent to the AI (saves AI usage/cost).
  const [aiEnabled, setAiEnabled] = useState(true);
  const [items, setItems] = useState<TemplateItem[]>(() => {
    // If we already know the client (e.g. started from a client's page), seed
    // the checklist with only the documents that apply to their province.
    const initialProvince =
      clients.find((c) => c.id === initialClientId)?.province ?? null;
    return (templates[0]?.items ?? []).filter((it) =>
      appliesToProvince(it.doc_type, initialProvince, includeQuebecForms),
    );
  });
  const [error, setError] = useState<string | null>(null);
  // How many times "Create and send" was pressed with an empty checklist.
  // From the 2nd attempt we ring the checklist so the reason is obvious.
  const [emptyAttempts, setEmptyAttempts] = useState(0);
  const [pending, startTransition] = useTransition();

  const selectedTemplate = templates.find((tt) => tt.id === templateId);
  // The chosen client's province drives which document types apply. Quebec
  // clients get the RL slips; everyone else (or province not set) doesn't.
  const selectedProvince =
    clients.find((c) => c.id === clientId)?.province ?? null;

  // Keep only the document types that apply to the given province (drops the
  // Quebec RL slips for a non-Quebec client). Empty-doc_type rows the
  // accountant is still typing are always kept.
  function forProvince(list: TemplateItem[], province: string | null) {
    return list.filter((it) =>
      appliesToProvince(it.doc_type, province, includeQuebecForms),
    );
  }

  // Switching client re-filters the current checklist (e.g. picking an Ontario
  // client after a Quebec template drops the RL slips on the spot).
  function chooseClient(id: string | null) {
    setClientId(id);
    const province = clients.find((c) => c.id === id)?.province ?? null;
    setItems((prev) => forProvince(prev, province));
  }

  // Auto-fill title from template + year when not yet edited.
  const defaultTitle = useMemo(() => {
    if (!selectedTemplate) return "";
    const year = new Date().getFullYear();
    return `${localizedTemplateName(selectedTemplate, locale)} — ${year}`;
  }, [selectedTemplate, locale]);
  const effectiveTitle = titleTouched ? title : defaultTitle;

  // After a 2nd failed "Create and send" on an empty checklist, ring the
  // checklist section. The top-of-form error is easy to miss when the Send
  // button sits at the bottom, right next to this section.
  const highlightEmptyChecklist = items.length === 0 && emptyAttempts >= 2;

  function pickTemplate(id: string) {
    setTemplateId(id);
    const tmpl = templates.find((tt) => tt.id === id);
    // Apply the template, but only the documents that apply to this client's
    // province — an Ontario client never gets the Quebec RL slips.
    setItems(forProvince(tmpl?.items ?? [], selectedProvince));
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

    // Sending needs at least one document for the client to upload. Saving a
    // draft with an empty checklist is still allowed.
    if (send && cleanItems.length === 0) {
      setError("no_documents");
      setEmptyAttempts((n) => n + 1);
      return;
    }

    startTransition(async () => {
      try {
        const result = await createEngagementAction({
          client_id: clientId,
          title: effectiveTitle.trim(),
          type: selectedTemplate.type,
          due_date: dueDate || null,
          ai_enabled: aiEnabled,
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
          {/* chooseClient re-filters the checklist for the new client's province */}
          <ClientCombobox
            clients={clients}
            value={clientId}
            onChange={chooseClient}
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
                  <span className="font-medium">
                    {localizedTemplateName(tmpl, locale)}
                  </span>
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
          {/* "AI Analyze" toggle. On by default; turning it off means no
              document uploaded to this engagement is ever sent to the AI —
              helps the firm control AI usage on engagements that don't need it. */}
          <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-3">
            <div className="space-y-0.5">
              <Label
                htmlFor="ai-analyze"
                className="flex items-center gap-1.5 cursor-pointer"
              >
                <Sparkles className="size-4 text-muted-foreground" aria-hidden />
                {t("ai_analyze_label")}
              </Label>
              <p className="text-xs text-muted-foreground">
                {t("ai_analyze_hint")}
              </p>
            </div>
            <Switch
              id="ai-analyze"
              checked={aiEnabled}
              onCheckedChange={setAiEnabled}
              ariaLabel={t("ai_analyze_label")}
            />
          </div>
        </CardContent>
      </Card>

      <Card
        className={
          highlightEmptyChecklist
            ? "ring-2 ring-destructive transition-shadow"
            : "transition-shadow"
        }
      >
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
            <div
              className={
                "text-sm text-center py-8 " +
                (highlightEmptyChecklist
                  ? "text-destructive font-medium"
                  : "text-muted-foreground")
              }
            >
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
                        <DocTypePicker
                          value={item.doc_type}
                          onChange={(dt) => updateItem(idx, { doc_type: dt })}
                          className="h-8 w-[14rem] max-w-full text-xs"
                          province={selectedProvince}
                          includeQuebecForms={includeQuebecForms}
                        />
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
