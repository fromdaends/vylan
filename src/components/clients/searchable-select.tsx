"use client";

import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export type SearchableOption = { value: string; label: string };

// A type-to-filter single-select that still submits via a plain form field
// (a hidden input keyed by `name`), so it drops into the uncontrolled,
// FormData-based client form exactly like the shadcn <Select>s next to it —
// just searchable, for long lists like the 32 industries. A leading
// "unset" item (value "none", the server maps it to null) clears the field.
export function SearchableSelect({
  name,
  options,
  defaultValue = "none",
  triggerId,
  unsetLabel,
  searchPlaceholder,
  emptyText,
}: {
  name: string;
  options: SearchableOption[];
  defaultValue?: string;
  triggerId?: string;
  // Label for the trigger when nothing is chosen + the "clear" item.
  unsetLabel: string;
  searchPlaceholder: string;
  emptyText: string;
}) {
  const [value, setValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);

  const pick = (v: string) => {
    setValue(v);
    setOpen(false);
  };

  return (
    <>
      {/* The real form value — Object.fromEntries(formData) reads this. */}
      <input type="hidden" name={name} value={value} />
      {/* modal: this combobox opens INSIDE the add/edit-client modal dialog,
          whose scroll lock blocks wheel/touch scrolling on anything portaled
          outside it — the industry list showed a scrollbar but wouldn't
          scroll. Modal mode makes the popover manage its own scroll layer,
          re-enabling scrolling inside the list. */}
      <Popover open={open} onOpenChange={setOpen} modal>
        <PopoverTrigger asChild>
          <Button
            type="button"
            id={triggerId}
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="h-9 w-full justify-between font-normal"
          >
            <span className={cn("truncate", !selected && "text-muted-foreground")}>
              {selected ? selected.label : unsetLabel}
            </span>
            <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-[--radix-popover-trigger-width] p-0"
          align="start"
        >
          <Command>
            <CommandInput placeholder={searchPlaceholder} />
            <CommandList>
              <CommandEmpty>{emptyText}</CommandEmpty>
              <CommandItem value={unsetLabel} onSelect={() => pick("none")}>
                <Check
                  className={cn(
                    "size-4",
                    value === "none" ? "opacity-100" : "opacity-0",
                  )}
                />
                <span className="text-muted-foreground">{unsetLabel}</span>
              </CommandItem>
              {options.map((o) => (
                <CommandItem
                  key={o.value}
                  value={o.label}
                  onSelect={() => pick(o.value)}
                >
                  <Check
                    className={cn(
                      "size-4",
                      value === o.value ? "opacity-100" : "opacity-0",
                    )}
                  />
                  {o.label}
                </CommandItem>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </>
  );
}
