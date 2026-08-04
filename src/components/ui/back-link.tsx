import { ArrowLeft } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";

/**
 * The one way back from a detail page.
 *
 * TWO SHAPES, ONE COMPONENT — the client profile wants a labelled link on its
 * own line above the header, and the engagement detail page wants a bare arrow
 * sitting inline before the title (Canopy's orientation, which the founder
 * asked for by name). Those are the same object at two sizes, so they are a
 * `variant` prop rather than two files: restyling "back" should move both.
 *
 *   row    — arrow + visible label, its own line. The default.
 *   inline — arrow only, sized to sit against a heading. `label` becomes the
 *            accessible name and the hover tooltip, so the destination is
 *            still announced and still discoverable with a mouse.
 *
 * `label` is REQUIRED in both shapes. An icon-only control with no accessible
 * name is a control a screen reader cannot describe, and "back" alone does not
 * say back to WHERE — every caller here can name its list.
 */
export function BackLink({
  href,
  label,
  variant = "row",
  className,
}: {
  href: string;
  label: string;
  variant?: "row" | "inline";
  className?: string;
}) {
  if (variant === "inline") {
    return (
      <Link
        href={href}
        aria-label={label}
        title={label}
        className={cn(
          "inline-flex size-8 shrink-0 items-center justify-center rounded-[7px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground",
          className,
        )}
      >
        <ArrowLeft className="size-4" aria-hidden />
      </Link>
    );
  }

  return (
    <Link
      href={href}
      className={cn(
        "-ml-2 inline-flex items-center gap-1.5 rounded-[7px] px-2 py-1 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground",
        className,
      )}
    >
      <ArrowLeft className="size-3.5" aria-hidden />
      {label}
    </Link>
  );
}
