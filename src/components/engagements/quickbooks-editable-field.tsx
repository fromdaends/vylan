"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Check, ChevronsUpDown, Loader2, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { ResolvedRef } from "@/lib/quickbooks/suggest";

export type PickOption = { id: string; name: string };
type DraftField = "party" | "account" | "taxCode" | "item";

// One editable mapping cell on a QuickBooks draft (Stage 4): the accountant picks
// the real vendor/customer, account, or tax code from their connected QuickBooks
// list. Saving goes to the stable resolve endpoint (deploy-skew-proof) and is
// optimistic — the cell shows the pick immediately, reverting if the save fails.
// Still READ-ONLY on QuickBooks; this only records the chosen mapping.
export function QuickbooksEditableField({
  fileId,
  field,
  label,
  options,
  initial,
  choosePrompt,
  disabled = false,
}: {
  fileId: string;
  field: DraftField;
  label: string;
  options: PickOption[];
  // The current effective value (the accountant's pick, else the AI match).
  initial: ResolvedRef | null;
  // Amber prompt shown when nothing is chosen yet.
  choosePrompt: string;
  // When true the cell is LOCKED (read-only) — used once a draft is approved or
  // dismissed. Reopen the draft to edit it again.
  disabled?: boolean;
}) {
  const t = useTranslations("Quickbooks");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<ResolvedRef | null>(initial);
  const [pending, setPending] = useState(false);

  async function save(next: ResolvedRef | null) {
    const prev = value;
    setValue(next); // optimistic
    setOpen(false);
    setPending(true);
    try {
      const r = await fetch(`/api/quickbooks/suggestions/${fileId}/resolve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ [field]: next }),
      });
      const res = (await r.json().catch(() => null)) as { ok?: boolean } | null;
      if (res?.ok) router.refresh();
      else setValue(prev); // revert
    } catch {
      setValue(prev);
    } finally {
      setPending(false);
    }
  }

  const empty = value == null;

  // Locked (approved / dismissed draft): a static, muted read-only cell — no
  // popover, no amber prompt. Reopening the draft restores the editable cell.
  if (disabled) {
    return (
      <div className="min-w-0 rounded-lg bg-muted/50 px-2.5 py-1.5 opacity-80">
        <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div className="mt-0.5 truncate text-sm font-medium text-foreground">
          {empty ? "—" : value!.name}
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "min-w-0 rounded-lg px-2.5 py-1.5",
        empty ? "bg-warning/10" : "bg-muted/50",
      )}
    >
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={pending}
            aria-label={empty ? choosePrompt : value!.name}
            className={cn(
              "mt-0.5 flex w-full items-center gap-1 rounded-sm text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
              empty ? "text-warning" : "text-foreground hover:text-foreground/80",
            )}
          >
            {pending ? (
              <Loader2 className="h-3 w-3 shrink-0 animate-spin" aria-hidden="true" />
            ) : empty ? (
              <TriangleAlert className="h-3 w-3 shrink-0" aria-hidden="true" />
            ) : null}
            <span className="min-w-0 flex-1 truncate font-medium">
              {empty ? choosePrompt : value!.name}
            </span>
            <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-50" aria-hidden="true" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          className="w-[--radix-popover-trigger-width] min-w-[15rem] p-0"
          align="start"
        >
          <Command>
            <CommandInput placeholder={t("pick_search")} />
            <CommandList>
              <CommandEmpty>{t("pick_empty")}</CommandEmpty>
              <CommandGroup>
                {value && (
                  <CommandItem
                    value="__clear__"
                    onSelect={() => save(null)}
                    className="text-muted-foreground"
                  >
                    {t("pick_clear")}
                  </CommandItem>
                )}
                {options.map((o) => (
                  <CommandItem
                    key={o.id}
                    value={`${o.name} ${o.id}`}
                    onSelect={() => save({ id: o.id, name: o.name })}
                  >
                    <Check
                      className={cn(
                        "size-4 shrink-0",
                        value?.id === o.id ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span className="truncate">{o.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
