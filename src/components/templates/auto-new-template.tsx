"use client";

// "Create a document request template" as an ACTION, not a destination.
//
// The founder, on the + Create panel: "For service template and Document
// request template the whole function is to create one not just bring you to
// the page. It should actually open the act of creating the template."
//
// A service opens a dialog, so that one is easy. A document request template
// has no dialog — creating one means cloning the blank built-in and landing in
// its editor, which is what the "New template" button on this page already
// does. So arriving with ?new=document fires that same action once.
//
// WHY A CLIENT EFFECT rather than a server page that creates-and-redirects:
// Next PREFETCHES links. A server component that mutated on render would create
// a blank template every time somebody merely hovered the row in the Create
// panel. An effect never runs during a prefetch, so this only fires on a real
// visit.
//
// The action redirects to /templates/<id>, so a refresh cannot re-trigger it —
// by then you are on a different URL. The ref guards the one case left: React
// StrictMode invoking effects twice in development.

import { useEffect, useRef } from "react";
import { createBlankTemplateAction } from "@/app/actions/templates";

export function AutoNewTemplate({ locale }: { locale: "en" | "fr" }) {
  const fired = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    formRef.current?.requestSubmit();
  }, []);

  // A real form posting to the SAME server action the page's own "New template"
  // button uses, so there is one way to create a template rather than two that
  // can drift apart.
  return (
    <form
      ref={formRef}
      action={createBlankTemplateAction}
      className="hidden"
      aria-hidden
    >
      <input type="hidden" name="__app_locale" value={locale} />
      <button type="submit" tabIndex={-1} />
    </form>
  );
}
