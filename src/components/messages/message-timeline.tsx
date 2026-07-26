const TIMESTAMP_GAP_MS = 60 * 60 * 1000;

type TimelineMessage = {
  created_at: string;
};

function calendarDay(date: Date): number {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
}

export function shouldShowMessageTimestamp(
  messages: TimelineMessage[],
  index: number,
): boolean {
  if (index === 0) return true;

  const current = new Date(messages[index]!.created_at);
  const previous = new Date(messages[index - 1]!.created_at);
  if (
    !Number.isFinite(current.getTime()) ||
    !Number.isFinite(previous.getTime())
  ) {
    return false;
  }

  return (
    calendarDay(current) !== calendarDay(previous) ||
    current.getTime() - previous.getTime() >= TIMESTAMP_GAP_MS
  );
}

export function formatMessageTimestamp(
  iso: string,
  locale: "en" | "fr",
  now = new Date(),
): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";

  const intlLocale = locale === "fr" ? "fr-CA" : "en-CA";
  const daysAgo = Math.round(
    (calendarDay(now) - calendarDay(date)) / (24 * 60 * 60 * 1000),
  );

  if (daysAgo === 0) {
    return new Intl.DateTimeFormat(intlLocale, {
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  }

  if (daysAgo > 0 && daysAgo < 7) {
    return new Intl.DateTimeFormat(intlLocale, {
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  }

  return new Intl.DateTimeFormat(intlLocale, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function MessageTimestamp({
  iso,
  locale,
}: {
  iso: string;
  locale: "en" | "fr";
}) {
  const label = formatMessageTimestamp(iso, locale);
  if (!label) return null;

  return (
    <div className="flex justify-center py-1">
      <time
        dateTime={iso}
        className="text-[11px] font-medium leading-none text-muted-foreground"
      >
        {label}
      </time>
    </div>
  );
}
