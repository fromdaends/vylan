// Single FAQ entry — collapsible question + answer.
// Used on the (forthcoming) /faq page and previously on the landing.
//
// Plain <details>/<summary> so it works without JS for SEO + a11y.
// The visual chrome (rounded card, +/× rotation, accent hover) is
// pure Tailwind/CSS, no client state.

export function Faq({ q, a }: { q: string; a: string }) {
  return (
    <details className="group rounded-xl border border-border bg-card transition-all duration-300 hover:border-accent/40 hover:bg-card/80 open:border-accent/40">
      <summary className="flex cursor-pointer items-center justify-between gap-4 p-5 font-medium text-base list-none">
        <span className="transition-colors group-hover:text-foreground">
          {q}
        </span>
        <span
          aria-hidden
          className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-muted text-muted-foreground transition-all duration-300 group-hover:bg-accent/15 group-hover:text-accent group-open:rotate-45 group-open:bg-accent/15 group-open:text-accent shrink-0"
        >
          +
        </span>
      </summary>
      <div className="px-5 pb-5 text-sm text-muted-foreground leading-relaxed">
        {a}
      </div>
    </details>
  );
}
