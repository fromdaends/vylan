# AI document quality

When a client uploads a document to your portal, Relai's AI reviews
it for two things:

1. **Is it the right document?** (e.g. a T4 when you asked for a T4)
2. **Is it actually usable?** Readable text, no glare, framed
   properly, all key fields visible.

The first check has always existed. The second is the auto-rejection
feature, and you decide how strict it is.

## The on/off switch

Open your profile → "Your firm" → "Document quality." There's one
checkbox:

**Auto-reject unreadable documents**

- **Off (default).** When the AI thinks an upload is unusable, it
  shows up on the engagement with a yellow "AI flagged" badge. You
  decide what to do.
- **On.** When the AI is confident an upload is unreadable, it
  flips the request item back to "waiting on client," sends the
  client a friendly retry message (email + SMS, in their language),
  and tracks the attempt. After two failed attempts on the same
  item, it stops bothering the client and routes the file back to
  you with a red badge.

Off is the safer default; turn it on once you trust the system.

## The badges

Inside an engagement, every uploaded file shows one badge above the
existing "AI detected: T4 (92%)" line:

| Badge | Color | What it means |
|---|---|---|
| 🤖 Flagged for review | Yellow | AI thinks unusable; system did not act (auto-reject is off, or AI confidence was below 80%). You decide. |
| 🤖 Auto-rejected, client notified | Orange | Auto-reject is on. Client got a retry message. Request item is back to "waiting on client." |
| 🚨 Flagged twice — please review | Red | Two strikes on this item. System gave up trying with the client; you decide. |

Click the badge to expand it. You'll see the AI's reasoning, the
exact message that went to the client (if any), and two buttons:

- **AI was right — keep rejection.** Closes the panel, no change.
- **AI was wrong — approve this file.** Approves the file and
  decrements the strike counter. Logged for future tuning.

## The dashboard tile

The top row of your dashboard shows "AI-rejected this week." That's
the count of files Relai auto-rejected in the last 7 days. Watch
this — if it's higher than feels right (lots of false rejections),
turn the switch back off or ask us to retune the AI.

## What the client sees

The client never sees the words "AI," "robot," or "automatic." The
retry email is framed as if your firm spotted the issue. The
message includes a specific reason (e.g. "the right-side amount is
cut off") and four tips for getting a better photo.

## Anti-spam

If the AI rejects two uploads on the same item within 30 minutes,
the second one only sends an email — no second SMS. The email is
always sent because email feels less urgent than a text.

## Privacy + data

Every rejection (auto or human override) is logged to the
engagement's activity timeline. The original file stays in
storage — even an auto-rejected file is still viewable. Nothing is
deleted just because the AI flagged it.
