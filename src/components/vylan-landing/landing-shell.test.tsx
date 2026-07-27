import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { LandingShell, type LandingShellStrings } from "./landing-shell";
import en from "../../../messages/en.json";

// next-intl's navigation reads routing config + the router at import time;
// none of that is what these tests are about.
vi.mock("@/i18n/navigation", () => ({
  Link: ({
    children,
    href,
    ...rest
  }: {
    children: React.ReactNode;
    href: string;
  } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  usePathname: () => "/",
}));

// These tests exist because of a real bug: the reel used to derive each word's
// resting visibility from its CSS animation, so in any browser where the
// animation did not run the OUTGOING word stayed painted at full strength
// underneath the incoming one and the hero read "with remmiaindielrs.".
// prefers-reduced-motion made it deterministic (a founder screenshot from
// Opera GX), but a battery saver or a dropped animation does the same thing.
//
// happy-dom never runs CSS animations, which makes it exactly the environment
// that used to break — so "how many words are visible" is a faithful check
// here, and these assertions fail against the old implementation.

// Built exactly the way the landing page builds it, from the real copy — so a
// renamed or emptied reel word breaks the test rather than the hero.
const m = en.Vylan;
const S: LandingShellStrings = {
  brand: m.brand_word,
  logoAlt: m.logo_alt,
  menuLabel: m.menu_label,
  closeLabel: m.menu_close,
  headline: m.hero_headline,
  subPrefix: m.hero_subprefix,
  reelWords: m.reel_words,
  brandWord: m.brand_word,
  ctaBook: m.cta_book,
  ctaHowItWorks: m.cta_how_it_works,
  defTerm: m.menu_def_term,
  defAbbr: m.menu_def_abbr,
  defText: m.menu_def_text,
  navHome: m.nav_home,
  navHowItWorks: m.nav_how_it_works,
  navBookDemo: m.nav_book_demo,
  navLogin: m.nav_login,
  navContact: m.nav_contact,
  navHelp: m.nav_help,
  follow: m.follow,
};

// The shell reads real layout to turn scroll position into reel progress, and
// happy-dom has none. Give the hero a height, the window a height, and make
// getBoundingClientRect().top track scrollY the way a sticky hero does.
const HERO_H = 2000;
const WIN_H = 800;
const TOTAL = HERO_H - WIN_H; // the scroll distance the reel spans

let scrollY = 0;

function stubLayout() {
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: WIN_H,
  });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains("vy-hero") ? HERO_H : 0;
    },
  });
  // Every reel word needs a non-zero width or measure() records nothing; the
  // exact value is irrelevant to these assertions.
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get() {
      return 120;
    },
  });
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    const top = this.classList.contains("vy-hero") ? -scrollY : 0;
    return { top, bottom: top + HERO_H, left: 0, right: 0, width: 0, height: 0, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
  };
  // Run rAF callbacks synchronously so a scroll settles inside act().
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
}

/** Scroll to a fraction of the reel's travel and let the handler run. */
function scrollTo(fraction: number) {
  scrollY = Math.round(TOTAL * fraction);
  act(() => {
    window.dispatchEvent(new Event("scroll"));
  });
}

function words(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll<HTMLElement>(".vy-reel-word"),
  );
}

/** Words the shell has explicitly parked at full opacity. */
function shownWords(container: HTMLElement) {
  return words(container)
    .filter((w) => w.style.opacity === "1")
    .map((w) => w.textContent);
}

/**
 * Words whose visibility the shell left for CSS to decide. Every one of these
 * is a word that a browser with animations off is free to paint — the old
 * implementation left BOTH the incoming and the outgoing word here, which is
 * the bug. This should always be empty once the reel has moved.
 */
function undecidedWords(container: HTMLElement) {
  return words(container)
    .filter((w) => w.style.opacity === "")
    .map((w) => w.textContent);
}

describe("LandingShell hero reel", () => {
  beforeEach(() => {
    scrollY = 0;
    stubLayout();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("parks exactly one word at full opacity across the whole cycle", () => {
    const { container } = render(<LandingShell s={S} />);

    // Walk the whole reel, including the fractions where the founder's
    // screenshot showed two words at once.
    for (const p of [0, 0.05, 0.15, 0.2, 0.3, 0.35, 0.39, 0.41]) {
      scrollTo(p);
      expect(
        shownWords(container),
        `not exactly one word shown at scroll fraction ${p}`,
      ).toHaveLength(1);
    }
  });

  it("never leaves a word's visibility up to the animation", () => {
    const { container } = render(<LandingShell s={S} />);

    for (const p of [0.15, 0.2, 0.3, 0.39]) {
      scrollTo(p);
      expect(
        undecidedWords(container),
        `word(s) left for CSS to paint at scroll fraction ${p} — a browser with animations off will show them on top of the current word`,
      ).toEqual([]);
    }
  });

  it("parks exactly one word at full opacity when scrolling back up", () => {
    const { container } = render(<LandingShell s={S} />);

    scrollTo(0.39);
    for (const p of [0.3, 0.2, 0.1, 0]) {
      scrollTo(p);
      expect(
        shownWords(container),
        `not exactly one word shown scrolling up through ${p}`,
      ).toHaveLength(1);
      expect(undecidedWords(container)).toEqual([]);
    }
  });

  it("advances through the words in order as you scroll", () => {
    const { container } = render(<LandingShell s={S} />);

    const seen = [0, 0.15, 0.3, 0.39].map((p) => {
      scrollTo(p);
      return shownWords(container)[0];
    });
    expect(seen).toEqual(S.reelWords.slice(0, 4));
  });

  it("hides the outgoing word rather than leaving it to the animation", () => {
    const { container } = render(<LandingShell s={S} />);

    scrollTo(0.15);
    const [first, second] = words(container);
    // The regression in one assertion: word 0 must be hidden by its own
    // inline style, not by a `vy-out` animation that may never run.
    expect(first.style.opacity).toBe("0");
    expect(second.style.opacity).toBe("1");
  });

  it("leaves only the brand word visible through the finale", () => {
    const { container } = render(<LandingShell s={S} />);
    vi.useFakeTimers();
    try {
      scrollTo(0.6); // past REEL_END — enterFinale()
      act(() => {
        vi.advanceTimersByTime(200); // the 120ms beat-1 timer
      });
      expect(shownWords(container)).toEqual([S.brandWord]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("restores a single reel word when you scroll back out of the finale", () => {
    const { container } = render(<LandingShell s={S} />);

    scrollTo(0.6);
    scrollTo(0.15);
    expect(shownWords(container)).toHaveLength(1);
    expect(undecidedWords(container)).toEqual([]);
  });
});
