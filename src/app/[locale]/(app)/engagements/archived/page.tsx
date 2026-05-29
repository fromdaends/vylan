import { renderEngagementsView } from "../engagements-view-page";

export const dynamic = "force-dynamic";

export default function ArchivedPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  return renderEngagementsView({ view: "archived", params });
}
