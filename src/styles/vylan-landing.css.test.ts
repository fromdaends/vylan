import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// This test exists because of a bug that local browser testing could not see.
//
// The reduced-motion cross-fade was written with its @keyframes INSIDE the
// `@media (prefers-reduced-motion: reduce)` block. That is legal CSS, and
// Chromium resolves it, so every check here passed and the measured fade was
// real. On the founder's browser the name resolved to nothing, the animation
// never ran, and the hero played as a hard slideshow.
//
// The build does not hoist nested keyframes (verified against the deployed
// bundle), so nothing downstream saves us. The rule is simply: @keyframes
// lives at the top level, and every animation-name must resolve to one.

const CSS_FILES = ["vylan-landing.css", "vylan-help.css", "vylan-footer.css"];

/** Strip comments so their contents never look like declarations. */
function stripComments(css: string) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * Every @keyframes in the file, with the at-rule nesting depth it sits at.
 * Depth 0 is top level; anything deeper is inside @media/@supports/@layer.
 */
function keyframesWithDepth(css: string) {
  const found: { name: string; depth: number }[] = [];
  let depth = 0;
  for (let i = 0; i < css.length; i++) {
    if (css.startsWith("@keyframes", i)) {
      const name = css.slice(i + 10).match(/^\s+([\w-]+)/)?.[1];
      if (name) found.push({ name, depth });
    }
    if (css[i] === "{") depth++;
    else if (css[i] === "}") depth--;
  }
  return found;
}

// Everything that can legally appear in an `animation` shorthand and is NOT a
// keyframes name.
const ANIMATION_KEYWORDS = new Set([
  "none", "forwards", "backwards", "both", "infinite", "alternate",
  "alternate-reverse", "reverse", "normal", "linear", "ease", "ease-in",
  "ease-out", "ease-in-out", "step-start", "step-end", "paused", "running",
  "initial", "inherit", "unset", "revert", "auto",
]);

/** Bare identifiers used as animation names across the file. */
function referencedAnimationNames(css: string) {
  const names = new Set<string>();
  const decls = css.matchAll(/animation(?:-name)?\s*:\s*([^;}]+)/g);
  for (const d of decls) {
    const value = d[1]
      .replace(/!important/g, "")
      .replace(/(?:cubic-bezier|steps|linear)\([^)]*\)/g, " ") // easing functions
      .replace(/var\([^)]*\)/g, " ");
    for (const token of value.split(/[\s,]+/)) {
      const t = token.trim();
      if (!t) continue;
      if (ANIMATION_KEYWORDS.has(t)) continue;
      if (/^-?[\d.]+m?s$/.test(t)) continue; // durations / delays
      if (/^-?[\d.]+$/.test(t)) continue; // iteration counts
      if (!/^[a-zA-Z_-][\w-]*$/.test(t)) continue; // not an identifier
      names.add(t);
    }
  }
  return names;
}

describe.each(CSS_FILES)("%s", (file) => {
  const css = stripComments(
    readFileSync(join(process.cwd(), "src/styles", file), "utf8"),
  );

  it("declares every @keyframes at the top level", () => {
    const nested = keyframesWithDepth(css).filter((k) => k.depth > 0);
    expect(
      nested.map((k) => k.name),
      "@keyframes nested inside an at-rule — engines that only resolve top-level keyframes will drop the animation entirely (this shipped once and turned the hero reel into a slideshow)",
    ).toEqual([]);
  });

  it("resolves every animation name to a keyframes block that exists", () => {
    const defined = new Set(keyframesWithDepth(css).map((k) => k.name));
    const dangling = [...referencedAnimationNames(css)].filter(
      (n) => !defined.has(n),
    );
    expect(
      dangling,
      "animation-name with no matching @keyframes in this file — the animation silently does nothing",
    ).toEqual([]);
  });
});

describe("reduced-motion reel cross-fade", () => {
  const css = stripComments(
    readFileSync(join(process.cwd(), "src/styles/vylan-landing.css"), "utf8"),
  );

  it("keeps the fade keyframes the reduced-motion block depends on", () => {
    const topLevel = keyframesWithDepth(css)
      .filter((k) => k.depth === 0)
      .map((k) => k.name);
    expect(topLevel).toContain("vyReduceIn");
    expect(topLevel).toContain("vyReduceOut");
  });

  it("never forces the reel words back to opacity 1", () => {
    // The original double-word bug: the reduced-motion block set opacity:1 on
    // BOTH the incoming and the outgoing word, painting them on top of each
    // other. LandingShell's inline styles now outrank this, but there is no
    // reason for it to come back.
    //
    // The file has several reduced-motion blocks, so match braces rather than
    // trusting a regex to find the right one.
    const blocks: string[] = [];
    const marker = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{/g;
    for (let m = marker.exec(css); m; m = marker.exec(css)) {
      let depth = 1;
      let i = m.index + m[0].length;
      const start = i;
      for (; i < css.length && depth > 0; i++) {
        if (css[i] === "{") depth++;
        else if (css[i] === "}") depth--;
      }
      blocks.push(css.slice(start, i - 1));
    }
    expect(blocks.length, "no reduced-motion blocks found").toBeGreaterThan(0);

    const reelRules = blocks
      .flatMap((b) => b.match(/\.vy-reel-word\.vy-(?:in|out)[^{]*\{[^}]*\}/g) ?? []);
    expect(
      reelRules.length,
      "the reduced-motion reel rules vanished — this test is no longer guarding anything",
    ).toBeGreaterThan(0);
    for (const rule of reelRules) {
      expect(rule, "reduced-motion rule forces a reel word visible").not.toMatch(
        /opacity:\s*1/,
      );
    }
  });
});
