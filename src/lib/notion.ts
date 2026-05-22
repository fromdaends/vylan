// Notion CRM-sync for demo leads.
//
// One-way push: every time a lead's row in `demo_requests` changes
// state (step 3 fired, partial cron picked them up, booking
// confirmed), we mirror the current state to a row in the founder's
// Notion "Leads" database. The founder manages status + notes in
// Notion; we never read those back to Supabase.
//
// First push CREATES a new Notion page and stores its uuid on
// demo_requests.notion_page_id. Subsequent pushes PATCH that same
// page so we don't pile up duplicates.
//
// Best-effort throughout: if NOTION_API_KEY / NOTION_LEADS_DB_ID are
// unset, or Notion returns an error, we log and move on. The lead
// stays in Supabase + the founder still got the email.

import { getServiceRoleSupabase } from "@/lib/supabase/server";
import type { DemoRequest } from "@/lib/db/demo-requests";

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

// Property-name <-> Notion property mapping. These exact names must
// exist in the user's Notion database (see /docs/notion-setup.md or
// the README block I'll send separately).
const PROPS = {
  name: "Name",
  email: "Email",
  firm: "Firm",
  phone: "Phone",
  status: "Status",
  size: "Size",
  clientVolume: "Client volume",
  currentTool: "Current tool",
  province: "Province",
  language: "Language",
  marketingOptIn: "Marketing opt-in",
  stepReached: "Step reached",
  booked: "Booked",
  submitted: "Submitted",
  lastActivity: "Last activity",
  bookedAt: "Booked at",
  leadId: "Lead id",
} as const;

const FIRM_SIZE_LABELS: Record<NonNullable<DemoRequest["firm_size"]>, string> = {
  solo: "Just me",
  "2_5": "2-5 people",
  "6_15": "6-15 people",
  "16_plus": "16+ people",
};

const CLIENT_VOLUME_LABELS: Record<
  NonNullable<DemoRequest["client_volume"]>,
  string
> = {
  under_25: "Under 25",
  "25_100": "25 to 100",
  "100_300": "100 to 300",
  "300_plus": "300+",
};

const CURRENT_TOOL_LABELS: Record<
  NonNullable<DemoRequest["current_tool"]>,
  string
> = {
  manual_email: "Email & manual",
  taxdome: "TaxDome",
  karbon: "Karbon",
  other_software: "Other software",
  nothing: "Nothing structured",
};

function isConfigured(): boolean {
  return Boolean(
    process.env.NOTION_API_KEY?.trim() &&
      process.env.NOTION_LEADS_DB_ID?.trim(),
  );
}

export async function pushLeadToNotion(row: DemoRequest): Promise<void> {
  if (!isConfigured()) {
    console.warn(
      "[notion] NOTION_API_KEY or NOTION_LEADS_DB_ID not set — skipping push",
    );
    return;
  }

  const apiKey = process.env.NOTION_API_KEY!;
  const dbId = process.env.NOTION_LEADS_DB_ID!;

  try {
    if (row.notion_page_id) {
      await updateNotionPage(row.notion_page_id, row, apiKey);
    } else {
      const newId = await createNotionPage(dbId, row, apiKey);
      if (newId) {
        // Save the page id back so future pushes hit the same page.
        const sb = getServiceRoleSupabase();
        await sb
          .from("demo_requests")
          .update({ notion_page_id: newId })
          .eq("id", row.id);
      }
    }
  } catch (e) {
    console.error("[notion] push failed:", e);
  }
}

async function createNotionPage(
  databaseId: string,
  row: DemoRequest,
  apiKey: string,
): Promise<string | null> {
  // On create we ALSO set Status = "New" so the founder's pipeline
  // starts in the right column. We never overwrite Status on update
  // — the founder moves the card themselves in Notion.
  const properties = {
    ...buildDynamicProperties(row),
    [PROPS.status]: { select: { name: "New" } },
  };

  const res = await fetch(`${NOTION_API}/pages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      parent: { database_id: databaseId },
      properties,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(
      "[notion] create failed",
      res.status,
      body.slice(0, 500),
    );
    return null;
  }

  const data = (await res.json()) as { id?: string };
  return data.id ?? null;
}

async function updateNotionPage(
  pageId: string,
  row: DemoRequest,
  apiKey: string,
): Promise<void> {
  // Update path INTENTIONALLY skips Status + leaves Notes alone. The
  // founder owns those fields once the page exists.
  const properties = buildDynamicProperties(row);

  const res = await fetch(`${NOTION_API}/pages/${pageId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ properties }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(
      "[notion] update failed",
      res.status,
      body.slice(0, 500),
    );
  }
}

// Builds the set of properties that reflect the form data — the
// fields that auto-refresh on every push. NOT included: Status (set
// once on create), Notes (founder-owned in Notion).
function buildDynamicProperties(row: DemoRequest): Record<string, unknown> {
  const props: Record<string, unknown> = {
    [PROPS.name]: {
      title: [
        {
          text: {
            content: row.contact_name?.trim() || row.email,
          },
        },
      ],
    },
    [PROPS.email]: { email: row.email },
    [PROPS.firm]: {
      rich_text: [{ text: { content: row.firm_name ?? "" } }],
    },
    [PROPS.phone]: { phone_number: row.phone || null },
    [PROPS.stepReached]: { number: row.furthest_step },
    [PROPS.booked]: { checkbox: !!row.booked_at },
    [PROPS.marketingOptIn]: { checkbox: row.marketing_opt_in },
    [PROPS.leadId]: { rich_text: [{ text: { content: row.id } }] },
    [PROPS.submitted]: { date: { start: row.created_at } },
    [PROPS.lastActivity]: { date: { start: row.updated_at } },
  };

  if (row.firm_size) {
    props[PROPS.size] = {
      select: { name: FIRM_SIZE_LABELS[row.firm_size] },
    };
  }
  if (row.client_volume) {
    props[PROPS.clientVolume] = {
      select: { name: CLIENT_VOLUME_LABELS[row.client_volume] },
    };
  }
  if (row.current_tool) {
    const label =
      row.current_tool === "other_software" && row.current_tool_other
        ? `Other — ${row.current_tool_other}`
        : CURRENT_TOOL_LABELS[row.current_tool];
    props[PROPS.currentTool] = { select: { name: label } };
  }
  if (row.province) {
    props[PROPS.province] = { select: { name: row.province } };
  }
  if (row.preferred_language) {
    props[PROPS.language] = {
      select: {
        name: row.preferred_language === "fr" ? "French" : "English",
      },
    };
  }
  if (row.booked_at) {
    props[PROPS.bookedAt] = { date: { start: row.booked_at } };
  }

  return props;
}
