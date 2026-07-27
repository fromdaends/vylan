import { describe, it } from "vitest";
import type { Gray } from "./frame-metrics";
import { detectQuad } from "./detect-quad";

function makeGray(width: number, height: number, fill = 0): Gray {
  const data = new Uint8ClampedArray(width * height);
  if (fill !== 0) data.fill(fill);
  return { data, width, height };
}

function unitNoise(i: number, seed: number): number {
  let s = 0;
  for (let k = 0; k < 4; k++) {
    let x = (Math.imul(i + 1, 2654435761) ^ Math.imul(k + seed * 31 + 1, 40503)) >>> 0;
    x ^= x >>> 15;
    x = Math.imul(x, 2246822519) >>> 0;
    x ^= x >>> 13;
    s += (x >>> 8) / 16777216 - 0.5;
  }
  return s / 0.5774;
}

function addNoise(g: Gray, sd: number, seed = 1): void {
  for (let i = 0; i < g.data.length; i++) {
    g.data[i] = Math.round(g.data[i] + unitNoise(i, seed) * sd);
  }
}

function softCircle(
  w: number,
  h: number,
  cx: number,
  cy: number,
  r: number,
  base: number,
  step: number,
  soft: number,
): Gray {
  const g = makeGray(w, h, base);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = Math.hypot(x - cx, y - cy);
      const t = Math.max(0, Math.min(1, (r - d + soft) / (2 * soft)));
      g.data[y * w + x] = Math.round(base + step * t);
    }
  }
  return g;
}

describe("probe", () => {
  it("plate sweep", () => {
    let hit = 0;
    let total = 0;
    const rows: string[] = [];
    for (const r of [34, 40, 46, 50]) {
      for (const step of [20, 24, 28, 30]) {
        for (const seed of [1, 2, 3]) {
          for (const soft of [2, 3]) {
            const g = softCircle(160, 120, 80, 60, r, 210, step, soft);
            addNoise(g, 1, seed);
            const q = detectQuad(g);
            total++;
            if (q !== null) {
              hit++;
              rows.push(
                `r=${r} step=${step} seed=${seed} soft=${soft} -> ${q
                  .map((p) => `(${p.x.toFixed(0)},${p.y.toFixed(0)})`)
                  .join(" ")}`,
              );
            }
          }
        }
      }
    }
    console.log(`PLATE false positives: ${hit}/${total}`);
    for (const row of rows.slice(0, 30)) console.log(row);
  });
});
