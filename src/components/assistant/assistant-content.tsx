// Shared rendering of an assistant reply with LIGHT markdown — bold, italics,
// inline code, and bullet / numbered lists — parsed by parseAssistantMarkdown
// into a small block/span tree and emitted as React elements (never
// dangerouslySetInnerHTML), so the model's text can never inject markup. A
// blinking caret trails the final block while the stream is open. A half-typed
// marker mid-stream (e.g. "**bol") just renders literally until it closes.
//
// Used by BOTH the engagement chat (chat-tab) and the general "ask about the
// software" chat (general-chat).

import {
  parseAssistantMarkdown,
  type MarkdownSpan,
} from "@/components/assistant/assistant-markdown";
import { cn } from "@/lib/cn";

export function AssistantContent({
  text,
  isStreaming,
}: {
  text: string;
  isStreaming: boolean;
}) {
  const blocks = parseAssistantMarkdown(text);
  if (blocks.length === 0) {
    return isStreaming ? <StreamingCaret /> : null;
  }
  const lastIndex = blocks.length - 1;
  return (
    <div className="space-y-2.5 text-sm leading-relaxed text-zinc-100">
      {blocks.map((block, i) => {
        const caret = isStreaming && i === lastIndex;
        if (block.type === "bullets" || block.type === "numbered") {
          const ordered = block.type === "numbered";
          const ListTag = ordered ? "ol" : "ul";
          const lastItem = block.items.length - 1;
          return (
            <ListTag
              key={i}
              className={cn(
                "space-y-1 pl-5",
                ordered ? "list-decimal" : "list-disc",
                "marker:text-zinc-500",
              )}
            >
              {block.items.map((item, ii) => (
                <li key={ii} className="break-words pl-0.5">
                  <MarkdownSpans spans={item} />
                  {caret && ii === lastItem ? <StreamingCaret /> : null}
                </li>
              ))}
            </ListTag>
          );
        }
        const lastLine = block.lines.length - 1;
        return (
          <p key={i} className="break-words">
            {block.lines.map((lineSpans, li) => (
              <span key={li}>
                <MarkdownSpans spans={lineSpans} />
                {li < lastLine ? <br /> : null}
              </span>
            ))}
            {caret ? <StreamingCaret /> : null}
          </p>
        );
      })}
    </div>
  );
}

// Inline spans of one line/list-item. Bold is a real <strong>, italics <em>,
// inline code a subtle pill. Plain text is a bare string, which React escapes.
function MarkdownSpans({ spans }: { spans: MarkdownSpan[] }) {
  return (
    <>
      {spans.map((span, i) => {
        if (span.type === "bold") {
          return (
            <strong key={i} className="font-semibold text-white">
              {span.value}
            </strong>
          );
        }
        if (span.type === "italic") {
          return (
            <em key={i} className="italic">
              {span.value}
            </em>
          );
        }
        if (span.type === "code") {
          return (
            <code
              key={i}
              className="rounded bg-white/10 px-1 py-0.5 font-mono text-[0.85em] text-zinc-200"
            >
              {span.value}
            </code>
          );
        }
        return <span key={i}>{span.value}</span>;
      })}
    </>
  );
}

export function StreamingCaret() {
  return (
    <span
      aria-hidden
      className="inline-block w-[2px] h-[0.95em] align-text-bottom translate-y-[1px] bg-foreground/70 ml-0.5 animate-pulse [animation-duration:1s]"
    />
  );
}
