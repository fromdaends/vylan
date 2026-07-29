// Render each case's HTML to a PNG, so the pipeline is scored on an IMAGE the
// way a real upload arrives — not on text handed to it. Reading a rendered page
// is most of the difficulty; evaluating anything else would flatter the result.
//
// Uses the headless Chrome already on the machine — no new dependency.

import { mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { CASES } from "./cases";

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

export function pngPath(id: string): string {
  return path.join(OUT, `${id}.png`);
}

// Renders any case whose PNG is missing. Returns the ids it could not produce.
export function renderMissing(): string[] {
  const bin = chrome();
  mkdirSync(OUT, { recursive: true });
  const failed: string[] = [];
  for (const c of CASES) {
    const png = pngPath(c.id);
    if (existsSync(png)) continue;
    if (!bin) {
      failed.push(c.id);
      continue;
    }
    // Chrome's --screenshot wants a URL; a temp file next to the output keeps
    // this dependency-free (no local server, no extra package).
    const tmp = path.join(OUT, `${c.id}.html`);
    writeFileSync(tmp, c.html);
    try {
      execFileSync(
        bin,
        [
          "--headless",
          "--disable-gpu",
          "--hide-scrollbars",
          "--window-size=760,1400",
          `--screenshot=${png}`,
          `file://${tmp}`,
        ],
        { stdio: "ignore" },
      );
    } catch {
      /* fall through to the existence check */
    } finally {
      rmSync(tmp, { force: true });
    }
    if (!existsSync(png) || readFileSync(png).length === 0) failed.push(c.id);
  }
  return failed;
}
