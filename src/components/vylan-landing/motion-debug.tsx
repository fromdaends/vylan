"use client";

// The hero's motion diagnostic, opened with ?motion=debug (or ?motion=full |
// soft | plain, which also forces a budget).
//
// It exists because three rounds of the scanner work were lost to inferring a
// rendering problem from prose descriptions of it. One screenshot of a live
// readout names the cause instead: whether this browser asked for reduced
// motion, what it reports about itself, what the frames actually measured, and
// which budget won. Deliberately available in production — the machine that
// misbehaves is never the one with a dev server on it.

import type { MotionSignals, MotionTier, FrameSample } from "@/lib/motion/tier";

export type MotionDiagnostics = {
  tier: MotionTier;
  /** Non-null when ?motion= pinned the tier rather than measuring it. */
  forced: MotionTier | null;
  reducedMotion: boolean;
  signals: MotionSignals;
  /** Null until a word swap has been timed. */
  sample: FrameSample | null;
};

const TIER_BLUR: Record<MotionTier, string> = {
  full: "120px blur",
  soft: "24px blur",
  plain: "no blur",
};

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", gap: 10, justifyContent: "space-between" }}>
      <span style={{ opacity: 0.65 }}>{label}</span>
      <span style={{ fontVariantNumeric: "tabular-nums" }}>{value}</span>
    </div>
  );
}

export function MotionDebug({ d }: { d: MotionDiagnostics }) {
  const { signals: s, sample } = d;
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        left: 12,
        bottom: 12,
        zIndex: 9999,
        minWidth: 254,
        padding: "10px 12px",
        borderRadius: 10,
        background: "rgba(8,10,20,0.86)",
        color: "#e8eaf2",
        border: "1px solid rgba(255,255,255,0.16)",
        font: '12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace',
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        pointerEvents: "none",
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 6, letterSpacing: ".04em" }}>
        HERO MOTION{d.forced ? " · FORCED" : ""}
      </div>
      <Row label="effect" value={`${d.tier} · ${TIER_BLUR[d.tier]}`} />
      <Row
        label="movement"
        value={d.reducedMotion ? "off (reduced motion)" : "on"}
      />
      <Row
        label="frames"
        value={
          sample
            ? `${sample.meanMs.toFixed(1)}ms avg · ${sample.worstMs.toFixed(0)}ms worst`
            : "not measured yet"
        }
      />
      <Row
        label="device"
        value={`${s.cores ?? "?"} cores · ${s.deviceMemoryGb ?? "?"}GB${
          s.saveData ? " · data saver" : ""
        }`}
      />
      <div style={{ marginTop: 6, opacity: 0.6, fontSize: 11 }}>
        {d.reducedMotion
          ? "Words dissolve in place — your system asked for no movement."
          : "Scroll the hero to time a word swap."}
      </div>
    </div>
  );
}
