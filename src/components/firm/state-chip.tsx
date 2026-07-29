import { cn } from "@/lib/cn";

// The one borrowed detail from Canopy that changes how a dense table reads: a
// NEUTRAL capsule with a small coloured dot. The capsule never carries colour —
// the dot does.
//
// Why it matters here: the engagements list currently paints every row (a blue
// pill, a purple pill, an orange pill, plus more chips underneath), so nothing
// stands out and the screen reads as decorated rather than designed. A capsule
// only appears on a row that has something to SAY — an active teammate with a
// clear plate gets none at all.
//
// Deliberately not exported as a general-purpose Badge: the app already has one.
// This is the firm workspace's state marker and it stays scoped to that, so
// nothing elsewhere in the product changes shape.
export function StateChip({
  label,
  tone = "neutral",
}: {
  label: string;
  // neutral = nothing notable · wait = pending on someone else · warn = needs
  // a decision. There is deliberately no "ok" tone: a normal row shows no chip.
  tone?: "neutral" | "wait" | "warn";
}) {
  return (
    <span className="ml-2 inline-flex shrink-0 items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 align-middle text-xs font-normal text-foreground">
      <span
        aria-hidden
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          tone === "wait"
            ? "bg-icon-purple"
            : tone === "warn"
              ? "bg-warning"
              : "bg-muted-foreground/60",
        )}
      />
      {label}
    </span>
  );
}
