// What a log tab shows when no client's books are connected to read.
//
// Quiet and inside the panel, not a full-page hero: the Bookkeeping page around
// it still has a month-end close section and two sibling tabs, so taking over
// the screen would be a lie about how much is unavailable.

import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { ReceiptIcon } from "@/components/quickbooks/receipt-icon";

export async function NoConnectedClients({ body }: { body: string }) {
  const t = await getTranslations("Quickbooks");
  return (
    <div className="py-12 text-center">
      <div className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-secondary/60 ring-1 ring-inset ring-border/50">
        <ReceiptIcon className="h-6 w-6 text-muted-foreground" />
      </div>
      <p className="mx-auto mt-4 max-w-md text-sm text-muted-foreground">
        {body}
      </p>
      <Link
        href="/clients"
        className="mt-4 inline-block text-sm font-medium text-primary hover:underline"
      >
        {t("gaps_connect_cta")}
      </Link>
    </div>
  );
}
