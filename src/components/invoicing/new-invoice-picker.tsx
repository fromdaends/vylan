"use client";

import { useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { InvoiceableEngagement } from "./new-invoice-button";

// Pick an engagement, land on it with the invoice dialog open.
//
// Copy is passed in from the server component rather than read here, so this
// stays a dumb list — the only logic is the filter.
export function NewInvoicePicker({
  engagements,
  labels,
}: {
  engagements: InvoiceableEngagement[];
  labels: {
    button: string;
    title: string;
    hint: string;
    empty: string;
    search: string;
    cancel: string;
  };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return engagements;
    return engagements.filter(
      (e) =>
        e.title.toLowerCase().includes(needle) ||
        (e.clientName ?? "").toLowerCase().includes(needle),
    );
  }, [engagements, q]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-1.5 size-4" />
          {labels.button}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{labels.title}</DialogTitle>
          <DialogDescription>{labels.hint}</DialogDescription>
        </DialogHeader>

        {engagements.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {labels.empty}
          </p>
        ) : (
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={labels.search}
                aria-label={labels.search}
                className="pl-8"
                autoFocus
              />
            </div>

            <ul className="max-h-72 divide-y divide-border/60 overflow-y-auto rounded-md border border-border/50">
              {filtered.map((e) => (
                <li key={e.id}>
                  <button
                    type="button"
                    className="w-full px-3 py-2.5 text-left transition-colors hover:bg-secondary focus-visible:bg-secondary focus-visible:outline-none"
                    onClick={() => {
                      setOpen(false);
                      // ?panel=invoice opens the one invoice dialog there.
                      router.push(`/engagements/${e.id}?panel=invoice`);
                    }}
                  >
                    <span className="block truncate text-sm font-medium">
                      {e.title}
                    </span>
                    {e.clientName && (
                      <span className="block truncate text-xs text-muted-foreground">
                        {e.clientName}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
