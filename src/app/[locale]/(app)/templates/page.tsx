import { redirect } from "@/i18n/navigation";
import { assertLocale } from "@/lib/locale";

/**
 * /templates no longer shows anything.
 *
 * It used to be ONE page with every kind of template stacked on it — engagement
 * templates, task templates, services, document requests — which meant the
 * sidebar dropped you at the top of a long scroll and you found your way down
 * by eye. The founder replaced that with one page per type, reached from the
 * Templates flyout: "Get rid of the templates page that exists right now to
 * have view all the templates. It should literally be the complete divided by
 * the sidebar. And which one you click on then has a completely new UI for that
 * type of template."
 *
 * This route stays as a REDIRECT rather than being deleted, because plenty of
 * things still point at it and always will: the mobile tab bar, the command
 * palette, the keyboard shortcut, the search registry, the breadcrumb on a
 * template's own editor, and the keyboard shortcut. Deleting it would 404 all
 * of them for no gain.
 *
 * (The server actions' `revalidatePath` calls were repointed at the specific
 * routes — revalidating this one would refresh a redirect and nothing else.)
 *
 * It lands on ENGAGEMENTS because that is the list a firm reaches for most and
 * the one the flyout puts first.
 */
export default async function TemplatesIndexPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  redirect({ href: "/templates/engagements", locale });
}
