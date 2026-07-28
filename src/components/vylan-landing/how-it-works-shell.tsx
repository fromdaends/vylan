"use client";

// "What we do / how it works" marketing page body. Ported from the Claude
// Design "Vylan What We Do" handoff (2026 redesign: Statement hero) and
// rebranded to the live Vylan marketing system: the design's #2347F2 / Archivo
// / Hanken became our --vy-blue (#1050ed) and Schibsted Grotesk, and the
// centred logo + footer come from the shared marketing components so this page
// can never drift. The redesign added: the centred aura hero with a secondary
// scroll CTA, the integrations wordmark marquee, and the "Invoicing built in"
// showcase (invoice mock + the <3-min and direct-settlement cards).
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

import { useEffect, useRef, type CSSProperties } from "react";
import {
  WorkflowAutomation,
  type WorkflowAutomationStrings,
} from "./workflow-automation";
import {
  WaveClose,
  WaveFiling,
  WaveHero,
  WavePay,
  WaveProblem,
  WaveTrust,
} from "./wwd-waves";

type HowItWorksStrings = {
  heroEyebrow: string;
  heroTitle: string; // may contain "\n" line breaks
  heroSub: string;
  ctaBook: string;
  ctaSeeHow: string;
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
  integrationsLabel: string;
  integrationsHelp: string;
  // "Auto-filing": the dark band. `folders` is the sample tree read top-down —
  // each entry is one level deeper than the last, so the indent is positional
  // and a translator can rename a folder without touching the layout.
  filing: {
    eyebrow: string;
    title: string;
    body: string;
    rules: { title: string; body: string }[];
    treeYours: string;
    treeNamed: string;
    folders: string[];
    fileName: string;
    fileBadge: string;
    fileWas: string;
    fileWasName: string;
    into: string;
    providers: string[];
  };
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
  // "Invoicing built in": the intro block + the invoice mock's literal strings.
  inv: {
    eyebrow: string;
    title: string;
    body: string;
    mockNumber: string;
    mockFormat: string;
    lines: { label: string; amount: string; tax?: boolean; auto?: string }[];
    totalLabel: string;
    total: string;
    foot: string;
    directTitle: string;
    directBody: string;
  };
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

function scrollToHow() {
  document.getElementById("wwd-how")?.scrollIntoView({ behavior: "smooth" });
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
function IconCardFlat({ stroke }: { stroke: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <path d="M2.5 10h19" />
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

// --- Auto-filing: tree glyphs + the three storage wordmarks ---

function IconFolder({ stroke }: { stroke: string }) {
  return (
    <svg width="15" height="13" viewBox="0 0 16 14" fill="none" stroke={stroke} strokeWidth="1.4" aria-hidden="true">
      <path d="M1 2h5l1.5 2H15v9H1z" />
    </svg>
  );
}
function IconFile() {
  return (
    <svg width="14" height="16" viewBox="0 0 14 17" fill="none" stroke="var(--wwd-mint)" strokeWidth="1.4" aria-hidden="true">
      <path d="M1 1h8l4 4v11H1z" />
      <path d="M9 1v4h4" />
    </svg>
  );
}
// Brand marks, drawn rather than loaded: the page ships no third-party image
// requests, and at 17px a path is sharper than a downscaled PNG.
function LogoGoogleDrive() {
  return (
    <svg width="17" height="15" viewBox="0 0 87.3 78" aria-hidden="true">
      <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066DA" />
      <path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0-1.2 4.5h27.5z" fill="#00AC47" />
      <path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.5l5.85 11.5z" fill="#EA4335" />
      <path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832D" />
      <path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684FC" />
      <path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#FFBA00" />
    </svg>
  );
}
function LogoDropbox() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M6 1.807 0 5.629l6 3.822 6.001-3.822L6 1.807zM18 1.807l-6 3.822 6 3.822 6-3.822-6-3.822zM0 13.274l6 3.822 6.001-3.822L6 9.452l-6 3.822zM18 9.452l-6 3.822 6 3.822 6-3.822-6-3.822zM6 18.371l6.001 3.822 6-3.822-6-3.822L6 18.371z"
        fill="#0061FF"
      />
    </svg>
  );
}
function LogoMicrosoft() {
  return (
    <svg width="20" height="13" viewBox="0 0 24 16" aria-hidden="true">
      <path d="M18.5 15.5h-12a5.5 5.5 0 0 1-.9-10.93A7 7 0 0 1 19 5.9a4.85 4.85 0 0 1-.5 9.6z" fill="#0078D4" />
    </svg>
  );
}

const FILING_LOGOS = [
  <LogoGoogleDrive key="google" />,
  <LogoDropbox key="dropbox" />,
  <LogoMicrosoft key="microsoft" />,
];

// The trust band is the page's one LIGHT surface (cream #F4F2EC), so these
// four are the only icons on the page not tuned for the blue: the page's
// mint/cyan/violet/coral wash out on cream, and these are their dark twins
// from the design.
const TRUST_ICONS = [
  <IconSignature key="sig" stroke="#0E9D68" />,
  <IconShield key="shield" stroke="#0B7FBE" />,
  <IconGlobe key="globe" stroke="#6E4FD0" />,
  <IconCircleCheck key="check" stroke="#D95B36" />,
];
const PAY_ICONS = [
  <IconDoc key="doc" stroke="var(--wwd-cyan)" />,
  <IconCircleCheck key="rev" stroke="#fff" />,
  <IconCard key="pay" stroke="#0e3a2a" />,
];

// One marquee set: the five wordmarks with dot separators. Repeated N times
// for the seamless -50% loop. Purely decorative text — hidden from the
// accessibility tree (the section label carries the meaning).
function MarqueeSet() {
  return (
    <div className="wwd-marquee-set" aria-hidden="true">
      <span className="wwd-mark-stripe">stripe</span>
      <span className="wwd-mark-dot" />
      <span className="wwd-mark-paypal">
        <span className="wwd-mark-paypal-pay">Pay</span>
        <span className="wwd-mark-paypal-pal">Pal</span>
      </span>
      <span className="wwd-mark-dot" />
      <span className="wwd-mark-quickbooks">quickbooks</span>
      <span className="wwd-mark-dot" />
      <span className="wwd-mark-xero">xero</span>
      <span className="wwd-mark-dot" />
      <span className="wwd-mark-sage">sage</span>
      <span className="wwd-mark-dot" />
    </div>
  );
}

export function HowItWorksShell({
  s,
  helpHref,
}: {
  s: HowItWorksStrings;
  /** Locale-prefixed /help, resolved on the server (same value the menu gets). */
  helpHref: string;
}) {
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
      // Pay stat bar: fill as the card scrolls from ~90% to ~22% of the
      // viewport — the founder's design-session refinement ("require slightly
      // more scrolling for it to fill up"; was 42%).
      if (payBar) {
        const br = payBar.getBoundingClientRect();
        const start = vh * 0.9;
        const end = vh * 0.22;
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

      {/* ---------- HERO: Kinetic (the founder's chosen variant) ---------- */}
      <section className="wwd-hero" aria-label={s.heroEyebrow}>
        <div className="wwd-grid" aria-hidden="true" />
        <WaveHero />
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
              <button type="button" className="wwd-link-btn" onClick={scrollToHow}>
                {s.ctaSeeHow}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ---------- THE PROBLEM ---------- */}
      <section className="wwd-section wwd-problem">
        <WaveProblem />
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
      <section className="wwd-section wwd-steps" id="wwd-how" data-spine-section>
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

      {/* ---------- INTEGRATIONS MARQUEE ---------- */}
      <section className="wwd-integrations" aria-label={s.integrationsLabel}>
        <div className="wwd-integrations-head" data-reveal>
          <div className="wwd-eyebrow wwd-integrations-label">
            {s.integrationsLabel}
          </div>
          {/* The design hardcodes /help-center; the real help centre is the
              locale-prefixed /help, resolved on the server. Opens in a new tab
              like every other help link on the marketing pages, so a visitor
              part-way down this page doesn't lose their place. */}
          <a
            className="wwd-integrations-help"
            href={helpHref}
            target="_blank"
            rel="noopener noreferrer"
          >
            {s.integrationsHelp}
          </a>
        </div>
        <div className="wwd-marquee" data-reveal data-reveal-delay="120">
          <div className="wwd-marquee-row">
            {Array.from({ length: 6 }, (_, i) => (
              <MarqueeSet key={i} />
            ))}
          </div>
        </div>
      </section>

      {/* ---------- AUTO-FILING (dark band) ----------
          Where the design puts it: after the integrations belt (which names
          the storage you already have) and before the money. It is the only
          section on a near-black panel, which is the point — it reads as the
          quiet thing happening underneath the rest of the page. */}
      <section className="wwd-filing" aria-labelledby="wwd-filing-title">
        <WaveFiling />
        <div className="wwd-filing-inner">
          <div className="wwd-filing-left">
            <div data-reveal>
              <div className="wwd-eyebrow wwd-eyebrow-gold">
                {s.filing.eyebrow}
              </div>
              <h2 className="wwd-h2" id="wwd-filing-title">
                {s.filing.title}
              </h2>
              <p className="wwd-filing-body">{s.filing.body}</p>
            </div>
            <div className="wwd-filing-rules" data-reveal data-reveal-delay="140">
              {s.filing.rules.map((rule, i) => (
                <div className="wwd-filing-rule" key={i}>
                  <span className="wwd-filing-rule-num" aria-hidden="true">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <p className="wwd-filing-rule-text">
                    <strong>{rule.title}</strong> {rule.body}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* The mock: a firm's own folder tree with one freshly filed
              document at the bottom. Monospace throughout, so the renamed
              file reads as a filename rather than as prose. */}
          <div className="wwd-filing-tree">
            <div
              className="wwd-filing-tree-head"
              data-reveal
              data-reveal-delay="120"
            >
              <span>{s.filing.treeYours}</span>
              <span className="wwd-filing-tree-named">{s.filing.treeNamed}</span>
            </div>
            {s.filing.folders.map((folder, i) => (
              <div
                className="wwd-filing-row"
                key={i}
                style={{ "--wwd-depth": i } as CSSProperties}
                data-reveal
                data-reveal-delay={`${160 + i * 80}`}
              >
                <IconFolder
                  stroke={
                    i === s.filing.folders.length - 1
                      ? "var(--wwd-gold)"
                      : "rgba(255,255,255,.55)"
                  }
                />
                {folder}
              </div>
            ))}
            <div
              className="wwd-filing-row wwd-filing-file"
              style={
                { "--wwd-depth": s.filing.folders.length } as CSSProperties
              }
              data-reveal
              data-reveal-delay="520"
            >
              <IconFile />
              <div className="wwd-filing-file-body">
                <div className="wwd-filing-file-line">
                  <span className="wwd-filing-file-name">
                    {s.filing.fileName}
                  </span>
                  <span className="wwd-filing-file-badge">
                    <span className="wwd-filing-file-dot" aria-hidden="true" />
                    {s.filing.fileBadge}
                  </span>
                </div>
                <div className="wwd-filing-file-was">
                  {s.filing.fileWas}{" "}
                  <span className="wwd-filing-file-old">
                    {s.filing.fileWasName}
                  </span>
                </div>
              </div>
            </div>
            <div className="wwd-filing-into" data-reveal data-reveal-delay="600">
              <span className="wwd-filing-into-label">{s.filing.into}</span>
              {s.filing.providers.map((name, i) => (
                <span className="wwd-filing-provider" key={name}>
                  {FILING_LOGOS[i]}
                  <span className="wwd-filing-provider-name">{name}</span>
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ---------- PAYMENT PIPELINE ---------- */}
      <section className="wwd-section wwd-pay">
        <WavePay />
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

        {/* ---------- Invoicing built in: intro + mock + side cards ---------- */}
        <div className="wwd-inv-head" data-reveal data-reveal-delay="160">
          <div className="wwd-eyebrow wwd-eyebrow-mint">{s.inv.eyebrow}</div>
          <div className="wwd-inv-title">{s.inv.title}</div>
          <p className="wwd-inv-body">{s.inv.body}</p>
        </div>
        <div className="wwd-inv-grid" data-reveal data-reveal-delay="220">
          <div className="wwd-inv-doc">
            <div className="wwd-inv-doc-top">
              <span className="wwd-inv-doc-label">{s.inv.mockNumber}</span>
              <span className="wwd-inv-doc-label wwd-inv-doc-label-dim">
                {s.inv.mockFormat}
              </span>
            </div>
            <div className="wwd-inv-lines">
              {s.inv.lines.map((line, i) => (
                <div
                  key={i}
                  className={
                    "wwd-inv-line" + (line.tax ? " wwd-inv-line-tax" : "")
                  }
                >
                  <span>
                    {line.label}
                    {line.auto ? (
                      <span className="wwd-inv-auto"> — {line.auto}</span>
                    ) : null}
                  </span>
                  <span className="wwd-inv-amt">{line.amount}</span>
                </div>
              ))}
            </div>
            <div className="wwd-inv-total">
              <span className="wwd-inv-doc-label">{s.inv.totalLabel}</span>
              <span className="wwd-inv-total-num">{s.inv.total}</span>
            </div>
            <p className="wwd-inv-foot">{s.inv.foot}</p>
          </div>

          <div className="wwd-inv-side">
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
            <div className="wwd-inv-direct">
              <span className="wwd-inv-direct-icon">
                <IconCardFlat stroke="var(--wwd-mint)" />
              </span>
              <div>
                <div className="wwd-pay-stat-title">{s.inv.directTitle}</div>
                <p className="wwd-pay-stat-text">{s.inv.directBody}</p>
              </div>
            </div>
          </div>
        </div>
        <div className="wwd-pay-caption" data-reveal data-reveal-delay="260">
          {s.payCaption}
        </div>
      </section>

      {/* ---------- TRUST & SECURITY ---------- */}
      <section className="wwd-section wwd-trust">
        <WaveTrust />
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
        <WaveClose />
        <div className="wwd-close-aura" aria-hidden="true" />
        <h2 className="wwd-close-title" data-reveal>
          {lines(s.closeTitle).map((line, i, arr) => (
            <span key={i}>
              {line}
              {i < arr.length - 1 ? <br /> : null}
            </span>
          ))}
        </h2>
        <div className="wwd-close-cta" data-reveal data-reveal-delay="160">
          <button type="button" className="vy-btn" onClick={scrollToForm}>
            {s.ctaBook}
          </button>
        </div>
      </section>
    </div>
  );
}
