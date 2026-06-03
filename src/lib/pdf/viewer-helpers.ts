// Pure, framework-free helpers for the document viewer.
//
// These deliberately live OUTSIDE the react-pdf component. react-pdf (and the
// pdf.js engine under it) can only run in the browser — importing it in Node
// throws `DOMMatrix is not defined` — so keeping the math here lets us unit
// test the tricky bits (windowing, zoom snapping, page clamping) in plain Node.

// Discrete zoom stops the +/- buttons snap between. 1 === "actual size" (100%),
// chosen to feel like a real desktop PDF reader.
export const ZOOM_STEPS = [0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 3, 4] as const;
export const DEFAULT_ZOOM = 1;
export const MIN_ZOOM = ZOOM_STEPS[0];
export const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1];

// Snap to the neighbouring stop in `dir`. If `current` sits between stops
// (e.g. it came from a fit-to-width scale like 1.37), jump to the first stop
// strictly beyond it in that direction so the button always does something.
export function nextZoom(current: number, dir: 1 | -1): number {
  if (dir === 1) {
    const up = ZOOM_STEPS.find((s) => s > current + 1e-6);
    return up ?? MAX_ZOOM;
  }
  const downs = ZOOM_STEPS.filter((s) => s < current - 1e-6);
  return downs.length ? downs[downs.length - 1] : MIN_ZOOM;
}

export function clampZoom(scale: number): number {
  // NaN can't be ordered, so reset it; ±Infinity clamps to the ends naturally.
  if (Number.isNaN(scale)) return DEFAULT_ZOOM;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale));
}

export function formatZoom(scale: number): string {
  return `${Math.round(scale * 100)}%`;
}

export function clampPage(page: number, total: number): number {
  if (total <= 0) return 1;
  if (!Number.isFinite(page)) return 1;
  return Math.min(total, Math.max(1, Math.round(page)));
}

// Parse the "jump to page" input. Returns null for anything that isn't a real
// page number so the caller can ignore bad input instead of scrolling nowhere.
export function parsePageInput(raw: string, total: number): number | null {
  const n = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(n)) return null;
  if (n < 1 || n > total) return null;
  return n;
}

// Normalise a rotation to one of 0 / 90 / 180 / 270, handling negatives.
export function rotateBy(current: number, delta: number): number {
  return (((current + delta) % 360) + 360) % 360;
}

// The heart of the windowed rendering: which page numbers (1-based) actually
// hold a rendered canvas around `current`, given `overscan` pages of buffer on
// each side. Everything else is a lightweight placeholder, so a 300-page PDF
// costs roughly the same memory as a 5-page one and never freezes the tab.
export function pagesToRender(
  current: number,
  total: number,
  overscan: number,
): number[] {
  if (total <= 0) return [];
  const c = clampPage(current, total);
  const lo = Math.max(1, c - overscan);
  const hi = Math.min(total, c + overscan);
  const out: number[] = [];
  for (let p = lo; p <= hi; p++) out.push(p);
  return out;
}
