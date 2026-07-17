import type { MetadataRoute } from "next";
import { publicEnv } from "@/lib/env";

// The site's first robots.txt. Next serves it at /robots.txt, which until now
// was a 404.
//
// Two jobs, and only two:
//
// 1. POINT AT THE SITEMAP. This is the whole reason it exists. Without it, a
//    crawler has to stumble onto /sitemap.xml or wait to be told about it in
//    Search Console. With it, the first bot to fetch robots.txt learns about
//    all 142 marketing + help URLs.
//
// 2. ALLOW EVERYTHING. Deliberately.
//
// WHY NO `Disallow: /r/` FOR THE CLIENT PORTALS — this looks wrong and isn't:
//
//   robots.txt controls CRAWLING, not INDEXING. Disallowing /r/ would stop
//   crawlers FETCHING those pages, which means they'd never see the `noindex`
//   on them (src/app/r/[token]/page.tsx) — and a disallowed-but-discovered URL
//   can still appear in results as a bare link. Blocking here would make the
//   leak MORE likely, not less. Google's own guidance is explicit: don't block
//   a page in robots.txt if you want its noindex honoured.
//
//   It would also publish the shape of our private URLs to anyone who reads
//   robots.txt, which is everyone.
//
//   So the portals stay crawlable and emphatically non-indexable. The
//   directive lives on the page, where a crawler will actually read it.
//
// The auth-gated /(app) routes need nothing either: they redirect to /login,
// so there's no content to index.

export default function robots(): MetadataRoute.Robots {
  const base = publicEnv().APP_URL.replace(/\/$/, "");
  return {
    rules: [{ userAgent: "*", allow: "/" }],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
