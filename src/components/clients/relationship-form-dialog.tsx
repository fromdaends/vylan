"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ClampedNumberInput } from "@/components/ui/clamped-number-input";
import {
  ClientCombobox,
  type ComboboxClient,
} from "@/components/clients/client-combobox";
import {
  createRelationshipAction,
  updateRelationshipAction,
  type RelationshipActionError,
} from "@/app/actions/relationships";
import {
  RELATIONSHIP_SCOPES,
  type RelationshipScope,
  type RelationshipType,
} from "@/lib/relationships/validate";
import { cn } from "@/lib/cn";

export type RelationshipEditTarget = {
  id: string;
  relType: RelationshipType;
  otherName: string;
  percentage: number | null;
  scopes: RelationshipScope[] | null;
};

// The [+] dialog: relationship type → other client (searchable) →
// type-specific detail. Everything here is convenience — the server action
// re-validates every rule, and the database re-enforces them again.
// Edit mode only exposes the detail (percentage / scopes): changing type or
// endpoints is remove + re-add, so the audit trail stays one-event-per-fact.
export function RelationshipFormDialog({
  open,
  onOpenChange,
  profile,
  candidates,
  edit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profile: { id: string; type: "individual" | "business" };
  candidates: { individuals: ComboboxClient[]; businesses: ComboboxClient[] };
  edit?: RelationshipEditTarget | null;
}) {
  const t = useTranslations("Clients");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Seeded from the edit target — the parent keys this component by target
  // (`key={edit?.id ?? "add"}`) so switching rows re-seeds instead of leaking
  // one row's draft into another's.
  const [relType, setRelType] = useState<RelationshipType | "">("");
  const [otherId, setOtherId] = useState<string | null>(null);
  const [percentage, setPercentage] = useState(() => edit?.percentage ?? 100);
  const [scopes, setScopes] = useState<RelationshipScope[]>(
    () => edit?.scopes ?? [],
  );
  const [error, setError] = useState<RelationshipActionError | null>(null);

  const isEdit = !!edit;
  const activeType: RelationshipType | "" = edit ? edit.relType : relType;

  // Businesses never have spouses; the individual/business direction of the
  // other two types depends on which side of the link this profile is.
  const typeOptions: RelationshipType[] =
    profile.type === "individual"
      ? ["spouse_of", "owner_of", "authorized_contact"]
      : ["owner_of", "authorized_contact"];
  const pickFrom: ComboboxClient[] =
    activeType === "spouse_of"
      ? candidates.individuals
      : profile.type === "individual"
        ? candidates.businesses
        : candidates.individuals;

  function reset() {
    setRelType("");
    setOtherId(null);
    setPercentage(100);
    setScopes([]);
    setError(null);
  }

  function close(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  function toggleScope(scope: RelationshipScope) {
    setScopes((prev) => {
      if (prev.includes(scope)) return prev.filter((s) => s !== scope);
      // "All matters" is exclusive with the specific scopes in the UI; the
      // validator would collapse the union to ["all"] anyway.
      if (scope === "all") return ["all"];
      return [...prev.filter((s) => s !== "all"), scope];
    });
  }

  const detailReady =
    activeType === "owner_of"
      ? percentage >= 1 && percentage <= 100
      : activeType === "authorized_contact"
        ? scopes.length > 0
        : true;
  const canSubmit = isEdit
    ? detailReady
    : activeType !== "" && otherId != null && detailReady;

  function submit() {
    if (!canSubmit || pending) return;
    setError(null);
    startTransition(async () => {
      const res = isEdit
        ? await updateRelationshipAction({
            id: edit.id,
            percentage: edit.relType === "owner_of" ? percentage : undefined,
            scopes: edit.relType === "authorized_contact" ? scopes : undefined,
          })
        : await createRelationshipAction({
            relType: activeType,
            // owner_of / authorized_contact store individual → business; on a
            // business profile the picked client is the individual side.
            // spouse order doesn't matter — the server canonicalizes it.
            fromClientId:
              profile.type === "individual" ? profile.id : otherId!,
            toClientId: profile.type === "individual" ? otherId! : profile.id,
            percentage: activeType === "owner_of" ? percentage : undefined,
            scopes: activeType === "authorized_contact" ? scopes : undefined,
          });
      if (res.ok) {
        toast.success(isEdit ? t("rel_saved") : t("rel_added"));
        close(false);
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  const errorKey =
    error === "duplicate"
      ? "rel_err_duplicate"
      : error === "spouse_taken"
        ? "rel_err_spouse_taken"
        : error
          ? "rel_err_generic"
          : null;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? t("rel_dialog_title_edit") : t("rel_dialog_title_add")}
          </DialogTitle>
          <DialogDescription>
            {isEdit ? edit.otherName : t("rel_dialog_desc")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {!isEdit && (
            <div className="space-y-1.5">
              <Label>{t("rel_field_type")}</Label>
              <Select
                value={relType}
                onValueChange={(v) => {
                  setRelType(v as RelationshipType);
                  setOtherId(null);
                  setError(null);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("rel_field_type_placeholder")} />
                </SelectTrigger>
                <SelectContent>
                  {typeOptions.map((opt) => (
                    <SelectItem key={opt} value={opt}>
                      {opt === "spouse_of"
                        ? t("rel_type_spouse")
                        : opt === "owner_of"
                          ? t("rel_type_owner")
                          : t("rel_type_contact")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {!isEdit && activeType !== "" && (
            <div className="space-y-1.5">
              <Label>{t("rel_field_other")}</Label>
              <ClientCombobox
                clients={pickFrom}
                value={otherId}
                onChange={(id) => {
                  setOtherId(id);
                  setError(null);
                }}
              />
            </div>
          )}

          {activeType === "owner_of" && (
            <div className="space-y-1.5">
              <Label>{t("rel_field_percentage")}</Label>
              <ClampedNumberInput
                value={percentage}
                min={1}
                max={100}
                onCommit={setPercentage}
                className="w-24"
                aria-label={t("rel_field_percentage")}
              />
            </div>
          )}

          {activeType === "authorized_contact" && (
            <div className="space-y-1.5">
              <Label>{t("rel_field_scopes")}</Label>
              <div className="flex flex-wrap gap-1.5">
                {RELATIONSHIP_SCOPES.map((scope) => {
                  const active = scopes.includes(scope);
                  return (
                    <button
                      key={scope}
                      type="button"
                      aria-pressed={active}
                      onClick={() => toggleScope(scope)}
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-xs transition-colors",
                        active
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {t(`rel_scope_${scope}`)}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {errorKey && (
            <p className="text-sm text-destructive">{t(errorKey)}</p>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => close(false)}
            disabled={pending}
          >
            {t("rel_cancel")}
          </Button>
          <Button type="button" onClick={submit} disabled={!canSubmit || pending}>
            {isEdit ? t("rel_submit_save") : t("rel_submit_add")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
