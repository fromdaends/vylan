"use client";

import { useActionState, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { LifeBuoy, PlayCircle, Send } from "lucide-react";
import {
  submitFeedbackAction,
  type FeedbackState,
} from "@/app/actions/feedback";

export function HelpSidebar() {
  const t = useTranslations("Help");
  const tc = useTranslations("Common");
  const [open, setOpen] = useState(false);
  const [pageUrl, setPageUrl] = useState("");
  const [state, action, pending] = useActionState<FeedbackState, FormData>(
    submitFeedbackAction,
    null,
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    queueMicrotask(() => setPageUrl(window.location.pathname));
  }, []);

  // The profile dropdown's "Help" menu item dispatches this event so we can
  // open the sheet without lifting state to a shared context.
  useEffect(() => {
    function onOpen() {
      setOpen(true);
    }
    window.addEventListener("relai:open-help", onOpen);
    return () => window.removeEventListener("relai:open-help", onOpen);
  }, []);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          className="fixed bottom-4 right-4 z-50 inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-lg hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={t("open_help")}
        >
          <LifeBuoy className="size-4" aria-hidden />
          {t("button")}
        </button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md flex flex-col">
        <SheetHeader>
          <SheetTitle>{t("title")}</SheetTitle>
          <SheetDescription>{t("subtitle")}</SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 space-y-4">
          <Card>
            <CardContent className="py-4 space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <PlayCircle className="size-4 text-muted-foreground" aria-hidden />
                {t("video_title")}
              </div>
              <p className="text-xs text-muted-foreground">
                {t("video_placeholder")}
              </p>
            </CardContent>
          </Card>

          <div>
            <h3 className="text-sm font-medium mb-2">{t("feedback_title")}</h3>
            <p className="text-xs text-muted-foreground mb-3">
              {t("feedback_subtitle")}
            </p>

            <form action={action} className="space-y-3">
              <input type="hidden" name="page_url" value={pageUrl} />
              {state?.ok && (
                <Alert>
                  <AlertDescription>{t("feedback_thanks")}</AlertDescription>
                </Alert>
              )}
              {state?.error && (
                <Alert variant="destructive">
                  <AlertDescription>
                    {t.has(`errors.${state.error}` as const)
                      ? t(`errors.${state.error}` as const)
                      : state.error}
                  </AlertDescription>
                </Alert>
              )}
              <Textarea
                name="message"
                rows={5}
                placeholder={t("feedback_placeholder")}
                required
                minLength={3}
                maxLength={2000}
              />
              <Button type="submit" disabled={pending}>
                <Send className="size-4" aria-hidden />
                {pending ? tc("saving") : t("feedback_submit")}
              </Button>
            </form>
          </div>

          <Card>
            <CardContent className="py-4 space-y-2">
              <div className="text-sm font-medium">{t("shortcuts_title")}</div>
              <dl className="text-xs grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
                <dt className="font-mono bg-muted px-1.5 rounded text-[10px] inline-block w-fit">
                  c
                </dt>
                <dd className="text-muted-foreground">{t("shortcut_create")}</dd>
                <dt className="font-mono bg-muted px-1.5 rounded text-[10px] inline-block w-fit">
                  g d
                </dt>
                <dd className="text-muted-foreground">{t("shortcut_dash")}</dd>
                <dt className="font-mono bg-muted px-1.5 rounded text-[10px] inline-block w-fit">
                  g c
                </dt>
                <dd className="text-muted-foreground">{t("shortcut_clients")}</dd>
                <dt className="font-mono bg-muted px-1.5 rounded text-[10px] inline-block w-fit">
                  ?
                </dt>
                <dd className="text-muted-foreground">{t("shortcut_help")}</dd>
              </dl>
            </CardContent>
          </Card>
        </div>

        <SheetFooter className="border-t border-border">
          <p className="text-xs text-muted-foreground">
            {t("footer_email")}{" "}
            <a
              href="mailto:support@relai.app"
              className="text-foreground underline"
            >
              support@relai.app
            </a>
          </p>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
