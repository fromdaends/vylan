"use client";

import { useEffect, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { CountUp } from "./count-up";

// The agreement-rate ring — the centerpiece of the page. A track circle plus a
// progress arc that fills to the rate, with the percentage counting up in the
// centre. The fill is set from useEffect (which runs regardless of tab
// visibility) so the arc always reaches its final value; a CSS transition
// sweeps it in when the tab is visible. Under prefers-reduced-motion it snaps.
// When the sample is thin the caller passes `muted` so the ring reads tentative.
export function AiRing({
  rate,
  label,
  muted = false,
  size = 208,
}: {
  rate: number | null;
  label: string;
  muted?: boolean;
  size?: number;
}) {
  const reduce = useReducedMotion();
  const stroke = 14;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const pct = rate == null ? 0 : Math.max(0, Math.min(1, rate));
  const target = circ * (1 - pct);
  const color = muted ? "var(--color-muted-foreground)" : "var(--color-success)";

  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    // Fire from a timer (not the effect body / not the animation frame loop) so
    // it runs even when the tab is hidden, while staying lint-clean.
    const t = setTimeout(() => setDrawn(true), 30);
    return () => clearTimeout(t);
  }, []);
  const offset = drawn ? target : circ;

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--color-border)"
          strokeWidth={stroke}
          opacity={0.5}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          style={{
            transition: reduce
              ? "none"
              : "stroke-dashoffset 0.9s cubic-bezier(0.2, 0.8, 0.2, 1)",
          }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {rate == null ? (
          <span className="text-4xl font-semibold text-muted-foreground/40">—</span>
        ) : (
          <>
            <CountUp
              value={pct * 100}
              format={(n) => `${Math.round(n)}%`}
              durationMs={900}
              className="num-display text-4xl font-semibold tracking-tight text-foreground sm:text-5xl"
            />
            <span className="mt-0.5 text-xs text-muted-foreground">{label}</span>
          </>
        )}
      </div>
    </div>
  );
}
