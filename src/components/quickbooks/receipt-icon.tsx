import { ReceiptText } from "lucide-react";

// One import site for the mark this feature uses, so the empty state, the header
// and any future entry point cannot drift apart.
export function ReceiptIcon({ className }: { className?: string }) {
  return (
    <ReceiptText
      className={className ?? "h-8 w-8 text-muted-foreground"}
      aria-hidden
    />
  );
}
