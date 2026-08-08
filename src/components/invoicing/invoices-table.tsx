"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Link, useRouter } from "@/i18n/navigation";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { MoreHorizontal, BellRing, BellOff } from "lucide-react";
import { formatCurrency, formatDate, type AppLocale } from "@/lib/format";
import { cn } from "@/lib/cn";
import { InvoiceStatusBadge } from "./invoice-status-badge";
import { RecordPaymentDialog } from "./record-payment-dialog";
import type { InvoiceListRow } from "@/lib/invoices/list";
import {
  remindInvoiceNowAction,
  setAutoChaseAction,
  voidInvoiceAction,
} from "@/app/actions/billing-invoices";

export function InvoicesTable({
  rows,
  portalBase,
}: {
  rows: InvoiceListRow[];
  // Absolute origin for the client payment links, resolved on the server so
  // "Copy payment link" produces a URL the client can actually open rather
  // than whatever host the accountant's browser happens to be on.
  portalBase: string;
}) {
  const t = useTranslations("FirmBilling");
  const locale = (useLocale() === "fr" ? "fr" : "en") as AppLocale;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [recording, setRecording] = useState<InvoiceListRow | null>(null);
  const [voiding, setVoiding] = useState<InvoiceListRow | null>(null);

  const run = (
    fn: () => Promise<{ ok: boolean; reason?: string }>,
    okMessage: string,
  ) => {
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        toast.success(okMessage);
        router.refresh();
        return;
      }
      toast.error(
        res.reason === "not_chaseable"
          ? t("remind_err_not_chaseable")
          : t("generic_err"),
      );
    });
  };

  const copyLink = async (row: InvoiceListRow) => {
    if (!row.portalToken) {
      toast.error(t("generic_err"));
      return;
    }
    try {
      await navigator.clipboard.writeText(
        `${portalBase}/r/${row.portalToken}`,
      );
      toast.success(t("copy_ok"));
    } catch {
      toast.error(t("generic_err"));
    }
  };

  return (
    <>
      <div className="overflow-x-auto rounded-lg border border-border/50">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("col_number")}</TableHead>
              <TableHead>{t("col_client")}</TableHead>
              <TableHead className="hidden md:table-cell">
                {t("col_engagement")}
              </TableHead>
              <TableHead className="text-right">{t("col_amount")}</TableHead>
              <TableHead className="hidden sm:table-cell">
                {t("col_issued")}
              </TableHead>
              <TableHead>{t("col_status")}</TableHead>
              <TableHead className="hidden lg:table-cell">
                {t("col_method")}
              </TableHead>
              <TableHead className="w-10">
                <span className="sr-only">{t("col_actions")}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const overdue = row.status === "overdue";
              return (
                <TableRow
                  key={row.id}
                  // The warning treatment the spec asks for: a tint on the
                  // whole row, so a page of invoices reads as a page with
                  // three problems on it without anyone scanning a column.
                  className={cn(overdue && "bg-destructive/[0.04]")}
                >
                  <TableCell className="font-medium tabular-nums">
                    {row.invoiceNumber ?? (
                      <span className="text-muted-foreground">
                        {t("no_number")}
                      </span>
                    )}
                    {row.autoChase && row.chaseCount > 0 && (
                      <span
                        className="ml-1.5 inline-flex align-middle text-muted-foreground"
                        title={
                          row.chaseCount === 1
                            ? t("chase_sent_one")
                            : t("chase_sent", { count: row.chaseCount })
                        }
                      >
                        <BellRing className="size-3" />
                      </span>
                    )}
                  </TableCell>

                  <TableCell className="max-w-[180px] truncate">
                    {row.clientId ? (
                      <Link
                        href={`/clients/${row.clientId}`}
                        className="hover:underline"
                      >
                        {row.clientName ?? "—"}
                      </Link>
                    ) : (
                      (row.clientName ?? "—")
                    )}
                  </TableCell>

                  <TableCell className="hidden max-w-[220px] truncate md:table-cell">
                    {row.engagementId ? (
                      <Link
                        href={`/engagements/${row.engagementId}`}
                        className="hover:underline"
                      >
                        {row.engagementTitle ?? "—"}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </TableCell>

                  <TableCell className="text-right tabular-nums">
                    <div>{formatCurrency(row.amountCents / 100, locale)}</div>
                    {/* The charged total leads; the tax inside it is the
                        supporting detail, which is the order an accountant
                        reads an invoice line in. */}
                    {row.taxTotalCents != null && row.taxTotalCents > 0 && (
                      <div className="text-[11px] text-muted-foreground">
                        {t("amount_incl_tax", {
                          tax: formatCurrency(row.taxTotalCents / 100, locale),
                        })}
                      </div>
                    )}
                    {/* A partial only makes sense shown against the total. */}
                    {row.status === "partly_paid" && (
                      <div className="text-[11px] text-muted-foreground">
                        {t("amount_of_total", {
                          paid: formatCurrency(
                            row.amountPaidCents / 100,
                            locale,
                          ),
                          total: formatCurrency(row.amountCents / 100, locale),
                        })}
                      </div>
                    )}
                  </TableCell>

                  <TableCell className="hidden whitespace-nowrap text-muted-foreground sm:table-cell">
                    {formatDate(row.issuedOn, locale, "medium")}
                    {row.dueDate && (
                      <div className="text-[11px]">
                        {t("due_on", {
                          date: formatDate(row.dueDate, locale, "short"),
                        })}
                      </div>
                    )}
                  </TableCell>

                  <TableCell>
                    <InvoiceStatusBadge status={row.status} />
                  </TableCell>

                  <TableCell className="hidden text-muted-foreground lg:table-cell">
                    {row.paymentMethod ? t(`method_${row.paymentMethod}`) : "—"}
                  </TableCell>

                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          aria-label={t("col_actions")}
                        >
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-56">
                        {row.engagementId && (
                          <DropdownMenuItem asChild>
                            <Link href={`/engagements/${row.engagementId}`}>
                              {t("action_view")}
                            </Link>
                          </DropdownMenuItem>
                        )}
                        {/* Only a generated invoice has a Vylan-rendered PDF;
                            an attached one is the accountant's own file and a
                            plain row has no document at all. */}
                        {row.invoiceKind === "generated" && (
                          <DropdownMenuItem asChild>
                            <a
                              href={`/api/invoices/${row.id}/pdf`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {t("action_pdf")}
                            </a>
                          </DropdownMenuItem>
                        )}
                        {row.portalToken && (
                          <DropdownMenuItem onSelect={() => copyLink(row)}>
                            {t("action_copy_link")}
                          </DropdownMenuItem>
                        )}

                        {row.settleable && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onSelect={() => setRecording(row)}
                            >
                              {t("action_record_payment")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={pending}
                              onSelect={() =>
                                run(
                                  () => remindInvoiceNowAction(row.id),
                                  t("remind_ok"),
                                )
                              }
                            >
                              {t("action_remind")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={pending}
                              onSelect={() =>
                                run(
                                  () =>
                                    setAutoChaseAction(row.id, !row.autoChase),
                                  row.autoChase
                                    ? t("chase_off_ok")
                                    : t("chase_on_ok"),
                                )
                              }
                            >
                              {row.autoChase ? (
                                <BellOff className="mr-2 size-3.5" />
                              ) : (
                                <BellRing className="mr-2 size-3.5" />
                              )}
                              {row.autoChase
                                ? t("action_chase_off")
                                : t("action_chase_on")}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onSelect={() => setVoiding(row)}
                            >
                              {t("action_void")}
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {recording && (
        <RecordPaymentDialog
          invoice={recording}
          open
          onOpenChange={(o) => !o && setRecording(null)}
        />
      )}

      {/* Voiding keeps the row and its number forever, but there is no undo,
          so it asks first. */}
      <Dialog open={!!voiding} onOpenChange={(o) => !o && setVoiding(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("void_title")}</DialogTitle>
            <DialogDescription>{t("void_body")}</DialogDescription>
            {/* THE MONEY SENTENCE, rescued from the deleted Billing settings
                tab and moved to the moment it actually protects someone: an
                invoice with a part-payment on it can be voided, and "nothing
                is owed" reads to most people as "they got their money back".
                It did not. Stating it in a card two clicks away was already
                weak; stating it here is the point. */}
            <DialogDescription className="text-xs">
              {t("settings_refunds_note")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setVoiding(null)}
              disabled={pending}
            >
              {t("cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() => {
                const target = voiding;
                if (!target) return;
                setVoiding(null);
                run(() => voidInvoiceAction(target.id), t("void_ok"));
              }}
            >
              {t("void_confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
