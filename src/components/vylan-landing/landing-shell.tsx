"use client";

import { useEffect, useRef } from "react";
import { Link } from "@/i18n/navigation";
import { BirdVideo } from "@/components/vylan-landing/bird-video";
import { VylanMenu } from "@/components/vylan-landing/vylan-menu";

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
const HOLD_MS = 1000; // brand shows, holds 1s, then auto-dissolves
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

function scrollToForm() {
  document
    .getElementById("vy-get-access")
    ?.scrollIntoView({ behavior: "smooth" });
}

export function LandingShell({ s }: { s: LandingShellStrings }) {
  const heroRef = useRef<HTMLElement>(null);
  const reelRef = useRef<HTMLSpanElement>(null);
  const reelMaskRef = useRef<HTMLSpanElement>(null);
  const headlineRef = useRef<HTMLHeadingElement>(null);
  const subPrefixRef = useRef<HTMLSpanElement>(null);
  const ctaRowRef = useRef<HTMLDivElement>(null);
  const cueRef = useRef<HTMLDivElement>(null);

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
    // subPrefix is intentionally NOT faded with the rest of the context: the
    // finale keeps the "We'll chase them with" lead-in visible so the reveal
    // reads as the full sentence "…with vylan", then dissolves it together
    // with the brand at the very end (see enterFinale / exitFinale).
    const ctxEls = [headlineRef.current, ctaRowRef.current];

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
      // Keep the lead-in ("We'll chase them with") visible through the brand
      // reveal so the finale reads as the full sentence "…with vylan".
      const pf = subPrefixRef.current;
      if (pf) {
        pf.classList.remove("vy-pf-fwd", "vy-pf-rev");
        pf.style.transition = "opacity .34s ease, filter .34s ease";
        pf.style.opacity = "1";
        pf.style.filter = "none";
      }
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
              // Dissolve the lead-in in step with the brand so the line exits
              // together instead of leaving "We'll chase them with" hanging.
              if (pf) {
                pf.style.transition = "opacity .34s ease, filter .34s ease";
                pf.style.opacity = "0";
                pf.style.filter = "blur(10px)";
              }
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
      // Restore the lead-in instantly (it's excluded from setCtxFaded, and the
      // finale may have dissolved it).
      if (subPrefixRef.current) {
        const pf = subPrefixRef.current;
        pf.style.transition = "none";
        pf.style.filter = "none";
        pf.style.opacity = "1";
      }
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

  const headlineLines = s.headline.split("\n");

  return (
    <>
      {/* background: the bird animation video, persists while scrolling */}
      <BirdVideo />

      {/* brand + slide-down menu (shared with the manifesto page) */}
      <VylanMenu s={s} />

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
    </>
  );
}
