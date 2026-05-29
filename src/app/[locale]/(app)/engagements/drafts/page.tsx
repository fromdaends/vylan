import { renderEngagementsView } from "../engagements-view-page";

export const dynamic = "force-dynamic";

export default function DraftsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  return renderEngagementsView({ view: "drafts", params });
}
