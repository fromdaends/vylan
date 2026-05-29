import { renderEngagementsView } from "../engagements-view-page";

export const dynamic = "force-dynamic";

export default function CancelledPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  return renderEngagementsView({ view: "cancelled", params });
}
