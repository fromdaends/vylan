import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { assertLocale } from "@/lib/locale";
import { getCurrentUser } from "@/lib/db/users";
import { getCurrentFirm } from "@/lib/db/firms";
import { hasActiveTeam } from "@/lib/team/mode";
import { getServerSupabase } from "@/lib/supabase/server";
import {
  listTeamMessages,
  getTeamLastReadAt,
  TEAM_CHAT_SCHEMA_MISSING,
  type TeamMessageRow,
} from "@/lib/db/team-messages";
import { TeamChat } from "@/components/team/team-chat";

// Live thread — never serve a cached version after a new message.
export const dynamic = "force-dynamic";

// The firm-wide team group chat. Team-mode only; the client never sees it. The
// TeamChat client component stamps the read pointer on open (visibility), so no
// write happens in this render.
export default async function TeamChatPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);

  const user = await getCurrentUser();
  if (!user) redirect(`/${locale}/login`);
  const firm = await getCurrentFirm();
  if (!firm) redirect(`/${locale}/dashboard`);
  if (
    !hasActiveTeam({ teamEnabled: firm.team_enabled === true, activeMemberCount: 0 })
  ) {
    redirect(`/${locale}/dashboard`);
  }

  const t = await getTranslations("TeamChat");
  const sb = await getServerSupabase();
  const [messagesRes, lastReadRes] = await Promise.all([
    listTeamMessages(sb),
    getTeamLastReadAt(sb, user.id),
  ]);
  const notActivated =
    messagesRes === TEAM_CHAT_SCHEMA_MISSING ||
    lastReadRes === TEAM_CHAT_SCHEMA_MISSING;
  const initialMessages: TeamMessageRow[] =
    messagesRes === TEAM_CHAT_SCHEMA_MISSING
      ? []
      : (messagesRes as TeamMessageRow[]);
  const initialLastReadAt =
    lastReadRes === TEAM_CHAT_SCHEMA_MISSING
      ? null
      : (lastReadRes as string | null);

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">
        {t("page_title")}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">{t("page_subtitle")}</p>
      <div className="mt-5 flex h-[70dvh] min-h-[440px] flex-col overflow-hidden rounded-xl border border-border/60 bg-card/30">
        <TeamChat
          currentUserId={user.id}
          initialMessages={initialMessages}
          initialLastReadAt={initialLastReadAt}
          notActivated={notActivated}
          locale={locale}
        />
      </div>
    </div>
  );
}
