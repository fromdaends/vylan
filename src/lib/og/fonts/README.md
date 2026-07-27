# Fonts for the social share card

These two `.ttf` files are read by `src/lib/og/card.tsx` to render the Open
Graph / X card image (`/opengraph-image`, `/twitter-image`).

**Why they are committed instead of fetched.** satori — the renderer behind
Next's `ImageResponse` — needs raw font bytes and cannot read `woff2`, which is
what Google Fonts serves to browsers and what `next/font/google` caches. It also
cannot reach the network from inside a build or a serverless function without
making the card's rendering depend on Google being up. Committing the `.ttf`
builds makes the card deterministic and offline-safe.

**Why Schibsted Grotesk.** It's the face the public marketing site already uses
(`src/components/vylan-landing/fonts.ts`), so the card matches the page it links
to.

**Licence.** SIL Open Font License 1.1 — see `OFL.txt`, which permits
redistribution alongside the font. Do not delete it.

## Regenerating

The `.ttf` urls come from the Google Fonts CSS API, which only serves TrueType
to user agents it doesn't recognise as woff2-capable — hence the plain
`User-Agent` below. Modern UA strings get you `woff2`, which satori will reject.

```
curl -H "User-Agent: Mozilla/5.0" \
  "https://fonts.googleapis.com/css2?family=Schibsted+Grotesk:wght@400;600"
```

Then download the `.ttf` urls it prints: weight 400 → `SchibstedGrotesk-Regular.ttf`,
weight 600 → `SchibstedGrotesk-SemiBold.ttf`.
