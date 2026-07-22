"use client";

// The portal's responsive frame around "documents on one side, the message
// thread on the other".
//
//  • Desktop (lg+): a real two-pane app — the documents/hub column on the left,
//    the message thread docked on the right at a width the client can DRAG to
//    adjust (persisted in localStorage, clamped to a sane band). Each pane
//    scrolls on its own so the composer never leaves the bottom of the thread.
//  • Mobile (<lg): there is no split. The thread opens as a full-screen overlay
//    that sits just below the sticky firm header, with its own Back button, so
//    texting fills the whole screen instead of a short box mid-page.
//
// When the engagement has no messaging (not enabled, or complete with no
// history) this renders the documents column exactly as the long-standing
// single-column portal did: one centred column, the page scrolls normally.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { cn } from "@/lib/cn";

// Width of the messages pane as a percentage of the split, with a comfortable
// drag band. 30% is the default the founder asked for.
const MIN_PCT = 24;
const MAX_PCT = 48;
const DEFAULT_PCT = 30;
const KEY_STEP = 3;
const STORAGE_KEY = "vylan:portal:messages-width";

const clampPct = (p: number) =>
  Math.min(MAX_PCT, Math.max(MIN_PCT, Math.round(p * 10) / 10));

// Read the client's saved pane width during render (SSR-safe). Computing it as
// the initial state — rather than syncing it in from an effect — is both the
// lint-preferred shape and flash-free: the pane renders at the saved width
// straight away. The server has no localStorage, so it renders DEFAULT_PCT and
// the <aside> carries suppressHydrationWarning for that one style difference.
function readStoredWidth(): number {
  if (typeof window === "undefined") return DEFAULT_PCT;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const n = raw ? Number.parseFloat(raw) : NaN;
    return Number.isFinite(n) ? clampPct(n) : DEFAULT_PCT;
  } catch {
    return DEFAULT_PCT;
  }
}

export function PortalSplit({
  enabled,
  messagesOpen,
  panel,
  children,
}: {
  // Whether this engagement has a message thread at all.
  enabled: boolean;
  // Mobile overlay visibility (ignored by the desktop pane, which is permanent).
  messagesOpen: boolean;
  // The message thread element (e.g. <PortalMessages/>). Mounted only while
  // actually visible, so the thread's "mark read" only fires when the client
  // can genuinely see it (never silently on a hidden mobile page).
  panel: ReactNode;
  // The documents / hub column.
  children: ReactNode;
}) {
  const rowRef = useRef<HTMLDivElement | null>(null);
  const [widthPct, setWidthPct] = useState<number>(readStoredWidth);
  const [dragging, setDragging] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);

  // Track the lg breakpoint so the thread mounts on desktop (where the pane is
  // always visible) and, on mobile, only once the client opens it.
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // Persist the width whenever the client changes it. Writing to an external
  // system (not React state) from an effect is the intended use of effects.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(widthPct));
    } catch {
      // Best-effort persistence.
    }
  }, [widthPct]);

  // Lock the background from scrolling while the mobile overlay is open. Desktop
  // (where the pane is in-flow) is left untouched.
  useEffect(() => {
    if (!messagesOpen) return;
    if (typeof window === "undefined") return;
    if (!window.matchMedia("(max-width: 1023px)").matches) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [messagesOpen]);

  const startDrag = useCallback((e: React.PointerEvent) => {
    const row = rowRef.current;
    if (!row) return;
    e.preventDefault();
    setDragging(true);
    const onMove = (ev: PointerEvent) => {
      const rect = row.getBoundingClientRect();
      if (rect.width <= 0) return;
      // Pane is on the right, so its width grows as the pointer moves left.
      setWidthPct(clampPct(((rect.right - ev.clientX) / rect.width) * 100));
    };
    const onUp = () => {
      setDragging(false);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, []);

  const onHandleKey = useCallback((e: React.KeyboardEvent) => {
    switch (e.key) {
      // Pane on the right: Left widens the thread, Right narrows it.
      case "ArrowLeft":
        e.preventDefault();
        setWidthPct((w) => clampPct(w + KEY_STEP));
        break;
      case "ArrowRight":
        e.preventDefault();
        setWidthPct((w) => clampPct(w - KEY_STEP));
        break;
      case "Home":
        e.preventDefault();
        setWidthPct(MAX_PCT);
        break;
      case "End":
        e.preventDefault();
        setWidthPct(MIN_PCT);
        break;
      default:
        break;
    }
  }, []);

  // No messaging: the documents column stands alone, exactly as before.
  if (!enabled) return <>{children}</>;

  const mountPanel = isDesktop || messagesOpen;

  return (
    <div
      ref={rowRef}
      className={cn(
        "flex min-h-0 flex-1 flex-col lg:flex-row",
        dragging && "lg:cursor-col-resize lg:select-none",
      )}
    >
      {/* Documents / hub — its own scroll region on desktop. */}
      <div className="flex min-h-0 flex-1 flex-col lg:overflow-y-auto">
        {children}
      </div>

      {/* Draggable divider (desktop only). */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-valuenow={Math.round(widthPct)}
        aria-valuemin={MIN_PCT}
        aria-valuemax={MAX_PCT}
        tabIndex={0}
        onPointerDown={startDrag}
        onKeyDown={onHandleKey}
        className="group hidden w-2 shrink-0 cursor-col-resize touch-none select-none items-stretch focus-visible:outline-none lg:flex"
      >
        <span
          aria-hidden
          className={cn(
            "mx-auto h-full w-px bg-border transition-all group-hover:w-0.5 group-hover:bg-accent group-focus-visible:w-0.5 group-focus-visible:bg-accent",
            dragging && "w-0.5 bg-accent",
          )}
        />
      </div>

      {/* Messages: a full-screen overlay on mobile (below the h-16 firm header),
          a docked resizable pane on desktop. */}
      <aside
        suppressHydrationWarning
        style={{ "--mw": `${widthPct}%` } as CSSProperties}
        className={cn(
          "z-30 flex-col bg-background",
          // Mobile overlay.
          "fixed inset-x-0 bottom-0 top-16",
          messagesOpen ? "flex" : "hidden",
          // Desktop pane.
          "lg:static lg:inset-auto lg:z-auto lg:flex lg:min-h-0 lg:w-[var(--mw)] lg:shrink-0 lg:border-l lg:border-border/60",
        )}
      >
        {mountPanel ? panel : null}
      </aside>
    </div>
  );
}
