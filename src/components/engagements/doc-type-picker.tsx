"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
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
import type { DocType } from "@/lib/db/templates";
import {
  DOC_TYPE_LABELS,
  docTypesByGroup,
  docTypeLabel,
  docTypeGroupLabel,
} from "@/lib/doc-types";

// Searchable document-type picker. With ~55 federal + Quebec slips/forms a flat
// dropdown is unusable, so this is the real-software pattern: a combobox that
// type-filters across the EN + FR name, the code, the group, and the hidden
// synonym text — accent- and case-insensitive — while still letting you browse
// by group when the search is empty. Mirrors ClientCombobox.

function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

// cmdk filter: every typed token must appear in the item's value + keywords.
// So "rl31", "loyer", "solidarity", "child", "pension", "celiapp" all hit.
// Exported for unit testing.
export function docTypeFilter(
  value: string,
  search: string,
  keywords?: string[],
): number {
  const hay = fold([value, ...(keywords ?? [])].join(" "));
  const tokens = fold(search).split(/\s+/).filter(Boolean);
  return tokens.every((tok) => hay.includes(tok)) ? 1 : 0;
}

export function DocTypePicker({
  value,
  onChange,
  id,
  className,
  province,
  includeQuebecForms = true,
}: {
  value: DocType;
  onChange: (next: DocType) => void;
  /** Forwarded to the trigger so a <label htmlFor> can target it. */
  id?: string;
  /** Sizing for the trigger button (call sites differ in width). */
  className?: string;
  /** The client's province. When set to a non-Quebec province, the Quebec RL
   *  slips are hidden so only the documents that apply there are offered. */
  province?: string | null;
  /** Firm-wide setting (migration 0350). When false, the Quebec RL slips are
   *  hidden regardless of province. */
  includeQuebecForms?: boolean;
}) {
  const t = useTranslations("Engagements");
  const locale = useLocale();
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("justify-between gap-2 font-normal", className)}
        >
          <span className="truncate">{docTypeLabel(value, locale)}</span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(26rem,90vw)] p-0"
      >
        <Command filter={docTypeFilter}>
          <CommandInput placeholder={t("doc_type_search")} />
          <CommandList>
            <CommandEmpty>{t("doc_type_empty")}</CommandEmpty>
            {docTypesByGroup(province, includeQuebecForms).map((g) => {
              const heading = docTypeGroupLabel(g.group, locale);
              return (
                <CommandGroup key={g.group} heading={heading}>
                  {g.codes.map((code) => {
                    const meta = DOC_TYPE_LABELS[code];
                    return (
                      <CommandItem
                        key={code}
                        value={code}
                        keywords={[meta.en, meta.fr, heading, meta.ai]}
                        onSelect={() => {
                          onChange(code);
                          setOpen(false);
                        }}
                      >
                        <Check
                          className={cn(
                            "size-4 shrink-0",
                            value === code ? "opacity-100" : "opacity-0",
                          )}
                        />
                        <span className="truncate">
                          {docTypeLabel(code, locale)}
                        </span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              );
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
