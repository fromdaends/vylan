// A kind's icon.
//
// Written as a switch of STATIC references rather than a lookup, because the
// React Compiler rejects `const Icon = someLookup(kind)` followed by `<Icon />`
// — a capitalised binding assigned during render reads as a component being
// created each pass, and the compiler cannot prove otherwise. It was in fact
// stable here, but "in fact stable" is not something a linter can verify, and
// the pattern genuinely does bite when the lookup is not.
//
// So the glyphs live HERE and nowhere else. lib/tasks/kinds.ts holds what a
// kind IS — its order and whether it owns a screen — and this holds what it
// LOOKS like. One home each, rather than an icon field there that this file
// would have to agree with.

import {
  BookOpenCheck,
  CalendarClock,
  CheckSquare,
  FileSignature,
  FileText,
  FolderCheck,
  Inbox,
  Send,
  ShieldAlert,
} from "lucide-react";
import { cn } from "@/lib/cn";

export function TaskKindIcon({
  kind,
  className,
}: {
  kind: string;
  className?: string;
}) {
  const cls = cn("shrink-0", className);
  switch (kind) {
    case "document_collection":
      return <Inbox className={cls} aria-hidden />;
    case "signatures":
      return <FileSignature className={cls} aria-hidden />;
    case "deliverables":
      return <FolderCheck className={cls} aria-hidden />;
    case "tax_return":
      return <FileText className={cls} aria-hidden />;
    case "bookkeeping":
      return <BookOpenCheck className={cls} aria-hidden />;
    case "notice":
      return <ShieldAlert className={cls} aria-hidden />;
    case "review":
      return <CheckSquare className={cls} aria-hidden />;
    case "meeting":
      return <CalendarClock className={cls} aria-hidden />;
    case "filing":
      return <Send className={cls} aria-hidden />;
    case "task":
      return <CheckSquare className={cls} aria-hidden />;
    // A kind from a newer build renders with no icon rather than a broken one.
    default:
      return null;
  }
}
