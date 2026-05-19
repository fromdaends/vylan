"use client";

import { useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { usePathname } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, ArrowUpDown } from "lucide-react";
import { SORT_OPTIONS, type SortKey } from "./sort";

export function ClientsToolbar({
  q,
  type,
  includeArchived,
  sort,
  activeOnly,
}: {
  q: string;
  type: "all" | "individual" | "business";
  includeArchived: boolean;
  sort: SortKey;
  activeOnly: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [pending, startTransition] = useTransition();
  const t = useTranslations("Clients");

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(search?.toString() ?? "");
    if (value === null || value === "") {
      next.delete(key);
    } else {
      next.set(key, value);
    }
    const qs = next.toString();
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-3 justify-between">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative">
          <Search
            className="absolute left-2 top-1/2 -translate-y-1/2 size-4 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            placeholder={t("search_placeholder")}
            defaultValue={q}
            onChange={(e) => setParam("q", e.target.value)}
            className="pl-8 w-72"
            aria-label={t("search_label")}
          />
        </div>
        <Tabs
          value={type}
          onValueChange={(v) => setParam("type", v === "all" ? null : v)}
        >
          <TabsList>
            <TabsTrigger value="all">{t("filter_all")}</TabsTrigger>
            <TabsTrigger value="individual">
              {t("filter_individual")}
            </TabsTrigger>
            <TabsTrigger value="business">{t("filter_business")}</TabsTrigger>
          </TabsList>
        </Tabs>
        <Select
          value={sort}
          onValueChange={(v) =>
            setParam("sort", v === "recent" ? null : v)
          }
        >
          <SelectTrigger
            size="sm"
            className="w-[12rem]"
            aria-label={t("sort_label")}
          >
            <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />
            <SelectValue placeholder={t("sort_label")} />
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map((opt) => (
              <SelectItem key={opt} value={opt}>
                {t(`sort_${opt}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center gap-4 text-sm text-muted-foreground select-none">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={activeOnly}
            onChange={(e) => setParam("active", e.target.checked ? "1" : null)}
            className="size-4"
          />
          {t("active_only")}
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => setParam("archived", e.target.checked ? "1" : null)}
            className="size-4"
          />
          {t("show_archived")}
          {pending && (
            <span className="text-xs text-muted-foreground/70">…</span>
          )}
        </label>
      </div>
    </div>
  );
}
