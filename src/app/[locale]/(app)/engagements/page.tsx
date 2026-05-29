import { renderEngagementsView } from "./engagements-view-page";

export const dynamic = "force-dynamic";

// /engagements — the All-Engagements landing = the Active view. The sidebar's
// "Engagements" parent links here; the other six views are sub-routes.
export default function EngagementsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  return renderEngagementsView({ view: "active", params });
}
