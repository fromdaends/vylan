"use client";

import { useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { usePathname } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Filter, User } from "lucide-react";
import { AUDIT_ACTIONS } from "./audit-actions";

type ClientOption = { id: string; display_name: string };

export function AuditFilters({
  clients,
  client,
  action,
}: {
  clients: ClientOption[];
  client: string;
  action: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [pending, startTransition] = useTransition();
  const t = useTranslations("Audit");

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(search?.toString() ?? "");
    if (value === null || value === "" || value === "all") {
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
    <div className="flex flex-wrap items-center gap-3">
      <Select
        value={client || "all"}
        onValueChange={(v) => setParam("client", v)}
      >
        <SelectTrigger
          size="sm"
          className="w-[15rem]"
          aria-label={t("filter_client_label")}
        >
          <User className="h-3.5 w-3.5 text-muted-foreground" />
          <SelectValue placeholder={t("filter_client_label")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t("filter_all_clients")}</SelectItem>
          {clients.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.display_name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={action || "all"}
        onValueChange={(v) => setParam("action", v)}
      >
        <SelectTrigger
          size="sm"
          className="w-[18rem]"
          aria-label={t("filter_action_label")}
        >
          <Filter className="h-3.5 w-3.5 text-muted-foreground" />
          <SelectValue placeholder={t("filter_action_label")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t("filter_all_actions")}</SelectItem>
          {AUDIT_ACTIONS.map((a) => (
            <SelectItem key={a} value={a}>
              {t(`action_${a}` as Parameters<typeof t>[0])}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {pending && (
        <span className="text-xs text-muted-foreground/70">…</span>
      )}
    </div>
  );
}
