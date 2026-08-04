import { renderEngagementsView } from "../engagements-view-page";

export const dynamic = "force-dynamic";

// Every engagement that is neither archived nor deleted, at any status — the
// view that replaced the Completed tab. Finished work is not a different KIND
// of thing needing its own page; it is a status you filter for, and the Status
// column menu does that on any of these lists.
export default function AllEngagementsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  return renderEngagementsView({ view: "all", params });
}
