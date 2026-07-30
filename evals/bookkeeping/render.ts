// Render each case to an image, so the pipeline is scored on a PICTURE the way a
// real upload arrives — not on text handed to it. Reading a rendered page is most
// of the difficulty; evaluating anything else would flatter the result.
//
// Uses the headless Chrome already on the machine — no new dependency.
//
// CAPTURE MODES. The first version of this harness rendered every case as a
// pristine 760px screenshot, which is not what arrives. A real document is a
// phone photo taken at an angle on a desk, or a thermal receipt that has faded
// in a wallet, or something scanned on a machine from 2009. Those artefacts are
// most of what makes extraction hard, so each case now declares how it was
// captured and the wrapper below simulates it.
//
// DETERMINISTIC ON PURPOSE. Every distortion is derived from a hash of the case
// id, never from a random number, so a case looks identical on every run. A
// score that moved because the dice rolled differently would be worthless for
// telling whether a prompt change helped.

import {
  mkdirSync,
  writeFileSync,
  existsSync,
  rmSync,
  readFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { CASES, type Capture, type EvalCase } from "./cases";

const OUT = path.join(import.meta.dirname, "rendered");

function chrome(): string | null {
  return (
    [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    ].find((p) => existsSync(p)) ?? null
  );
}

// A stable small integer per case id, so each case gets its own distortion and
// keeps it forever.
function seed(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h);
}
// Pick from a range deterministically. `n` distinguishes several draws per case.
function pick(id: string, n: number, lo: number, hi: number): number {
  const s = seed(id + ":" + n);
  return lo + (s % 1000) / 1000 * (hi - lo);
}

// A paper-grain / sensor-noise texture, self-contained as an SVG data URI so the
// harness stays dependency-free.
function grain(opacity: number, freq: number): string {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'>` +
    `<filter id='n'><feTurbulence type='fractalNoise' baseFrequency='${freq}' numOctaves='3'/></filter>` +
    `<rect width='240' height='240' filter='url(#n)' opacity='${opacity}'/></svg>`;
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
}

type CaptureSpec = {
  // Chrome window size for the render.
  width: number;
  height: number;
  // Final JPEG quality (1-100). null = keep the lossless PNG.
  jpegQuality: number | null;
  // Longest edge of the final image, or null to keep the render size.
  maxEdge: number | null;
  // CSS wrapped around the case's own markup.
  css: (id: string) => string;
};

const CAPTURES: Record<Capture, CaptureSpec> = {
  // A clean scan or a PDF export. The easy case, and the baseline: if a case
  // fails even here, the problem is comprehension, not image quality.
  clean: {
    width: 760,
    height: 1400,
    jpegQuality: null,
    maxEdge: null,
    css: () => "",
  },

  // Phone photo on a desk: shot at an angle, one side lit and the other in
  // shadow, slightly out of focus, then squashed by the phone's own JPEG
  // encoder. This is how the large majority of receipts actually arrive.
  photo: {
    width: 900,
    height: 1250,
    jpegQuality: 38,
    maxEdge: 1000,
    css: (id) => `
      html { background: #2c2a27; }
      body {
        width: 760px !important;
        margin: 0 auto !important;
        transform:
          perspective(1400px)
          rotateX(${pick(id, 1, 2, 7).toFixed(2)}deg)
          rotateZ(${pick(id, 2, -3.4, 3.4).toFixed(2)}deg)
          scale(0.86);
        transform-origin: 50% 40%;
        box-shadow: 0 30px 60px rgba(0,0,0,.55);
        filter:
          blur(${pick(id, 3, 0.3, 0.9).toFixed(2)}px)
          saturate(1.06)
          contrast(0.95)
          brightness(1.03);
      }
      /* Window light falling across the page, plus sensor grain. */
      body::after {
        content: "";
        position: fixed; inset: -20%;
        background:
          ${grain(0.1, 0.85)},
          linear-gradient(${pick(id, 4, 60, 130).toFixed(0)}deg,
            rgba(255,250,235,.34) 0%,
            rgba(255,255,255,0) 42%,
            rgba(15,12,8,.3) 100%);
        mix-blend-mode: multiply;
        pointer-events: none;
      }`,
  },

  // Thermal till roll that has been in a wallet: narrow, monospace, and the ink
  // has given up. Faded low-contrast text is the single most common reason a
  // total comes back wrong.
  thermal: {
    width: 420,
    height: 1100,
    jpegQuality: 45,
    maxEdge: 620,
    css: (id) => `
      html { background: #d8d5cf; }
      body {
        /* The shared CSS pins the body at 760px, which overflows a till roll and
           silently clipped the totals column clean off the right edge. */
        width: 400px !important;
        padding: 22px 18px !important;
        font-family: "Courier New", monospace !important;
        /* Faded, NOT destroyed: the bar is "a careful human can still read it".
           An illegible case measures nothing. */
        filter:
          grayscale(1)
          contrast(${pick(id, 5, 0.78, 0.9).toFixed(2)})
          brightness(1.04)
          blur(${pick(id, 6, 0.1, 0.28).toFixed(2)}px);
        transform: rotateZ(${pick(id, 7, -1.4, 1.4).toFixed(2)}deg);
      }
      /* Full width so nothing is pushed off the roll. */
      .tot { width: 100% !important; }
      /* Vertical banding where the print head has worn. */
      body::after {
        content: "";
        position: fixed; inset: 0;
        background:
          ${grain(0.1, 1.1)},
          repeating-linear-gradient(90deg,
            rgba(255,255,255,0) 0 26px,
            rgba(255,255,255,.28) 26px 30px);
        pointer-events: none;
      }`,
  },

  // Photocopy of a fax of a scan. Crushed to black and white, dust on the
  // platen, and skewed by the feeder. Rare but it is what "we'll send it over"
  // still means at some firms.
  faded: {
    width: 800,
    height: 1200,
    jpegQuality: 30,
    maxEdge: 780,
    css: (id) => `
      html { background: #efeee9; }
      body {
        width: 740px !important;
        filter: grayscale(1) contrast(1.42) brightness(1.06);
        transform: rotateZ(${pick(id, 8, -2.6, 2.6).toFixed(2)}deg) scale(0.95);
      }
      body::after {
        content: "";
        position: fixed; inset: 0;
        background: ${grain(0.15, 1.6)};
        mix-blend-mode: multiply;
        pointer-events: none;
      }`,
  },
};

export function captureOf(c: EvalCase): Capture {
  return c.capture ?? "clean";
}

export function imagePath(c: EvalCase): string {
  const ext = CAPTURES[captureOf(c)].jpegQuality == null ? "png" : "jpg";
  return path.join(OUT, `${c.id}.${ext}`);
}

export function imageMime(c: EvalCase): string {
  return CAPTURES[captureOf(c)].jpegQuality == null ? "image/png" : "image/jpeg";
}

// sips ships with macOS; on anything else the JPEG step is skipped and the case
// is scored on the lossless render (easier, and reported as such).
function sips(args: string[]): boolean {
  const r = spawnSync("sips", args, { stdio: "ignore", timeout: 20_000 });
  return r.status === 0;
}

// TAKE THE SCREENSHOT AND GO.
//
// Chrome writes the PNG and then lingers instead of exiting, so waiting for the
// process cost 45 seconds PER CASE — the full set took longer than the harness
// timeout. Sharing one profile made it worse: the next launch blocked on the
// previous Chrome's profile lock.
//
// So: give each render its own throwaway profile (no lock contention), poll for
// the file, and kill Chrome the moment it appears. ~1-2s per case. The polling
// happens inside `sh` so the whole thing stays synchronous from Node's side.
const CHROME_FLAGS = [
  "--headless=new",
  "--disable-gpu",
  "--hide-scrollbars",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-extensions",
  "--disable-background-networking",
  "--disable-sync",
  "--disable-default-apps",
  "--mute-audio",
];

function shellQuote(v: string): string {
  return `'${v.replace(/'/g, `'\\''`)}'`;
}

// Returns true when the screenshot landed.
function screenshot(
  bin: string,
  profile: string,
  size: string,
  out: string,
  url: string,
): boolean {
  const cmd = [
    shellQuote(bin),
    `--user-data-dir=${shellQuote(profile)}`,
    ...CHROME_FLAGS,
    `--window-size=${size}`,
    `--screenshot=${shellQuote(out)}`,
    shellQuote(url),
    ">/dev/null 2>&1 &",
  ].join(" ");
  const script = [
    cmd,
    "pid=$!",
    // Up to 30s, checking every 100ms.
    `for i in $(seq 1 300); do [ -s ${shellQuote(out)} ] && break; sleep 0.1; done`,
    // A moment for the write to finish before pulling the rug out.
    "sleep 0.4",
    "kill $pid 2>/dev/null",
    "wait $pid 2>/dev/null",
    "exit 0",
  ].join("\n");
  spawnSync("sh", ["-c", script], {
    stdio: "ignore",
    timeout: 60_000,
    killSignal: "SIGKILL",
  });
  return existsSync(out) && readFileSync(out).length > 0;
}

// Renders any case whose image is missing. Returns the ids it could not produce.
export function renderMissing(): string[] {
  const bin = chrome();
  mkdirSync(OUT, { recursive: true });
  const failed: string[] = [];
  for (const c of CASES) {
    const out = imagePath(c);
    if (existsSync(out) && readFileSync(out).length > 0) continue;
    if (!bin) {
      failed.push(c.id);
      continue;
    }
    const spec = CAPTURES[captureOf(c)];
    const tmp = path.join(OUT, `${c.id}.html`);
    const png = path.join(OUT, `${c.id}.render.png`);
    // The capture CSS goes AFTER the case's own styles so it wins.
    writeFileSync(tmp, `${c.html}\n<style>${spec.css(c.id)}</style>`);
    const profile = path.join(OUT, `.p-${c.id}`);
    try {
      screenshot(
        bin,
        profile,
        `${spec.width},${spec.height}`,
        png,
        `file://${tmp}`,
      );
      if (spec.jpegQuality != null && existsSync(png)) {
        // Downscale first, then re-encode: doing both is what produces the soft,
        // blocky look of a real phone upload.
        if (spec.maxEdge != null) sips(["-Z", String(spec.maxEdge), png]);
        sips([
          "-s", "format", "jpeg",
          "-s", "formatOptions", String(spec.jpegQuality),
          png, "--out", out,
        ]);
        // No sips (non-macOS): fall back to the lossless render so the case
        // still runs.
        if (!existsSync(out)) writeFileSync(out, readFileSync(png));
      } else if (existsSync(png)) {
        writeFileSync(out, readFileSync(png));
      }
    } catch {
      /* fall through to the existence check */
    } finally {
      rmSync(tmp, { force: true });
      rmSync(png, { force: true });
      rmSync(profile, { recursive: true, force: true });
    }
    if (!existsSync(out) || readFileSync(out).length === 0) failed.push(c.id);
  }
  return failed;
}
