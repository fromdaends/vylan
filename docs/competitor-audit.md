# Competitor audit — feature notes

> Living document. Add an entry every time a feature substantially
> changes the competitive picture.

## AI document classification + auto-rejection (May 2026)

**Items advanced:** 46–51 (AI document classification, document
quality detection, smart retry).

The auto-rejection system released in this iteration takes the
existing AI classification (items 46-49) and adds a structured
usability verdict on every upload — separately scoring legibility,
field clarity, framing, and document-type match. Above an 80%
confidence threshold, the firm can choose to auto-route bad uploads
directly back to the client with a friendly, specific retry message
in their preferred language, then escalate to the accountant after
two failed attempts on the same item. Every AI action and human
override is logged for prompt-tuning. To our knowledge no incumbent
in the Canadian SMB accounting space currently does end-to-end
auto-reject on document quality — competitors flag and queue, but
the client roundtrip is manual. This puts Relai meaningfully ahead
on item 50 ("smart retry") and 51 ("AI learning loop") and
substantially advances 46–49.
