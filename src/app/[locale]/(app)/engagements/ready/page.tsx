import { renderEngagementsView } from "../engagements-view-page";

export const dynamic = "force-dynamic";

export default function ReadyToReviewPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  return renderEngagementsView({ view: "ready", params });
}
