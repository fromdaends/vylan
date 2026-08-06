// The right rail's box shell (design 2a): white card, radius 14, 18/20
// padding, uppercase kicker heading with an optional corner control. ONE
// drawing for Details, Team and Billing, so "how a rail box looks" is a
// single edit.

import { cn } from "@/lib/cn";

export function RailBox({
  title,
  corner,
  style,
  className,
  children,
}: {
  title: string;
  corner?: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        "rounded-[14px] border border-border bg-card px-5 py-[18px] shadow-card",
        className,
      )}
      style={style}
      aria-label={title}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[11.5px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
          {title}
        </h2>
        {corner}
      </div>
      {children}
    </section>
  );
}

/** A label / value line inside a rail box. */
export function RailRow({
  label,
  children,
  align = "right",
}: {
  label: string;
  children: React.ReactNode;
  align?: "right" | "center";
}) {
  return (
    <div
      className={cn(
        "flex justify-between gap-2.5",
        align === "center" && "items-center",
      )}
    >
      <span className="text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

/** The hairline between row groups. */
export function RailDivider() {
  return <div aria-hidden className="my-[3px] h-px bg-border/60" />;
}
