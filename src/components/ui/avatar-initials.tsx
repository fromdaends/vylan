import { cn } from "@/lib/cn";

/**
 * Compact avatar that renders an image when one is available and falls
 * back to colored initials when not. Used by the app-shell dropdown
 * trigger and by the profile page.
 *
 * Pass a stable URL (signed and cached for ~24h via getBrandingImageUrl)
 * to avoid re-signing on every render.
 */
export function AvatarInitials({
  src,
  name,
  size = 28,
  color = "#475569",
  className,
  imgClassName,
}: {
  src?: string | null;
  name: string;
  size?: number;
  /** Hex/CSS color for the initials background when there's no image. */
  color?: string;
  className?: string;
  imgClassName?: string;
}) {
  const initials = computeInitials(name);
  const dim = `${size}px`;

  if (src) {
    return (
      <span
        className={cn(
          "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-secondary",
          className,
        )}
        style={{ width: dim, height: dim }}
        aria-label={name}
        title={name}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt=""
          className={cn("h-full w-full object-cover", imgClassName)}
          loading="lazy"
        />
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-medium text-white",
        className,
      )}
      style={{
        width: dim,
        height: dim,
        backgroundColor: color,
        fontSize: Math.max(10, Math.round(size * 0.4)),
      }}
      aria-label={name}
      title={name}
    >
      {initials}
    </span>
  );
}

function computeInitials(raw: string): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return "?";
  // If it looks like an email, take the local part before `@`.
  const base = trimmed.includes("@") ? trimmed.split("@")[0]! : trimmed;
  const parts = base
    .split(/[\s._-]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return base.slice(0, 2).toUpperCase();
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}
