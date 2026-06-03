"use client";

import { useEffect, useRef, useState } from "react";
import { Link } from "@/i18n/navigation";
import { BirdVideo } from "@/components/vylan-landing/bird-video";

export type LandingShellStrings = {
  brand: string;
  logoAlt: string;
  menuLabel: string;
  closeLabel: string;
  /** May contain "\n" for an explicit line break. */
  headline: string;
  subPrefix: string;
  /** The 4 cycling words (e.g. "AI.", "follow-ups." …). */
  reelWords: string[];
  brandWord: string;
  ctaBook: string;
  ctaManifesto: string;
  defTerm: string;
  defAbbr: string;
  defText: string;
  navHome: string;
  navManifesto: string;
  navForFirms: string;
  navBookDemo: string;
  navLogin: string;
  follow: string;
};

const REEL_CLASSES = [
  "vy-in",
  "vy-out",
  "vy-in-rev",
  "vy-out-rev",
  "vy-ai-glitch",
  "vy-brand-out",
];
const NW = 4; // cycling words; the 5th reel word is the brand finale
const REEL_END = 0.42; // scroll fraction across which the 4 words cycle
const HOLD_MS = 2350; // brand shows, holds ~2.3s (founder wanted it to linger), then auto-dissolves
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

function scrollToForm() {
  document
    .getElementById("vy-get-access")
    ?.scrollIntoView({ behavior: "smooth" });
}

export function LandingShell({ s }: { s: LandingShellStrings }) {
  const [menuOpen, setMenuOpen] = useState(false);

  const heroRef = useRef<HTMLElement>(null);
  const reelRef = useRef<HTMLSpanElement>(null);
  const reelMaskRef = useRef<HTMLSpanElement>(null);
  const headlineRef = useRef<HTMLHeadingElement>(null);
  const subPrefixRef = useRef<HTMLSpanElement>(null);
  const ctaRowRef = useRef<HTMLDivElement>(null);
  const cueRef = useRef<HTMLDivElement>(null);

  // Close the menu on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // The scroll-pinned reel engine. Ported from the prototype's vanilla
  // JS — crossing a scroll threshold fires a fixed ~0.5s CSS animation
  // that runs to completion (NOT scrubbed by scroll). This imperative,
  // ref-driven shape is the right fit; rebuilding it as React state per
  // frame would fight the carefully-tuned timing.
  useEffect(() => {
    const hero = heroRef.current;
    const reel = reelRef.current;
    const reelMask = reelMaskRef.current;
    const cue = cueRef.current;
    if (!hero || !reel || !reelMask) return;

    const reelWords = Array.from(
      reel.querySelectorAll<HTMLElement>(".vy-reel-word"),
    );
    if (reelWords.length === 0) return;
    const brand = reelWords[reelWords.length - 1];
    const ctxEls = [headlineRef.current, subPrefixRef.current, ctaRowRef.current];

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    const widths: number[] = [];
    function measure() {
      reelWords.forEach((w, i) => {
        widths[i] = w.offsetWidth + 1;
      });
    }
    function syncWidth(i: number) {
      if (widths[i]) reelMask!.style.setProperty("--vy-rw", widths[i] + "px");
    }

    let ticking = false;
    let finaleState: "reel" | "finale" = "reel";
    let stageT: ReturnType<typeof setTimeout>[] = [];
    let shownIdx = -1;

    function setWord(i: number, dir: number) {
      if (i === shownIdx) return;
      const prev = shownIdx;
      shownIdx = i;
      const incoming = reelWords[i];
      const outgoing = prev >= 0 ? reelWords[prev] : null;
      reelWords.forEach((w, k) => {
        if (k !== i && k !== prev) {
          w.classList.remove(...REEL_CLASSES);
          w.style.opacity = "0";
          w.style.filter = "none";
          w.style.transform = "none";
        }
      });
      if (incoming) {
        incoming.classList.remove(...REEL_CLASSES);
        void incoming.offsetWidth;
        incoming.style.opacity = "";
        incoming.style.filter = "";
        incoming.style.transform = "";
        if (prev < 0) {
          incoming.style.opacity = "1";
        } else {
          incoming.classList.add(dir < 0 ? "vy-in-rev" : "vy-in");
        }
      }
      if (outgoing) {
        outgoing.classList.remove(...REEL_CLASSES);
        void outgoing.offsetWidth;
        outgoing.style.opacity = "";
        outgoing.style.filter = "";
        outgoing.style.transform = "";
        outgoing.classList.add(dir < 0 ? "vy-out-rev" : "vy-out");
      }
      if (prev >= 0 && subPrefixRef.current) {
        const pf = subPrefixRef.current;
        pf.classList.remove("vy-pf-fwd", "vy-pf-rev");
        void pf.offsetWidth;
        pf.classList.add(dir < 0 ? "vy-pf-rev" : "vy-pf-fwd");
      }
      syncWidth(i);
    }

    function setCtxFaded(faded: boolean) {
      ctxEls.forEach((el) => {
        if (!el) return;
        el.style.transition = "opacity .34s ease, filter .34s ease";
        el.style.opacity = faded ? "0" : "1";
        el.style.filter = faded ? "blur(10px)" : "none";
      });
    }
    function clearFinaleTimers() {
      stageT.forEach(clearTimeout);
      stageT = [];
    }
    function enterFinale() {
      finaleState = "finale";
      clearFinaleTimers();
      setCtxFaded(true);
      reelWords.forEach((w) => {
        if (w !== brand) {
          w.style.transition = "opacity .34s ease, filter .34s ease";
          w.style.opacity = "0";
          w.style.filter = "blur(10px)";
          w.style.transform = "none";
          w.classList.remove(...REEL_CLASSES);
        }
      });
      shownIdx = -1;
      brand.style.opacity = "0";
      brand.style.filter = "none";
      brand.style.transform = "none";
      stageT.push(
        setTimeout(() => {
          syncWidth(NW);
          brand.style.transition = "none";
          brand.style.textShadow =
            "0 0 46px rgba(255,255,255,.6), 0 0 116px rgba(255,255,255,.34)";
          brand.classList.remove(...REEL_CLASSES);
          brand.classList.add("vy-in");
          void brand.offsetWidth;
          brand.style.opacity = "1";
          stageT.push(
            setTimeout(() => {
              brand.classList.remove(...REEL_CLASSES);
              void brand.offsetWidth;
              brand.style.transition = "none";
              brand.style.opacity = "";
              brand.style.filter = "";
              brand.style.transform = "";
              brand.classList.add("vy-brand-out");
            }, HOLD_MS),
          );
        }, 120),
      );
    }
    function exitFinale() {
      finaleState = "reel";
      clearFinaleTimers();
      brand.classList.remove(...REEL_CLASSES);
      brand.style.textShadow = "none";
      brand.style.filter = "none";
      brand.style.transform = "none";
      brand.style.opacity = "0";
      brand.style.transition = "none";
      reelWords.forEach((w) => {
        w.style.transition = "none";
        w.style.filter = "none";
      });
      setCtxFaded(false);
      shownIdx = -1;
    }

    function targetProgress() {
      const rect = hero!.getBoundingClientRect();
      const total = hero!.offsetHeight - window.innerHeight;
      const scrolled = Math.min(Math.max(-rect.top, 0), total);
      return total > 0 ? scrolled / total : 0;
    }
    function renderAt(p: number) {
      if (p >= REEL_END) {
        if (finaleState === "reel") enterFinale();
        if (cue) cue.style.opacity = "0";
        return;
      }
      if (finaleState === "finale") exitFinale();
      const frac = clamp01(p / REEL_END);
      const i = Math.min(NW - 1, Math.floor(frac * NW));
      const dir = shownIdx < 0 ? 1 : Math.sign(i - shownIdx);
      setWord(i, dir);
      if (cue) cue.style.opacity = p > 0.02 ? "0" : "0.7";
    }
    function onScroll() {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(() => {
          ticking = false;
          renderAt(targetProgress());
        });
      }
    }
    function reset() {
      measure();
      renderAt(targetProgress());
    }
    reset();

    // Recurring chromatic glitch on the first word while it's settled
    // at the top of the reel.
    let glitchInterval: ReturnType<typeof setInterval> | undefined;
    let glitchTimeout: ReturnType<typeof setTimeout> | undefined;
    if (!reduceMotion) {
      const w = reelWords[0];
      const run = () => {
        if (targetProgress() >= 0.02 || shownIdx > 0) return;
        if (
          w.classList.contains("vy-ai-glitch") ||
          w.classList.contains("vy-in") ||
          w.classList.contains("vy-in-rev") ||
          w.classList.contains("vy-out") ||
          w.classList.contains("vy-out-rev")
        )
          return;
        w.classList.add("vy-ai-glitch");
        w.addEventListener(
          "animationend",
          () => w.classList.remove("vy-ai-glitch"),
          { once: true },
        );
      };
      glitchTimeout = setTimeout(run, 260);
      glitchInterval = setInterval(run, 3200);
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", reset);
    window.addEventListener("load", reset);
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(reset);
    }

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", reset);
      window.removeEventListener("load", reset);
      clearFinaleTimers();
      if (glitchTimeout) clearTimeout(glitchTimeout);
      if (glitchInterval) clearInterval(glitchInterval);
    };
  }, []);

  const closeAnd = (fn?: () => void) => () => {
    setMenuOpen(false);
    fn?.();
  };

  const headlineLines = s.headline.split("\n");

  return (
    <>
      {/* background: the bird animation video, persists while scrolling */}
      <BirdVideo />

      {/* top bar — brand opens the menu */}
      <div className="vy-topbar">
        <button
          className="vy-brand"
          type="button"
          aria-label={s.menuLabel}
          onClick={() => setMenuOpen(true)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="vy-logo" src="/vylan-logo-white.png" alt={s.logoAlt} />
          {s.brand}
        </button>
      </div>

      {/* HERO */}
      <section className="vy-hero" ref={heroRef}>
        <div className="vy-hero-sticky">
          <div className="vy-hero-inner">
            <h1 className="vy-headline" ref={headlineRef}>
              {headlineLines.map((line, i) => (
                <span key={i}>
                  {line}
                  {i < headlineLines.length - 1 ? <br /> : null}
                </span>
              ))}
            </h1>
            <div className="vy-subhead">
              <span className="vy-subprefix" ref={subPrefixRef}>
                {s.subPrefix}
              </span>
              <span className="vy-reel-mask" ref={reelMaskRef}>
                <span className="vy-reel" ref={reelRef}>
                  {s.reelWords.map((word, i) => (
                    <span className="vy-reel-word" key={i}>
                      {word}
                    </span>
                  ))}
                  <span className="vy-reel-word vy-reel-brand">
                    {s.brandWord}
                  </span>
                </span>
              </span>
            </div>
            <div className="vy-cta-row" ref={ctaRowRef}>
              <button className="vy-btn" type="button" onClick={scrollToForm}>
                {s.ctaBook}
              </button>
              <Link className="vy-link-btn" href="/manifesto">
                {s.ctaManifesto}
              </Link>
            </div>
          </div>
          <div className="vy-scroll-cue" ref={cueRef} aria-hidden="true">
            ⌄
          </div>
        </div>
      </section>

      {/* MENU OVERLAY */}
      <div
        className={"vy-overlay" + (menuOpen ? " vy-open" : "")}
        onClick={(e) => {
          if (e.target === e.currentTarget) setMenuOpen(false);
        }}
        role="dialog"
        aria-modal="true"
        aria-hidden={!menuOpen}
      >
        <button
          className="vy-menu-close"
          type="button"
          aria-label={s.closeLabel}
          onClick={() => setMenuOpen(false)}
        >
          ×
        </button>
        <div className="vy-menu-card">
          <p className="vy-menu-def">
            <b>{s.defTerm}</b> <span className="vy-mono">{s.defAbbr}</span>
            &nbsp;{s.defText}
          </p>
          <nav className="vy-menu-nav">
            <a href="#" onClick={closeAnd()}>
              {s.navHome} <span className="vy-arr">→</span>
            </a>
            <Link href="/manifesto" onClick={() => setMenuOpen(false)}>
              {s.navManifesto} <span className="vy-arr">→</span>
            </Link>
            <a href="#vy-get-access" onClick={closeAnd(scrollToForm)}>
              {s.navForFirms} <span className="vy-arr">→</span>
            </a>
            <a href="#vy-get-access" onClick={closeAnd(scrollToForm)}>
              {s.navBookDemo} <span className="vy-arr">→</span>
            </a>
            <Link href="/login" onClick={() => setMenuOpen(false)}>
              {s.navLogin} <span className="vy-arr">→</span>
            </Link>
          </nav>
          <div className="vy-menu-follow">
            {s.follow}
            <span className="vy-soc">in</span>
            <span className="vy-soc">𝕏</span>
            <span className="vy-soc">◎</span>
          </div>
        </div>
      </div>
    </>
  );
}
