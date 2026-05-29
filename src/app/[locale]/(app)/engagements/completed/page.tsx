import { renderEngagementsView } from "../engagements-view-page";

export const dynamic = "force-dynamic";

export default function CompletedPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  return renderEngagementsView({ view: "completed", params });
}
