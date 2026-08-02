// Public visibility of the /how-it-works marketing page.
//
// Founder, 2026-08-02: take it off the public site while it is being reworked —
// "keep it there, it exists, it's just not theirs to see." NOTHING is deleted.
// The route, its component, its copy, its styles and its tests all stay exactly
// where they are. Flipping this one constant back to `true` restores every
// entry point at once:
//
//   1. HOW IT WORKS in the shared slide-down menu
//   2. How it works in the footer's Product column
//   3. "See how it works" beside the hero's Book-a-demo button
//   4. the whole home-page call-to-action section, which exists only to send
//      people to this page (hiding just its button would strand its heading)
//   5. the /how-it-works entry in the sitemap
//   6. four links inside the public help centre (About + Getting started, EN/FR)
//   7. /manifesto, which forwards here — it goes to the front page instead
//
// and the page itself stops returning a 404 (founder's call: a direct visit
// should look like the page does not exist, not merely be unlisted).
//
// WHY THIS FILE AND NOT A COMPONENT: a constant exported from a "use client"
// module is replaced by a client-reference stub when a Server Component imports
// it — it reads as truthy, typechecks clean, builds clean, and silently does
// the opposite of what is written here. Both server code (the footer, the
// sitemap, the page's own guard) and client code (the menu, the landing hero)
// read this flag, so it has to live in a module that is neither.
export const HOW_IT_WORKS_PUBLIC = false;
