"use client";

// "What we do / how it works" marketing page body. Ported from the Claude
// Design "Vylan What We Do" handoff (Kinetic hero), then rebrandeded to the
// live Vylan marketing system: the design's #2347F2 / Archivo / Hanken became
// our --vy-blue (#1050ed) and Schibsted Grotesk, and the centred logo + footer
// come from the shared marketing components so this page can never drift.
//
// All copy lives in the `VylanHowItWorks` i18n namespace (passed via the
// useTranslations hook). The accent system is intentional: amber = the messy
// problem, cyan = the AI, mint = getting paid, plus four distinct icon hues on
// the trust cards.
//
// Motion: the headline rises line by line on load, every block fades up as it
// enters the viewport (IntersectionObserver), and the walkthrough has a scroll
// progress "spine" that fills and lights each numbered node. It is all gated
// behind `prefers-reduced-motion` and a `.wwd-js` class, so with motion
// reduced (or JS off) every word is shown immediately, fully legible.

import { useEffect, useRef } from "react";
import {
  WorkflowAutomation,
  type WorkflowAutomationStrings,
} from "./workflow-automation";

type HowItWorksStrings = {
  heroEyebrow: string;
  heroTitle: string; // may contain "\n" line breaks
  heroSub: string;
  ctaBook: string;
  problemEyebrow: string;
  problemTitle: string;
  problemChips: string[];
  problemBody: string;
  stepsEyebrow: string;
  stepsTitle: string;
  steps: { kicker: string; title: string; body: string }[];
  // The playable stage-board demo. Nested rather than flattened: it's a whole
  // section's worth of strings, and it owns its own component.
  workflow: WorkflowAutomationStrings;
  payEyebrow: string;
  payTitlePre: string;
  payTitleWord: string;
  payBody: string;
  paySteps: { title: string; body: string }[];
  payStatBig: string;
  payStatUnit: string;
  payStatTitle: string;
  payStatBody: string;
  payCaption: string;
  trustEyebrow: string;
  trustTitle: string;
  trustIntro: string;
  trustCards: { title: string; body: string; badge?: string }[];
  closeTitle: string; // may contain "\n"
};

function scrollToForm() {
  document
    .getElementById("vy-get-access")
    ?.scrollIntoView({ behavior: "smooth" });
}

function lines(text: string) {
  return text.split("\n");
}

// --- Accent icons (inline SVG, stroke colour set per the accent system) ---

function IconDoc({ stroke }: { stroke: string }) {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6M9 17h4" />
    </svg>
  );
}
function IconCircleCheck({ stroke }: { stroke: string }) {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12l3 3 5-6" />
    </svg>
  );
}
function IconCard({ stroke }: { stroke: string }) {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.6" />
      <path d="M6 9.5v0M18 14.5v0" />
    </svg>
  );
}
function IconSignature({ stroke }: { stroke: string }) {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 17c3-1 4-9 7-9s2 6 4 6 2-3 4-3" />
      <path d="M14 19l2 2 4-4" />
    </svg>
  );
}
function IconShield({ stroke }: { stroke: string }) {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}
function IconGlobe({ stroke }: { stroke: string }) {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3c2.6 2.6 2.6 15.4 0 18M12 3c-2.6 2.6-2.6 15.4 0 18" />
    </svg>
  );
}

const TRUST_ICONS = [
  <IconSignature key="sig" stroke="var(--wwd-mint)" />,
  <IconShield key="shield" stroke="var(--wwd-cyan)" />,
  <IconGlobe key="globe" stroke="var(--wwd-violet)" />,
  <IconCircleCheck key="check" stroke="var(--wwd-coral)" />,
];
const PAY_ICONS = [
  <IconDoc key="doc" stroke="var(--wwd-cyan)" />,
  <IconCircleCheck key="rev" stroke="#fff" />,
  <IconCard key="pay" stroke="#0e3a2a" />,
];

export function HowItWorksShell({ s }: { s: HowItWorksStrings }) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const reveals = Array.from(
      root.querySelectorAll<HTMLElement>("[data-reveal]"),
    );
    const fill = root.querySelector<HTMLElement>("[data-spine-fill]");
    const nodes = Array.from(root.querySelectorAll<HTMLElement>("[data-node]"));
    const payBar = root.querySelector<HTMLElement>("[data-pay-bar]");

    const reduce =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Reduced motion (or no JS): show the finished state immediately — every
    // block visible, the spine full, every node lit. No transitions.
    if (reduce) {
      reveals.forEach((el) => el.classList.add("wwd-in"));
      if (fill) fill.style.transform = "scaleY(1)";
      nodes.forEach((n) => n.classList.add("wwd-node-on"));
      if (payBar) payBar.style.transform = "scaleX(1)";
      return;
    }

    // Arm the animated states (hidden-until-revealed, headline line-up). The
    // class has to land on the `.vy-wwd` scope (the page wrapper), because every
    // gated rule is written `.vy-wwd.wwd-js ...`. This shell's own root is a
    // CHILD of `.vy-wwd`, so target the ancestor — putting it on `root` here
    // silently disabled every reveal + the headline entrance.
    const scope = root.closest<HTMLElement>(".vy-wwd") ?? root;
    scope.classList.add("wwd-js");

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          const el = e.target as HTMLElement;
          const d = parseInt(el.getAttribute("data-reveal-delay") || "0", 10);
          window.setTimeout(() => el.classList.add("wwd-in"), d);
          io.unobserve(el);
        });
      },
      { threshold: 0.14, rootMargin: "0px 0px -6% 0px" },
    );
    reveals.forEach((el) => io.observe(el));

    // Scroll spine: fill proportional to how far the walkthrough has scrolled
    // past the mid-line, and light each node as it crosses ~62% of the viewport.
    let ticking = false;
    const render = () => {
      const sec = root.querySelector<HTMLElement>("[data-spine-section]");
      const vh = window.innerHeight;
      if (sec && fill) {
        const r = sec.getBoundingClientRect();
        const total = r.height - vh * 0.5;
        const passed = Math.min(Math.max(vh * 0.5 - r.top, 0), total > 0 ? total : 0);
        const p = total > 0 ? passed / total : 0;
        fill.style.transform = "scaleY(" + p.toFixed(3) + ")";
      }
      nodes.forEach((n) => {
        const nr = n.getBoundingClientRect();
        if (nr.top < vh * 0.62) n.classList.add("wwd-node-on");
        else n.classList.remove("wwd-node-on");
      });
      // Pay stat bar: fill as the card scrolls from ~90% to ~42% of the viewport.
      if (payBar) {
        const br = payBar.getBoundingClientRect();
        const start = vh * 0.9;
        const end = vh * 0.42;
        const p = Math.min(Math.max((start - br.top) / (start - end), 0), 1);
        payBar.style.transform = "scaleX(" + p.toFixed(3) + ")";
      }
    };
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        render();
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    render();

    return () => {
      io.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return (
    <div ref={rootRef}>
      {/* fixed atmospheric background (soft top light + deep bottom) */}
      <div className="wwd-bg" aria-hidden="true" />

      {/* ---------- HERO: Kinetic ---------- */}
      <section className="wwd-hero" aria-label={s.heroEyebrow}>
        <div className="wwd-grid" aria-hidden="true" />
        <div className="wwd-hero-inner">
          <div className="wwd-eyebrow wwd-load" style={{ animationDelay: "0.05s" }}>
            {s.heroEyebrow}
          </div>
          <h1 className="wwd-hero-title">
            {lines(s.heroTitle).map((line, i) => (
              <span
                key={i}
                className="wwd-line"
                style={{ animationDelay: `${0.12 + i * 0.14}s` }}
              >
                {line}
              </span>
            ))}
          </h1>
          <div className="wwd-hero-foot wwd-load" style={{ animationDelay: "0.58s" }}>
            <p className="wwd-sub">{s.heroSub}</p>
            <div className="wwd-cta-row">
              <button type="button" className="vy-btn" onClick={scrollToForm}>
                {s.ctaBook}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ---------- THE PROBLEM ---------- */}
      <section className="wwd-section wwd-problem">
        <div className="wwd-eyebrow" data-reveal>
          {s.problemEyebrow}
        </div>
        <h2 className="wwd-h2" data-reveal data-reveal-delay="80">
          {s.problemTitle}
        </h2>
        <div className="wwd-chips">
          {s.problemChips.map((chip, i) => (
            <span
              key={i}
              className="wwd-chip"
              data-reveal
              data-reveal-delay={`${i * 90}`}
            >
              {chip}
            </span>
          ))}
        </div>
        <p className="wwd-lead" data-reveal data-reveal-delay="120">
          {s.problemBody}
        </p>
      </section>

      {/* ---------- HOW IT WORKS (walkthrough + spine) ---------- */}
      <section className="wwd-section wwd-steps" data-spine-section>
        <div className="wwd-steps-head" data-reveal>
          <div className="wwd-eyebrow">{s.stepsEyebrow}</div>
          <h2 className="wwd-h2 wwd-center">{s.stepsTitle}</h2>
        </div>
        <div className="wwd-spine">
          <div className="wwd-spine-track" aria-hidden="true" />
          <div className="wwd-spine-fill" data-spine-fill aria-hidden="true" />
          {s.steps.map((step, i) => (
            <div className="wwd-step" key={i}>
              <div className="wwd-node" data-node aria-hidden="true">
                {String(i + 1).padStart(2, "0")}
              </div>
              <div className="wwd-step-body" data-reveal>
                <div className="wwd-kicker">{step.kicker}</div>
                <h3 className="wwd-step-title">{step.title}</h3>
                <p className="wwd-step-text">{step.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- WORKFLOW AUTOMATION ----------
          Where the design puts it: straight after the four-step walkthrough
          (which explains what happens) and before the payment pipeline — this
          is the section that SHOWS it happening. */}
      <WorkflowAutomation s={s.workflow} />

      {/* ---------- PAYMENT PIPELINE ---------- */}
      <section className="wwd-section wwd-pay">
        <div className="wwd-pay-head" data-reveal>
          <div className="wwd-eyebrow wwd-eyebrow-cyan">{s.payEyebrow}</div>
          <h2 className="wwd-h2 wwd-center">
            {s.payTitlePre} <span className="wwd-paid">{s.payTitleWord}</span>.
          </h2>
          <p className="wwd-pay-body">{s.payBody}</p>
        </div>
        <div className="wwd-rail" data-reveal data-reveal-delay="120">
          <div className="wwd-rail-line" aria-hidden="true" />
          <div className="wwd-rail-dash" aria-hidden="true" />
          <div className="wwd-rail-steps">
            {s.paySteps.map((step, i) => (
              <div className="wwd-pay-step" key={i}>
                <span
                  className={
                    "wwd-pay-icon" + (i === 2 ? " wwd-pay-icon-paid" : "")
                  }
                >
                  {PAY_ICONS[i]}
                </span>
                <div className="wwd-pay-step-title">{step.title}</div>
                <p className="wwd-pay-step-text">{step.body}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="wwd-pay-stat" data-reveal data-reveal-delay="200">
          <div className="wwd-pay-stat-card">
            <div className="wwd-pay-stat-num" aria-hidden="true">
              <span className="wwd-pay-stat-big">{s.payStatBig}</span>
              <span className="wwd-pay-stat-unit">{s.payStatUnit}</span>
            </div>
            <div className="wwd-pay-stat-main">
              <div className="wwd-pay-stat-title">{s.payStatTitle}</div>
              <p className="wwd-pay-stat-text">{s.payStatBody}</p>
              <div className="wwd-pay-bar-track" aria-hidden="true">
                <div className="wwd-pay-bar-fill" data-pay-bar />
              </div>
            </div>
          </div>
        </div>
        <div className="wwd-pay-caption" data-reveal data-reveal-delay="220">
          {s.payCaption}
        </div>
      </section>

      {/* ---------- TRUST & SECURITY ---------- */}
      <section className="wwd-section wwd-trust">
        <div className="wwd-trust-layout">
          <div className="wwd-trust-head" data-reveal>
            <div className="wwd-eyebrow">{s.trustEyebrow}</div>
            <h2 className="wwd-h2">{s.trustTitle}</h2>
            <p className="wwd-trust-intro">{s.trustIntro}</p>
          </div>
          <div className="wwd-trust-rows">
            {s.trustCards.map((card, i) => (
              <div
                className="wwd-trust-row"
                key={i}
                data-reveal
                data-reveal-delay={`${[0, 90, 160, 230][i] ?? 0}`}
              >
                <span className="wwd-trust-icon">{TRUST_ICONS[i]}</span>
                <div className="wwd-trust-row-body">
                  <div className="wwd-trust-row-head">
                    <h3 className="wwd-trust-title">{card.title}</h3>
                    {card.badge && (
                      <span className="wwd-trust-badge">{card.badge}</span>
                    )}
                  </div>
                  <p className="wwd-trust-text">{card.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- CLOSING ---------- */}
      <section className="wwd-close">
        <div className="wwd-close-aura" aria-hidden="true" />
        <h2 className="wwd-close-title" data-reveal>
          {lines(s.closeTitle).map((line, i, arr) => (
            <span key={i}>
              {line}
              {i < arr.length - 1 ? <br /> : null}
            </span>
          ))}
        </h2>
      </section>
    </div>
  );
}
