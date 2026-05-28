"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

export type Accent = "blue" | "green";

export const ACCENT_STORAGE_KEY = "vylan-accent";
const DEFAULT_ACCENT: Accent = "blue";

// Runs before first paint (injected into the document by the layout) so the
// chosen accent is applied to <html data-accent> with no flash of the wrong
// color. Kept tiny and dependency-free. Mirrors how next-themes handles mode.
export const ACCENT_NO_FLASH_SCRIPT = `(function(){try{var a=localStorage.getItem('${ACCENT_STORAGE_KEY}');if(a!=='green'&&a!=='blue')a='${DEFAULT_ACCENT}';document.documentElement.setAttribute('data-accent',a);}catch(e){document.documentElement.setAttribute('data-accent','${DEFAULT_ACCENT}');}})();`;

type AccentContextValue = {
  accent: Accent;
  setAccent: (next: Accent) => void;
};

const AccentContext = createContext<AccentContextValue | null>(null);

function isAccent(v: string | null): v is Accent {
  return v === "blue" || v === "green";
}

export function AccentProvider({ children }: { children: React.ReactNode }) {
  // Start at the default on both server and first client render to keep
  // hydration stable; the real value (already applied to <html> by the
  // no-flash script) is read in after mount. Colors never flash because
  // they come from the data-accent attribute, not this state.
  const [accent, setAccentState] = useState<Accent>(DEFAULT_ACCENT);

  useEffect(() => {
    const fromDom = document.documentElement.getAttribute("data-accent");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (isAccent(fromDom)) setAccentState(fromDom);
  }, []);

  const setAccent = useCallback((next: Accent) => {
    setAccentState(next);
    document.documentElement.setAttribute("data-accent", next);
    try {
      localStorage.setItem(ACCENT_STORAGE_KEY, next);
    } catch {
      // Private mode / storage disabled — accent still applies for this
      // session via the attribute above; it just won't persist.
    }
  }, []);

  return (
    <AccentContext.Provider value={{ accent, setAccent }}>
      {children}
    </AccentContext.Provider>
  );
}

export function useAccent(): AccentContextValue {
  const ctx = useContext(AccentContext);
  if (!ctx) {
    throw new Error("useAccent must be used within an AccentProvider");
  }
  return ctx;
}
