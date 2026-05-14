"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

// Reveal-on-scroll using IntersectionObserver. Self-contained so the
// rest of the page stays a Server Component. Fades + small translateY
// once the element crosses ~15% of the viewport, then unobserves.
//
// `prefers-reduced-motion: reduce` is handled via the Tailwind
// `motion-reduce:` variant on the wrapper (final state shown
// immediately, no transition). The IntersectionObserver is still
// attached for those users but never causes visible motion because
// the CSS variant overrides the translate/opacity.
//
// Usage:
//   <Reveal>...</Reveal>
//   <Reveal delay={120}>...</Reveal>

type RevealProps = {
  children: ReactNode;
  // Stagger inside a group: pass an incrementing delay per child.
  delay?: number;
  className?: string;
};

export function Reveal({ children, delay = 0, className = "" }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          io.unobserve(el);
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -10% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const style: CSSProperties | undefined = delay
    ? { transitionDelay: `${delay}ms` }
    : undefined;

  return (
    <div
      ref={ref}
      style={style}
      className={
        "transition-[opacity,transform] duration-[350ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] " +
        (visible
          ? "opacity-100 translate-y-0"
          : "opacity-0 translate-y-3") +
        " motion-reduce:opacity-100 motion-reduce:translate-y-0 motion-reduce:transition-none" +
        (className ? " " + className : "")
      }
    >
      {children}
    </div>
  );
}
