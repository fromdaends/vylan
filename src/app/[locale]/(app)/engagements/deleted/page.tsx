import { renderEngagementsView } from "../engagements-view-page";

export const dynamic = "force-dynamic";

export default function RecentlyDeletedPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  return renderEngagementsView({ view: "deleted", params });
}
