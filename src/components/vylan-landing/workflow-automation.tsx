"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// The landing page's "Workflow automation" section — a live, playable miniature
// of the engagement-stage board.
//
// Imported from the "Vylan What We Do" design (Claude Design project ef1c4ddf).
// That file is the source for the /how-it-works page, and this was the one
// section in it that had never been built; the founder wanted it on the LANDING
// page rather than how-it-works, so it lives here rather than in
// how-it-works-shell.
//
// It is a DEMO, not the product: fixed sample engagements, no data, no network.
// It exists to make one claim tangible — that an engagement moves through its
// stages on its own — which is hard to convey in prose and obvious in three
// seconds of watching.
//
// COLOURS come from the design, not from the app's --stage-* tokens, on purpose.
// The product's "Collecting documents" blue (#46a2ff) is nearly the landing
// page's own background (#1050ed) and would vanish; the design re-picks each hue
// for this surface. The LABELS, by contrast, are the app's real Stage strings —
// the designer copied them verbatim from the product, so the section reads them
// from that namespace and follows a rename automatically.

// Marketing palette, tuned for the blue landing background.
const STAGE_COLORS = [
  "#74D0FF", // collecting
  "#FFD98E", // in review
  "#B69CFF", // in preparation
  "#7EE8DC", // awaiting signature
  "#FF9E80", // awaiting payment
  "#63E2A8", // paid — the resting state; has no filter chip
] as const;

// Only the first five are filterable. The sixth ("Paid") is where work ENDS, and
// the product doesn't offer it as a filter either — a finished engagement lives
// under Completed, not on the active board.
const FILTERABLE_COUNT = 5;
const PAID = 5;

export type WorkflowAutomationStrings = {
  eyebrow: string;
  title: string;
  body: string;
  panelLabel: string;
  play: string;
  playing: string;
  replay: string;
  all: string;
  moved: string;
  empty: string;
  foot: string;
  // Six labels: the five real stage names from the Stage namespace, then "Paid".
  stageLabels: string[];
  rows: { name: string; sub: string }[];
};

type Row = { id: string; stage: number };

// Where each sample engagement starts. Chosen so the board looks like a real
// firm's — work spread across the pipeline, not lined up.
const INITIAL: Row[] = [
  { id: "b", stage: 0 },
  { id: "t", stage: 1 },
  { id: "n", stage: 3 },
  { id: "a", stage: 4 },
];

// The play sequence: which row advances, and when. Staggered so each move is
// legible on its own instead of the whole board twitching at once.
const SCRIPT: { id: string; at: number }[] = [
  { id: "b", at: 500 },
  { id: "t", at: 1600 },
  { id: "n", at: 2700 },
  { id: "a", at: 3800 },
];
const SCRIPT_END = 6200;

type Sim = "idle" | "running" | "done";

export function WorkflowAutomation({ s }: { s: WorkflowAutomationStrings }) {
  const rootRef = useRef<HTMLElement>(null);
  const timers = useRef<number[]>([]);
  const [filter, setFilter] = useState(-1);
  const [rows, setRows] = useState<Row[]>(INITIAL);
  const [moved, setMoved] = useState<string | null>(null);
  const [sim, setSim] = useState<Sim>("idle");

  const clearTimers = useCallback(() => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  }, []);

  // Reveal-on-scroll. Self-contained rather than reusing the how-it-works
  // observer: that one is CSS-gated on `.vy-wwd.wwd-js`, a scope the landing
  // page doesn't have, so its rules would never match here.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const reveals = Array.from(
      root.querySelectorAll<HTMLElement>("[data-wa-reveal]"),
    );
    const reduce =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Reduced motion: show the finished state at once, no transitions.
    if (reduce) {
      reveals.forEach((el) => el.classList.add("wa-in"));
      return;
    }
    root.classList.add("wa-js");
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          const el = e.target as HTMLElement;
          const d = parseInt(el.getAttribute("data-wa-reveal") || "0", 10);
          window.setTimeout(() => el.classList.add("wa-in"), d);
          io.unobserve(el);
        });
      },
      { threshold: 0.14, rootMargin: "0px 0px -6% 0px" },
    );
    reveals.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  // Never leave a timer pointing at an unmounted component.
  useEffect(() => clearTimers, [clearTimers]);

  const advance = useCallback((id: string) => {
    setRows((prev) =>
      prev.map((r) =>
        r.id === id ? { ...r, stage: Math.min(r.stage + 1, PAID) } : r,
      ),
    );
    setMoved(id);
  }, []);

  const run = useCallback(() => {
    if (sim === "running") return;
    clearTimers();
    const start = () => {
      setSim("running");
      setMoved(null);
      SCRIPT.forEach(({ id, at }) => {
        timers.current.push(window.setTimeout(() => advance(id), at));
      });
      timers.current.push(
        window.setTimeout(() => {
          setSim("done");
          setMoved(null);
        }, SCRIPT_END),
      );
    };
    // A second press replays from the top: rewind, beat, go.
    if (sim === "done") {
      setRows(INITIAL);
      setMoved(null);
      timers.current.push(window.setTimeout(start, 600));
    } else {
      start();
    }
  }, [sim, advance, clearTimers]);

  const playLabel = sim === "running" ? s.playing : sim === "done" ? s.replay : s.play;
  const visible = filter < 0 ? rows : rows.filter((r) => r.stage === filter);
  const countAt = (i: number) =>
    i < 0 ? rows.length : rows.filter((r) => r.stage === i).length;

  return (
    <section ref={rootRef} className="wa" aria-labelledby="wa-title">
      <div className="wa-head" data-wa-reveal="0">
        <div className="wa-eyebrow">{s.eyebrow}</div>
        <h2 className="wa-h2" id="wa-title">
          {s.title}
        </h2>
        <p className="wa-body">{s.body}</p>
      </div>

      <div className="wa-panel" data-wa-reveal="140">
        <div className="wa-panel-top">
          <div className="wa-panel-label">{s.panelLabel}</div>
          <button type="button" className="wa-play" onClick={run}>
            <svg width="11" height="12" viewBox="0 0 12 12" aria-hidden>
              <path d="M2 1.2v9.6l8.4-4.8z" fill="currentColor" />
            </svg>
            {playLabel}
          </button>
        </div>

        {/* Filter chips. The product's own board offers exactly these five (a
            finished engagement leaves the active list), so the demo can't imply
            a filter that doesn't exist. */}
        <div className="wa-chips" role="group" aria-label={s.eyebrow}>
          <button
            type="button"
            className="wa-chip"
            aria-pressed={filter === -1}
            onClick={() => setFilter(-1)}
          >
            {s.all}
            {/* NBSP, per the design: the count is part of the label, so it must
                never wrap away from it on a narrow screen. */}
            <span className="wa-chip-n">{"\u00a0"}({countAt(-1)})</span>
          </button>
          {Array.from({ length: FILTERABLE_COUNT }, (_, i) => (
            <button
              key={i}
              type="button"
              className="wa-chip"
              aria-pressed={filter === i}
              onClick={() => setFilter(filter === i ? -1 : i)}
              style={{ ["--wa-c" as string]: STAGE_COLORS[i] }}
            >
              <span className="wa-chip-dot" aria-hidden />
              {s.stageLabels[i]}
              <span className="wa-chip-n">{"\u00a0"}({countAt(i)})</span>
            </button>
          ))}
        </div>

        <div className="wa-rows">
          {visible.map((r) => {
            const idx = rows.findIndex((x) => x.id === r.id);
            const meta = s.rows[idx] ?? s.rows[0];
            const color = STAGE_COLORS[Math.min(r.stage, PAID)];
            return (
              <div className="wa-row" key={r.id} style={{ ["--wa-c" as string]: color }}>
                <div className="wa-row-main">
                  <div className="wa-row-titleline">
                    <span className="wa-row-name">{meta.name}</span>
                    {moved === r.id && (
                      <span className="wa-moved">
                        <span className="wa-moved-dot" aria-hidden />
                        {s.moved}
                      </span>
                    )}
                  </div>
                  <div className="wa-row-sub">{meta.sub}</div>
                </div>

                {/* The pipeline itself: one dot per stage, filled behind, hollow
                    ahead. This is the claim the section is making, drawn. */}
                <div className="wa-track" aria-hidden>
                  {Array.from({ length: FILTERABLE_COUNT }, (_, i) => {
                    const done = r.stage > i || r.stage >= PAID;
                    const current = r.stage === i;
                    return (
                      <span className="wa-node" key={i}>
                        <span
                          className={
                            "wa-dot" +
                            (current ? " wa-dot-on" : done ? " wa-dot-done" : "")
                          }
                          style={{ ["--wa-c" as string]: STAGE_COLORS[i] }}
                        />
                        {i < FILTERABLE_COUNT - 1 && <span className="wa-link" />}
                      </span>
                    );
                  })}
                </div>

                <span className="wa-pill">{s.stageLabels[Math.min(r.stage, PAID)]}</span>
              </div>
            );
          })}
          {visible.length === 0 && <div className="wa-empty">{s.empty}</div>}
        </div>
      </div>

      <p className="wa-foot" data-wa-reveal="200">
        {s.foot}
      </p>
    </section>
  );
}
