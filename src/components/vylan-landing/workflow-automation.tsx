"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// The "Workflow automation" section of the What we do / how it works page — a
// live, playable miniature of the engagement-stage board.
//
// Imported from the "Vylan What We Do" design (Claude Design project ef1c4ddf),
// which is the source for this whole page; this was the one section in it that
// had never been built. It sits where the design puts it: after the four-step
// walkthrough, before the payment pipeline.
//
// It is a DEMO, not the product: fixed sample engagements, no data, no network.
// It exists to make one claim tangible — that an engagement moves through its
// stages on its own — which is hard to convey in prose and obvious in three
// seconds of watching.
//
// COLOURS come from the design, not from the app's --stage-* tokens, on purpose.
// The product's "Collecting documents" blue (#46a2ff) is nearly this page's own
// background (#1050ed) and would vanish; the design re-picks each hue for a blue
// surface. The LABELS, by contrast, are the app's real Stage strings — the
// designer copied them verbatim from the product, so the page reads them from
// that namespace and follows a rename automatically.
//
// Reveal-on-scroll is the PAGE's own: [data-reveal] + the observer in
// how-it-works-shell, which walks its whole subtree and already honours
// prefers-reduced-motion. This component only marks the blocks; it deliberately
// brings no observer of its own.

// Marketing palette, tuned for the blue page background.
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
  const timers = useRef<number[]>([]);
  const [filter, setFilter] = useState(-1);
  const [rows, setRows] = useState<Row[]>(INITIAL);
  const [moved, setMoved] = useState<string | null>(null);
  const [sim, setSim] = useState<Sim>("idle");

  const clearTimers = useCallback(() => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
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
    <section className="wwd-section wwd-wf" aria-labelledby="wwd-wf-title">
      <div className="wwd-wf-head" data-reveal>
        <div className="wwd-eyebrow wwd-eyebrow-violet">{s.eyebrow}</div>
        <h2 className="wwd-h2" id="wwd-wf-title">
          {s.title}
        </h2>
        <p className="wwd-wf-body">{s.body}</p>
      </div>

      <div className="wwd-wf-panel" data-reveal data-reveal-delay="140">
        <div className="wwd-wf-top">
          <div className="wwd-wf-label">{s.panelLabel}</div>
          <button type="button" className="wwd-wf-play" onClick={run}>
            <svg width="11" height="12" viewBox="0 0 12 12" aria-hidden>
              <path d="M2 1.2v9.6l8.4-4.8z" fill="currentColor" />
            </svg>
            {playLabel}
          </button>
        </div>

        {/* Filter chips. The product's own board offers exactly these five (a
            finished engagement leaves the active list), so the demo can't imply
            a filter that doesn't exist. */}
        <div className="wwd-wf-chips" role="group" aria-label={s.eyebrow}>
          <button
            type="button"
            className="wwd-wf-chip"
            aria-pressed={filter === -1}
            onClick={() => setFilter(-1)}
          >
            {s.all}
            {/* NBSP: the count belongs to the label and must never wrap away
                from it. */}
            <span className="wwd-wf-n">{"\u00a0"}({countAt(-1)})</span>
          </button>
          {Array.from({ length: FILTERABLE_COUNT }, (_, i) => (
            <button
              key={i}
              type="button"
              className="wwd-wf-chip"
              aria-pressed={filter === i}
              onClick={() => setFilter(filter === i ? -1 : i)}
              style={{ ["--wwd-c" as string]: STAGE_COLORS[i] }}
            >
              <span className="wwd-wf-dot" aria-hidden />
              {s.stageLabels[i]}
              <span className="wwd-wf-n">{"\u00a0"}({countAt(i)})</span>
            </button>
          ))}
        </div>

        <div className="wwd-wf-rows">
          {visible.map((r) => {
            const idx = rows.findIndex((x) => x.id === r.id);
            const meta = s.rows[idx] ?? s.rows[0];
            const color = STAGE_COLORS[Math.min(r.stage, PAID)];
            return (
              <div
                className="wwd-wf-row"
                key={r.id}
                style={{ ["--wwd-c" as string]: color }}
              >
                <div className="wwd-wf-main">
                  <div className="wwd-wf-titleline">
                    <span className="wwd-wf-name">{meta.name}</span>
                    {moved === r.id && (
                      <span className="wwd-wf-moved">
                        <span className="wwd-wf-moved-dot" aria-hidden />
                        {s.moved}
                      </span>
                    )}
                  </div>
                  <div className="wwd-wf-sub">{meta.sub}</div>
                </div>

                {/* The pipeline itself: one dot per stage, filled behind, hollow
                    ahead. This is the claim the section makes, drawn. */}
                <div className="wwd-wf-track" aria-hidden>
                  {Array.from({ length: FILTERABLE_COUNT }, (_, i) => {
                    const done = r.stage > i || r.stage >= PAID;
                    const current = r.stage === i;
                    return (
                      <span className="wwd-wf-node" key={i}>
                        <span
                          className={
                            "wwd-wf-tdot" +
                            (current
                              ? " wwd-wf-tdot-on"
                              : done
                                ? " wwd-wf-tdot-done"
                                : "")
                          }
                          style={{ ["--wwd-c" as string]: STAGE_COLORS[i] }}
                        />
                        {i < FILTERABLE_COUNT - 1 && (
                          <span className="wwd-wf-link" />
                        )}
                      </span>
                    );
                  })}
                </div>

                <span className="wwd-wf-pill">
                  {s.stageLabels[Math.min(r.stage, PAID)]}
                </span>
              </div>
            );
          })}
          {visible.length === 0 && <div className="wwd-wf-empty">{s.empty}</div>}
        </div>
      </div>

      <p className="wwd-wf-foot" data-reveal data-reveal-delay="200">
        {s.foot}
      </p>
    </section>
  );
}
