import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/cn";

// The door into a client's portal — ONE component, wherever the firm is
// offered it.
//
// ⚠️ IT IS A DOOR, NOT A PREVIEW. /r/<token> is the real page the client is
// looking at right now. Rebuilding their view anywhere in the app would be a
// second rendering that drifts from the first, and it would drift in the worst
// direction: the whole question being asked is "what do they actually see?",
// which a subtly-wrong preview answers falsely.
//
// ⚠️ AND IT IS THEIR KEY, NOT A VIEW-AS. The URL is the same one the client
// uses, and anything done inside it is done AS them — so the warning travels
// with the link rather than being remembered separately by each caller. That
// is the whole reason this is a shared piece: the engagement's Client View tab
// and the client profile's Portal access card must not disagree about how
// loudly this is said.

export function PortalDoorLink({
  token,
  label,
  warning,
  className,
}: {
  token: string;
  label: string;
  /** The "you are opening this as them" line. Omitted only where a caller
   *  already says it in its own copy. */
  warning?: string;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <a
        href={`/r/${token}`}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline"
      >
        {label}
        <ExternalLink className="size-3.5" aria-hidden />
      </a>
      {warning && <p className="text-xs text-muted-foreground">{warning}</p>}
    </div>
  );
}
