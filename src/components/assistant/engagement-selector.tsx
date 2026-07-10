"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
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
import { cn } from "@/lib/cn";
import type { EngagementOption } from "@/components/assistant/assistant-store";

export type { EngagementOption };

// Searchable engagement picker at the top of the Assistant panel. The list is
// fetched lazily the first time the popover opens (the panel itself mounts on
// every app page — don't pay for the list until it's needed).
export function EngagementSelector({
  value,
  onChange,
}: {
  value: EngagementOption | null;
  onChange: (option: EngagementOption) => void;
}) {
  const t = useTranslations("Assistant");
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<EngagementOption[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const res = await fetch("/api/engagement-chat/engagements");
      if (!res.ok) throw new Error(`status ${res.status}`);
      const body = (await res.json()) as { engagements: EngagementOption[] };
      setOptions(body.engagements);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next && options === null && !loading) {
      void load();
    }
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          role="combobox"
          aria-expanded={open}
          className="flex-1 min-w-0 justify-between font-normal"
        >
          <span className={cn("truncate", !value && "text-muted-foreground")}>
            {value
              ? value.clientName
                ? `${value.title} · ${value.clientName}`
                : value.title
              : t("select_engagement")}
          </span>
          <ChevronsUpDown
            className="ml-1 size-3.5 shrink-0 text-muted-foreground/70"
            aria-hidden
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(340px,90vw)] p-0" align="start">
        <Command>
          <CommandInput placeholder={t("select_engagement_placeholder")} />
          <CommandList>
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden />
                {t("loading")}
              </div>
            ) : failed ? (
              <div className="flex flex-col items-center gap-2 py-6 text-sm text-muted-foreground">
                <span>{t("activity_error")}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() => void load()}
                >
                  {t("retry")}
                </Button>
              </div>
            ) : (
              <>
                <CommandEmpty>{t("no_engagements")}</CommandEmpty>
                <CommandGroup>
                  {(options ?? []).map((o) => (
                    <CommandItem
                      key={o.id}
                      // Include the id so two engagements with identical
                      // title + client stay distinct entries for cmdk.
                      value={`${o.title} ${o.clientName ?? ""} ${o.id}`}
                      onSelect={() => {
                        onChange(o);
                        setOpen(false);
                      }}
                    >
                      <span className="truncate">{o.title}</span>
                      {o.clientName && (
                        <span className="truncate text-xs text-muted-foreground">
                          {o.clientName}
                        </span>
                      )}
                      <Check
                        className={cn(
                          "ml-auto size-4",
                          value?.id === o.id ? "opacity-100" : "opacity-0",
                        )}
                        aria-hidden
                      />
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
