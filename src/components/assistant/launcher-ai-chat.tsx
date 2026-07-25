"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { GeneralChat } from "@/components/assistant/general-chat";
import { FeedbackView } from "@/components/assistant/feedback-view";

// The popup launcher's "Vylan" (AI) mode. One combined, general chat: it reads
// and summarizes any of the firm's engagements/documents AND answers product
// questions (backed by /api/assistant, now a read-only tool loop). No
// engagement selector, no actions. The chat ⇆ feedback switch mirrors the old
// panel's chat-tab, minus the removed engagement-scoped view.
export function LauncherAiChat({ locale }: { locale: "en" | "fr" }) {
  const [view, setView] = useState<"chat" | "feedback">("chat");

  return (
    <AnimatePresence mode="wait" initial={false}>
      {view === "chat" ? (
        <motion.div
          key="chat"
          initial={{ opacity: 0, x: 8 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -8 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className="flex h-full min-h-0 flex-col bg-card text-foreground"
        >
          <GeneralChat
            locale={locale}
            onSwitchToFeedback={() => setView("feedback")}
          />
        </motion.div>
      ) : (
        <motion.div
          key="feedback"
          initial={{ opacity: 0, x: 8 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -8 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className="flex h-full min-h-0 flex-col"
        >
          <FeedbackView onBack={() => setView("chat")} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
