"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";

// Home-page search input.
//
// SCOPE TODO: there's no unified search endpoint yet — the input
// currently routes to /clients?q=<query> (which IS wired to a real
// case-insensitive substring search on display_name + email). When
// we ship a real search API that spans clients + engagements +
// documents, swap the onSubmit body to call that and render a
// dropdown of typed results.
export function HomeSearch() {
  const t = useTranslations("Home");
  const router = useRouter();
  const [value, setValue] = useState("");

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const q = value.trim();
    if (!q) return;
    router.push(`/clients?q=${encodeURIComponent(q)}`);
  }

  return (
    <form onSubmit={onSubmit} className="relative">
      <label htmlFor="home-search" className="sr-only">
        {t("search_label")}
      </label>
      <Search
        className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground/70 pointer-events-none"
        aria-hidden
      />
      <Input
        id="home-search"
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={t("search_placeholder")}
        className="pl-9 h-11"
        aria-label={t("search_label")}
      />
    </form>
  );
}
