"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

type Named = { id: string; name: string; active: boolean };
type Account = Named & { accountType: string | null };
type Lists = {
  accounts: Account[] | null;
  vendors: Named[] | null;
  customers: Named[] | null;
  taxCodes: Named[] | null;
};
type Status = "loading" | "loaded" | "error";

// Read-only QuickBooks reference lists (accounts, vendors, customers, tax codes)
// shown under the connected card. Fetches live from /api/.../lists on mount, so
// the Settings render never blocks on QuickBooks. Each list is an expandable
// section with a count; a list that failed shows a calm per-section note, and a
// total failure shows one calm note rather than breaking the page. Any member.
export function QuickbooksLists() {
  const t = useTranslations("Settings");
  const [status, setStatus] = useState<Status>("loading");
  const [lists, setLists] = useState<Lists | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/integrations/quickbooks/lists");
        const data = (await res.json().catch(() => null)) as {
          lists?: Lists | null;
        } | null;
        if (cancelled) return;
        if (res.ok && data?.lists) {
          setLists(data.lists);
          setStatus("loaded");
        } else {
          setStatus("error");
        }
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (status === "loading") {
    return (
      <p className="mt-4 max-w-xl text-xs text-muted-foreground">
        {t("qbo_lists_loading")}
      </p>
    );
  }
  if (status === "error" || !lists) {
    return (
      <p role="alert" className="mt-4 max-w-xl text-xs text-muted-foreground">
        {t("qbo_lists_error")}
      </p>
    );
  }

  return (
    <div className="mt-4 max-w-xl space-y-2">
      <ListSection label={t("qbo_accounts_title")} rows={lists.accounts} showType />
      <ListSection label={t("qbo_section_vendors")} rows={lists.vendors} />
      <ListSection label={t("qbo_section_customers")} rows={lists.customers} />
      <ListSection label={t("qbo_section_taxcodes")} rows={lists.taxCodes} />
    </div>
  );
}

function ListSection({
  label,
  rows,
  showType,
}: {
  label: string;
  rows: (Named & { accountType?: string | null })[] | null;
  showType?: boolean;
}) {
  const t = useTranslations("Settings");
  return (
    <details className="rounded-lg border border-border/50">
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
        {label}
        {rows !== null && (
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            ({rows.length})
          </span>
        )}
      </summary>
      <div className="border-t border-border/50 px-3 py-2">
        {rows === null ? (
          <p role="alert" className="text-xs text-muted-foreground">
            {t("qbo_section_error")}
          </p>
        ) : rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("qbo_section_empty")}</p>
        ) : (
          <ul className="max-h-56 divide-y divide-border/50 overflow-y-auto text-xs">
            {rows.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between gap-3 py-1.5"
              >
                <span
                  className={r.active ? "" : "text-muted-foreground line-through"}
                >
                  {r.name}
                </span>
                {showType && r.accountType && (
                  <span className="shrink-0 text-muted-foreground">
                    {r.accountType}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
