// THE DRAG CHIP — the little card that follows your cursor while you drag,
// the way Google Drive does it.
//
// The browser's own drag image is a translucent bitmap of whatever element you
// grabbed. For a file row that is a full-width slab of table stretching most of
// the screen: it covers the folders you are trying to aim at, and it does not
// look like you are carrying anything. So the native drag image is replaced
// with a transparent pixel and this chip is drawn instead — an icon, a name, a
// count when you are carrying several things.
//
// It is built with plain DOM rather than React on purpose. The chip has to
// track the cursor at 60fps for the whole drag; doing that through React state
// re-renders the entire row list on every frame. Here it is one transform write
// per animation frame, on an element that is not in React's tree at all.
//
// Tailwind classes rather than inline colours so the chip themes itself. The
// class strings are literals in this file, which is what Tailwind's scanner
// needs to keep them in the build.

type GhostKind = "folder" | "file";

const ICONS: Record<GhostKind, string> = {
  // lucide Folder / File, so the chip carries the same icon as the row it
  // came from — the thing you picked up should look like the thing you picked.
  folder:
    '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
};

const OFFSET_X = 14;
const OFFSET_Y = 12;

type Ghost = { root: HTMLElement; inner: HTMLElement };

let ghost: Ghost | null = null;
let frame = 0;
let next: { x: number; y: number } | null = null;

/**
 * A 1×1 transparent GIF, used to blank the native drag image.
 *
 * setDragImage needs a real loaded image — passing an empty div works in Chrome
 * and fails silently elsewhere, which would leave the native slab showing under
 * our chip. A data-URI GIF is decoded immediately and behaves everywhere.
 */
let blankImage: HTMLImageElement | null = null;
function getBlankImage(): HTMLImageElement {
  if (!blankImage) {
    blankImage = new Image();
    blankImage.src =
      "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
  }
  return blankImage;
}

function position(x: number, y: number) {
  if (!ghost) return;
  // translate3d, not left/top: position changes stay on the compositor and
  // never trigger layout, which is what keeps the chip glued to the cursor
  // instead of lagging a few frames behind it.
  ghost.root.style.transform = `translate3d(${x + OFFSET_X}px, ${y + OFFSET_Y}px, 0)`;
}

function onDragOver(e: DragEvent) {
  // dragover is the only event that reports cursor position throughout a
  // native drag. It fires wherever the pointer is, so a capture-phase listener
  // on the document sees all of them. Deliberately NO preventDefault here —
  // that would turn the entire page into a drop target.
  if (!e.clientX && !e.clientY) return; // the 0,0 report browsers emit on release
  next = { x: e.clientX, y: e.clientY };
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    if (next) position(next.x, next.y);
  });
}

export function showDragGhost(opts: {
  event: React.DragEvent;
  label: string;
  kind: GhostKind;
  /** Items being carried. Above 1, the chip shows a count badge. */
  count: number;
}) {
  hideDragGhost(true);
  const { event, label, kind, count } = opts;

  try {
    event.dataTransfer.setDragImage(getBlankImage(), 0, 0);
  } catch {
    // If the browser refuses, we simply get the native image as well as the
    // chip. Ugly, but the drag itself still works — never worth throwing for.
  }

  const root = document.createElement("div");
  root.className = "pointer-events-none fixed left-0 top-0 z-[9999]";
  root.style.willChange = "transform";

  const inner = document.createElement("div");
  inner.className =
    "flex items-center gap-2 rounded-lg border border-border/70 bg-card px-3 py-2 shadow-lg";
  inner.style.transformOrigin = "top left";

  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("fill", "none");
  icon.setAttribute("stroke", "currentColor");
  icon.setAttribute("stroke-width", "2");
  icon.setAttribute("stroke-linecap", "round");
  icon.setAttribute("stroke-linejoin", "round");
  icon.setAttribute("aria-hidden", "true");
  icon.setAttribute(
    "class",
    kind === "folder"
      ? "size-[18px] shrink-0 fill-accent/25 text-accent"
      : "size-[18px] shrink-0 text-muted-foreground",
  );
  icon.innerHTML = ICONS[kind];
  inner.appendChild(icon);

  const text = document.createElement("span");
  text.className = "max-w-[220px] truncate text-sm text-foreground";
  text.textContent = label;
  inner.appendChild(text);

  if (count > 1) {
    // Carrying a multi-selection. Without this the chip says one file's name
    // and you have no idea the other four are coming with it.
    const badge = document.createElement("span");
    badge.className =
      "ml-0.5 inline-flex min-w-5 items-center justify-center rounded-full bg-accent px-1.5 py-0.5 text-[11px] font-medium leading-none text-accent-foreground";
    badge.textContent = String(count);
    inner.appendChild(badge);
  }

  root.appendChild(inner);
  document.body.appendChild(root);
  ghost = { root, inner };

  position(event.clientX, event.clientY);

  // The "collapses into the chip" moment. It grows from just under full size
  // and fades in, anchored at its top-left corner — which is right under the
  // cursor — so it reads as the row gathering itself into your hand rather
  // than as a tooltip popping up next to it. Short and eased-out: any longer
  // and it feels like the app is thinking rather than responding.
  inner.animate(
    [
      { transform: "scale(1.14)", opacity: 0 },
      { transform: "scale(1)", opacity: 1 },
    ],
    { duration: 160, easing: "cubic-bezier(0.2, 0.8, 0.25, 1)", fill: "both" },
  );

  document.addEventListener("dragover", onDragOver, true);
}

/** @param immediate skip the exit animation (used when re-showing). */
export function hideDragGhost(immediate = false) {
  document.removeEventListener("dragover", onDragOver, true);
  if (frame) {
    cancelAnimationFrame(frame);
    frame = 0;
  }
  next = null;
  const g = ghost;
  ghost = null;
  if (!g) return;

  if (immediate) {
    g.root.remove();
    return;
  }
  // Shrink away rather than vanish. A chip that disappears between frames
  // makes a successful drop look like the app dropped the item on the floor.
  const anim = g.inner.animate(
    [
      { transform: "scale(1)", opacity: 1 },
      { transform: "scale(0.88)", opacity: 0 },
    ],
    { duration: 120, easing: "cubic-bezier(0.4, 0, 1, 1)", fill: "both" },
  );
  anim.onfinish = () => g.root.remove();
  // If the animation never fires (a backgrounded tab throttles rAF), the chip
  // would be left welded to the page forever.
  window.setTimeout(() => g.root.remove(), 400);
}
