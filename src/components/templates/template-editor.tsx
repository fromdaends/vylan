"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Plus, Trash2 } from "lucide-react";
import {
  updateTemplateAction,
  type UpdateTemplateState,
} from "@/app/actions/templates";
import type { Template, TemplateItem } from "@/lib/db/templates";
import { DocTypePicker } from "@/components/engagements/doc-type-picker";

export function TemplateEditor({
  template,
  locale,
}: {
  template: Template;
  // Picker localization is handled inside DocTypePicker (useLocale); kept on the
  // signature for the caller's API stability.
  locale: "fr" | "en";
}) {
  void locale;
  const t = useTranslations("Templates");
  const tc = useTranslations("Common");
  const tEng = useTranslations("Engagements");
  const router = useRouter();
  const [name, setName] = useState(template.name);
  const [items, setItems] = useState<TemplateItem[]>(template.items);
  const [state, setState] = useState<UpdateTemplateState>(null);
  const [pending, startTransition] = useTransition();

  function updateItem(idx: number, patch: Partial<TemplateItem>) {
    setItems((prev) =>
      prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)),
    );
  }
  function addItem() {
    setItems((prev) => [
      ...prev,
      {
        label_fr: "",
        label_en: "",
        description_fr: null,
        description_en: null,
        doc_type: "other",
        required: false,
      },
    ]);
  }
  function removeItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  function save() {
    startTransition(async () => {
      const result = await updateTemplateAction({
        id: template.id,
        name,
        items: items.filter((i) => i.label_fr.trim().length > 0),
      });
      setState(result);
      if (result?.ok) router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      {state?.error && (
        <Alert variant="destructive">
          {/* Map the action's error CODE to a localized message — the raw code
              (e.g. "update_failed") used to render straight to the user. */}
          <AlertDescription>
            {state.error === "missing_name"
              ? t("errors.missing_name")
              : state.error === "invalid_items"
                ? t("errors.invalid_items")
                : t("errors.update_failed")}
          </AlertDescription>
        </Alert>
      )}
      {state?.ok && (
        <Alert>
          <AlertDescription>{tc("save")} ✓</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("section_details")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-1.5">
            <Label htmlFor="name">{t("field_name")}</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">
            {t("section_items")}{" "}
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
              {t("items_empty")}
            </div>
          ) : (
            <ul className="space-y-3">
              {items.map((item, idx) => (
                <li
                  key={idx}
                  className="rounded-lg border border-border bg-card p-3 space-y-2"
                >
                  {/* One label for the whole site — mirrored into both
                      label_fr + label_en so stored data stays consistent. */}
                  <Input
                    value={item.label_en || item.label_fr}
                    onChange={(e) =>
                      updateItem(idx, {
                        label_fr: e.target.value,
                        label_en: e.target.value,
                      })
                    }
                    placeholder={tEng("label_placeholder")}
                  />
                  <Textarea
                    value={item.description_fr ?? ""}
                    onChange={(e) =>
                      updateItem(idx, {
                        description_fr: e.target.value || null,
                      })
                    }
                    placeholder={tEng("description_fr_placeholder")}
                    rows={1}
                    className="text-xs"
                  />
                  <div className="flex items-center gap-3 text-xs">
                    <DocTypePicker
                      value={item.doc_type}
                      onChange={(dt) => updateItem(idx, { doc_type: dt })}
                      className="h-8 w-[14rem] max-w-full text-xs"
                    />
                    <label className="flex items-center gap-1.5 select-none cursor-pointer">
                      <input
                        type="checkbox"
                        checked={item.required}
                        onChange={(e) =>
                          updateItem(idx, { required: e.target.checked })
                        }
                      />
                      {tEng("required")}
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
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-3">
        <Button onClick={save} disabled={pending}>
          {pending ? tc("saving") : tc("save")}
        </Button>
      </div>
    </div>
  );
}
