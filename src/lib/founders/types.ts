// Shapes for the founders console. Kept in a NEUTRAL module (no "use client",
// no server-only imports) so both the server loaders and the client tables can
// import them — the client/server constant footgun this codebase has been bitten
// by is real, and a type-only module is the safe place for shared vocabulary.

export type IntegrationKey = "quickbooks" | "xero" | "storage" | "calendar";

/** One firm on the platform, with everything we can count about it. */
export type FirmRow = {
  id: string;
  name: string;
  plan: string;
  isDemo: boolean;
  isPilot: boolean;
  locale: string;
  province: string | null;
  createdAt: string;
  onboardedAt: string | null;
  trialEndsAt: string | null;
  subscriptionStatus: string | null;

  // People
  users: number;
  activeUsers: number;
  owners: number;

  // Book of business
  clients: number;
  activeClients: number;

  // Work
  engagements: number;
  activeEngagements: number;
  completedEngagements: number;
  draftEngagements: number;
  tasks: number;
  openTasks: number;

  // Output
  documents: number;

  // Money (cents, CAD — Vylan is Canada-only today)
  invoices: number;
  invoicedCents: number;
  paidCents: number;

  // Conversation
  messages: number;
  /** Turns the firm typed at the in-app assistant. A firm that talks to Vylan
   *  is a firm that has decided Vylan is worth talking to. */
  assistantMessages: number;
  /** e-signature requests raised. */
  signatures: number;

  // Effort
  timeMinutes: number;

  // What they've turned on
  integrations: Record<IntegrationKey, boolean>;
  automations: number;
  services: number;
  templates: number;
  workflowsEnabled: boolean;
  timeInsightsEnabled: boolean;

  // Pulse
  events7d: number;
  events30d: number;
  /** Events whose actor was the firm's CLIENT, not the firm. The number that
   *  says whether the product reached the people it is ultimately for — a firm
   *  can look busy while every event is an accountant clicking around. */
  clientEvents30d: number;
  lastActivityAt: string | null;
  aiUsedThisMonth: number;

  /** On the founders' shared watchlist (migration 1810). Always false while
   *  that migration is unapplied, which is indistinguishable from "nothing is
   *  pinned yet" — correct, because both mean the same thing to a reader. */
  pinned: boolean;
};

/** Something a user typed into the in-app feedback box. */
export type FeedbackNote = {
  id: string;
  firmId: string | null;
  firmName: string;
  message: string;
  pageUrl: string | null;
  createdAt: string;
};

/** One row in the cross-firm activity feed. */
export type FeedEvent = {
  id: string;
  firmId: string;
  firmName: string;
  engagementId: string | null;
  actorType: "user" | "client" | "system";
  /** Resolved to a person's name when actor_id matched a user row. */
  actorName: string | null;
  action: string;
  createdAt: string;
  /** Small, already-safe extras worth showing inline (counts, titles). */
  metadata: Record<string, unknown>;
};

/** A day in a time series. `date` is YYYY-MM-DD in UTC. */
export type DayBucket = { date: string; count: number };

/** One prospect from the public /demo form. */
export type LeadRow = {
  id: string;
  contactName: string | null;
  email: string;
  firmName: string | null;
  firmSize: string | null;
  clientVolume: string | null;
  currentTool: string | null;
  province: string | null;
  preferredLanguage: string | null;
  marketingOptIn: boolean;
  furthestStep: number;
  bookedAt: string | null;
  createdAt: string;
  /** True when a firm already exists with this email — the lead converted. */
  converted: boolean;
};

/** Platform-wide roll-up shown at the top of the Overview. */
export type PlatformTotals = {
  firms: number;
  realFirms: number;
  demoFirms: number;
  users: number;
  clients: number;
  engagements: number;
  documents: number;
  invoicedCents: number;
  paidCents: number;
  messages: number;
  timeMinutes: number;
  assistantMessages: number;
  signatures: number;
  events30d: number;
  events7d: number;
  /** How much of that 30-day activity came from firms' CLIENTS. */
  clientEvents30d: number;
  activeFirms7d: number;
  activeFirms30d: number;
  newFirms30d: number;
  leads: number;
  leadsBooked: number;
};

/** How many firms have each capability switched on. */
export type AdoptionRow = {
  key: string;
  firms: number;
  /** Denominator, so the bar means something. */
  outOf: number;
};

/** Background-job and quota health. */
export type HealthSnapshot = {
  jobsPending: number;
  jobsRunning: number;
  jobsFailed: number;
  jobsDone: number;
  /** The most recent failures, newest first — with the error text. */
  recentFailures: Array<{
    id: string;
    kind: string;
    attempts: number;
    lastError: string | null;
    createdAt: string;
  }>;
  /** AI checks consumed this calendar month, platform-wide. */
  aiUsedThisMonth: number;
  aiFirmsOverHalfCap: number;
};

/**
 * A read that hit its row ceiling. Surfaced in the UI rather than swallowed:
 * a dashboard that silently truncates is worse than no dashboard, because it
 * reads as "that is all there is".
 */
export type CappedRead = { table: string; cap: number };

export type FoundersData = {
  totals: PlatformTotals;
  firms: FirmRow[];
  feed: FeedEvent[];
  /** What users typed into the in-app feedback box, newest first. Until now
   *  these rows had no reader at all. */
  feedback: FeedbackNote[];
  signups: DayBucket[];
  activityByDay: DayBucket[];
  adoption: AdoptionRow[];
  leads: LeadRow[];
  health: HealthSnapshot;
  /** False until migration 1810 is applied. The UI hides the pin control
   *  entirely rather than showing one that silently does nothing. */
  pinsAvailable: boolean;
  capped: CappedRead[];
  /** Window the counts cover, in days. */
  windowDays: number;
  generatedAt: string;
};

/** Everything the per-firm drill-down needs. */
export type FirmDetail = {
  /** The instant the loader read the clock. The PAGE must not call Date.now()
   *  itself — react-hooks/purity forbids an impure call in render, and every
   *  relative age on the page has to be measured from one instant anyway. */
  generatedAt: string;
  /** False until migration 1810 is applied — hides the pin control. */
  pinsAvailable: boolean;
  firm: FirmRow;
  people: Array<{
    id: string;
    name: string;
    email: string;
    role: string;
    createdAt: string;
    deactivatedAt: string | null;
    lastEventAt: string | null;
    events30d: number;
  }>;
  feed: FeedEvent[];
  activityByDay: DayBucket[];
  topActions: Array<{ action: string; count: number }>;
  recentEngagements: Array<{
    id: string;
    title: string;
    status: string;
    clientName: string | null;
    createdAt: string;
  }>;
};
