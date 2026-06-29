"use client";

import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
  BadgeCheck,
  BookOpen,
  Bot,
  BrainCircuit,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  Check,
  ChevronRight,
  ClipboardList,
  Database,
  FolderOpen,
  History,
  Loader2,
  Mail,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  SearchCheck,
  Send,
  Settings,
  ShieldAlert,
  Sparkles,
  Upload,
  Users,
  X,
} from "lucide-react";

import {
  createBlueprintAccount,
  createSourceEntry,
  getDashboardState,
  getIntelligenceBriefs,
  getPlannerRuns,
  getStrategyProfile,
  guideChat,
  loginCompany,
  reviewRecommendation,
  runBGV,
  runPlanner,
  suggestBlueprint,
  suggestBlueprintOptions,
  signupCompany,
  uploadDocument,
} from "@/lib/api";
import { pendingSourceSamples, type PendingSourceSample } from "@/lib/pending-source-samples";
import type {
  AccountSummary,
  AccountIntelligence,
  AgentRunResult,
  AuthSession,
  BGVResult,
  BlueprintAccountDraft,
  BlueprintBuilderKey,
  BlueprintSuggestionResponse,
  BusinessDomain,
  CandidateProfile,
  DashboardState,
  GuideMessage,
  MemoryCard,
  PlannerRunCase,
  Recommendation,
  SourceCollection,
  SourceEntry,
  StrategyProfile,
} from "@/lib/types";

type ActiveView =
  | "today"
  | "accounts"
  | "dashboard"
  | "source_data"
  | "planner_history"
  | "outcomes"
  | "escalations"
  | "blueprints"
  | "crm"
  | "interactions"
  | "knowledge"
  | "risks"
  | "candidates"
  | "memory"
  | "execution"
  | "trace"
  | "settings";

type SourceDataKind = "meetings" | "crm" | "emails" | "documents" | "notes" | "policies";
type FieldSpec = { key: string; label: string; placeholder: string };
type ExecutionArtifactKey = "email" | "crm" | "escalation" | "sla" | "summary";

type ActionExecution = {
  id?: string;
  recommendation_id?: string;
  account_id?: string;
  title?: string;
  owner_role?: string;
  status?: string;
  draft?: string;
  artifacts?: Partial<Record<ExecutionArtifactKey, { title?: string; body?: string } | string>>;
  metadata?: {
    artifacts?: Partial<Record<ExecutionArtifactKey, { title?: string; body?: string } | string>>;
    next_steps?: string[];
    evidence_titles?: string[];
    approval_summary?: string;
  };
  next_steps?: string[];
  created_at?: string;
};

type MemoryLedgerState = "fresh" | "stale" | "contradicted" | "approved" | "inferred" | "review";

type MemoryLedgerItem = {
  id: string;
  title: string;
  source: string;
  state: MemoryLedgerState;
  stateLabel: string;
  trust: number;
  origin: string;
  plannerUse: string;
  why: string;
  evidence: string;
  rule: string;
};

type DailyBrief = {
  account: AccountSummary;
  score: number;
  level: "Critical" | "High" | "Watch" | "Stable";
  nextView: ActiveView;
  nextLabel: string;
  actionTitle: string;
  reason: string;
  changed: string;
  missing: string;
  sourceCounts: Record<SourceCollection, number>;
  signals: string[];
};

type DomainBlueprint = {
  id: BusinessDomain;
  title: string;
  description: string;
  sourceTypes: string[];
  agents: string[];
  businessRules: string[];
  memoryTypes: string[];
  successMetrics: string[];
  recommendationCategories: string[];
};

const priorityClass: Record<Recommendation["priority"], string> = {
  critical: "border-rose-200 bg-rose-100 text-rose-700",
  high: "border-amber-200 bg-amber-100 text-amber-700",
  medium: "border-sky-200 bg-sky-100 text-sky-700",
  low: "border-slate-200 bg-slate-100 text-slate-700",
};

const SESSION_KEY = "flow360-company-session";

const memoryTypeStyle = {
  profile: "border-indigo-200 bg-indigo-50 text-indigo-800",
  rule: "border-emerald-200 bg-emerald-50 text-emerald-800",
  episodic: "border-amber-200 bg-amber-50 text-amber-800",
  raw: "border-slate-200 bg-slate-50 text-slate-800",
  semantic: "border-cyan-200 bg-cyan-50 text-cyan-800",
} as const;

const ledgerStateStyle: Record<MemoryLedgerState, string> = {
  fresh: "border-emerald-200 bg-emerald-50 text-emerald-800",
  stale: "border-amber-200 bg-amber-50 text-amber-800",
  contradicted: "border-rose-200 bg-rose-50 text-rose-800",
  approved: "border-indigo-200 bg-indigo-50 text-indigo-800",
  inferred: "border-cyan-200 bg-cyan-50 text-cyan-800",
  review: "border-slate-200 bg-slate-50 text-slate-800",
};

const artifactTabs: Array<{ key: ExecutionArtifactKey; label: string; icon: typeof Mail }> = [
  { key: "email", label: "Customer Email", icon: Mail },
  { key: "crm", label: "CRM Task", icon: BriefcaseBusiness },
  { key: "escalation", label: "Escalation Note", icon: ShieldAlert },
  { key: "sla", label: "SLA Update", icon: BadgeCheck },
  { key: "summary", label: "Meeting Summary", icon: ClipboardList },
];

const domainBlueprints: DomainBlueprint[] = [
  {
    id: "healthcare_staffing",
    title: "Healthcare Staffing",
    description: "Urgent hiring, candidate clearance, credentialing, rate approvals, and replacement guarantees.",
    sourceTypes: ["CRM account profile", "Meeting transcript", "Candidate profile", "Credentialing checklist", "SLA breach RCA"],
    agents: ["Planner", "Retrieval", "Business Analyst", "Recommendation", "BGV/Credentialing", "Memory"],
    businessRules: ["Never shortlist uncleared candidates as fully ready", "Escalate premium rates above policy threshold", "Tie every urgent action to start-date risk"],
    memoryTypes: ["Profile memory", "Rule memory", "Episodic breach memory", "Candidate clearance memory"],
    successMetrics: ["Start-date adherence", "Candidate clearance speed", "SLA breach risk", "Approval turnaround"],
    recommendationCategories: ["Credentialing escalation", "Shortlist delivery", "Rate approval", "Replacement coverage"],
  },
  {
    id: "saas_customer_success",
    title: "SaaS Customer Success",
    description: "Renewal saves, product adoption, support escalations, stakeholder alignment, and QBR follow-through.",
    sourceTypes: ["CRM renewal record", "QBR notes", "Support ticket RCA", "Usage/adoption snapshot", "Executive email"],
    agents: ["Planner", "Retrieval", "Risk Analyst", "Adoption Analyst", "Recommendation", "Memory"],
    businessRules: ["Red renewals inside 90 days need a named save plan", "Technical blockers need owner and milestone", "Executive complaints require visible follow-up"],
    memoryTypes: ["Account profile", "Adoption memory", "Incident memory", "Stakeholder memory"],
    successMetrics: ["Renewal risk movement", "Product adoption lift", "Open blocker reduction", "Executive sentiment"],
    recommendationCategories: ["Renewal save plan", "Product escalation", "Adoption play", "Executive alignment"],
  },
  {
    id: "energy_field_service",
    title: "Energy Field Service",
    description: "Outage response, technician dispatch, safety compliance, maintenance SLAs, and monsoon readiness.",
    sourceTypes: ["Dispatch log", "Outage incident", "Safety checklist", "Technician availability", "Maintenance contract note"],
    agents: ["Planner", "Retrieval", "Field Risk Analyst", "Safety Analyst", "Recommendation", "Memory"],
    businessRules: ["Safety-critical outages outrank routine maintenance", "Missing certified technician coverage triggers escalation", "Renewal risk rises after repeat SLA misses"],
    memoryTypes: ["Asset memory", "Safety rule memory", "Outage episode memory", "Technician profile memory"],
    successMetrics: ["Outage recovery time", "Safety compliance", "Technician coverage", "SLA breach risk"],
    recommendationCategories: ["Dispatch escalation", "Safety approval", "Maintenance reschedule", "Renewal-risk mitigation"],
  },
];

const blueprintBuilderSteps: Array<{ key: BlueprintBuilderKey; label: string; helper: string }> = [
  {
    key: "source_types",
    label: "Source types",
    helper: "Choose the systems or documents Flow360 should read for this account.",
  },
  {
    key: "memory_types",
    label: "Memory types",
    helper: "Choose what the platform should remember persistently after ingestion and review.",
  },
  {
    key: "business_rules",
    label: "Business rules",
    helper: "Choose guardrails that should influence recommendations.",
  },
  {
    key: "recommendation_categories",
    label: "Recommendation categories",
    helper: "Choose the action types the planner should produce.",
  },
  {
    key: "success_metrics",
    label: "Success metrics",
    helper: "Choose how this account should prove business value.",
  },
  {
    key: "agents_enabled",
    label: "Agents enabled",
    helper: "Choose specialist agents to run under the planner.",
  },
];

const sourceLabels: Record<SourceCollection, { title: string; subtitle: string; icon: typeof BriefcaseBusiness; upload: boolean }> = {
  crm: {
    title: "CRM",
    subtitle: "Structured account, stakeholder, renewal, and deal context.",
    icon: BriefcaseBusiness,
    upload: true,
  },
  interactions: {
    title: "Meeting Notes, Transcripts And Mails",
    subtitle: "Every customer conversation becomes searchable memory.",
    icon: Mail,
    upload: true,
  },
  knowledge: {
    title: "Knowledge Base",
    subtitle: "Company policies, playbooks, checklists, rate cards, and best practices.",
    icon: BookOpen,
    upload: true,
  },
  risks: {
    title: "Risks And Incidents",
    subtitle: "Previous mistakes, SLA breaches, RCA notes, renewal risks, and blockers.",
    icon: ShieldAlert,
    upload: true,
  },
  candidates: {
    title: "Candidates And BGV",
    subtitle: "Candidate profiles, credentialing status, BGV checks, and shortlist readiness.",
    icon: Users,
    upload: true,
  },
};

const sourceDataKinds: Array<{
  id: SourceDataKind;
  title: string;
  subtitle: string;
  collection: SourceCollection;
  sourceType: string;
  icon: typeof BriefcaseBusiness;
}> = [
  {
    id: "meetings",
    title: "Meetings",
    subtitle: "Transcripts, call notes, QBRs, standups, and stakeholder conversations.",
    collection: "interactions",
    sourceType: "meeting",
    icon: CalendarDays,
  },
  {
    id: "crm",
    title: "CRM",
    subtitle: "Account updates, renewal notes, opportunity changes, contacts, and commercial context.",
    collection: "crm",
    sourceType: "crm_update",
    icon: BriefcaseBusiness,
  },
  {
    id: "emails",
    title: "Emails",
    subtitle: "Customer messages, escalation threads, approvals, and internal follow-ups.",
    collection: "interactions",
    sourceType: "email_thread",
    icon: Mail,
  },
  {
    id: "documents",
    title: "Documents",
    subtitle: "Uploaded PDFs, briefs, reports, contracts, RCAs, and supporting files.",
    collection: "knowledge",
    sourceType: "document",
    icon: FolderOpen,
  },
  {
    id: "notes",
    title: "Notes",
    subtitle: "Operator notes, observations, decisions, assumptions, and working context.",
    collection: "interactions",
    sourceType: "note",
    icon: ClipboardList,
  },
  {
    id: "policies",
    title: "Policies",
    subtitle: "Rules, playbooks, approval thresholds, compliance requirements, and procedures.",
    collection: "knowledge",
    sourceType: "policy",
    icon: BookOpen,
  },
];

function sourceDataKindFor(id: SourceDataKind) {
  return sourceDataKinds.find((item) => item.id === id) ?? sourceDataKinds[0];
}

const internalSourceTypes = new Set(["strategy_profile", "planner_outcome", "planner_run", "business_profile"]);

function normalizedText(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function isLowSignalPolicyEntry(entry: SourceEntry) {
  const title = normalizedText(entry.title);
  const content = normalizedText(entry.content);
  const fieldValues = Object.values(entry.fields ?? {}).map(normalizedText);
  const placeholderValues = new Set(["adf", "asdf", "asfd", "asdfsd", "asdfsdafa", "asdfsdfa"]);
  const hasPlaceholderTitle = placeholderValues.has(title);
  const hasPlaceholderContent = placeholderValues.has(content) || content.length < 18;
  const hasPlaceholderFields = fieldValues.length > 0 && fieldValues.every((value) => placeholderValues.has(value));
  return hasPlaceholderTitle && (hasPlaceholderContent || hasPlaceholderFields);
}

function sourceEntryMatchesKind(entry: SourceEntry, sourceType?: string) {
  if (internalSourceTypes.has(entry.source_type)) return false;
  if (!sourceType) return true;
  if (sourceType === "policy") return entry.source_type === "policy" && !isLowSignalPolicyEntry(entry);
  if (sourceType === "document") return !["policy", "meeting", "email_thread", "note"].includes(entry.source_type);
  if (sourceType === "meeting") return ["meeting", "transcript", "call_note"].includes(entry.source_type);
  if (sourceType === "email_thread") return entry.source_type === "email_thread";
  if (sourceType === "note") return entry.source_type === "note";
  return entry.source_type === sourceType;
}

const fieldSpecs: Record<SourceCollection, FieldSpec[]> = {
  crm: [
    { key: "client_owner", label: "Client owner", placeholder: "Kavya Raman" },
    { key: "decision_maker", label: "Decision maker", placeholder: "Rohan Kulkarni" },
    { key: "renewal_date", label: "Renewal date", placeholder: "2026-08-31" },
    { key: "contract_value", label: "Contract value", placeholder: "INR 15.2 Cr" },
  ],
  interactions: [
    { key: "interaction_type", label: "Type", placeholder: "meeting / email / transcript" },
    { key: "participants", label: "Participants", placeholder: "Kavya Raman, Meera Nair" },
    { key: "date", label: "Date", placeholder: "2026-06-27" },
    { key: "owner", label: "Owner", placeholder: "Ananya Suresh" },
  ],
  knowledge: [
    { key: "policy_owner", label: "Owner", placeholder: "Meera Nair" },
    { key: "applies_to", label: "Applies to", placeholder: "clinical candidates" },
    { key: "rule_type", label: "Rule type", placeholder: "credentialing" },
    { key: "severity", label: "Severity", placeholder: "critical" },
  ],
  risks: [
    { key: "severity", label: "Severity", placeholder: "high" },
    { key: "root_cause", label: "Root cause", placeholder: "late license verification" },
    { key: "impact", label: "Impact", placeholder: "two delayed starts" },
    { key: "owner", label: "Owner", placeholder: "Siddharth Menon" },
  ],
  candidates: [
    { key: "name", label: "Candidate name", placeholder: "Ananya Sharma" },
    { key: "role", label: "Role", placeholder: "ICU Nurse" },
    { key: "credentialing_status", label: "Credentialing", placeholder: "license verification pending" },
    { key: "bgv_status", label: "BGV status", placeholder: "background complete" },
  ],
};

function emptySources(): Record<SourceCollection, SourceEntry[]> {
  return { crm: [], interactions: [], knowledge: [], risks: [], candidates: [] };
}

const initialAccount: AccountSummary = {
  id: "acct-aarogya-health",
  name: "Loading company workspace",
  segment: "Live workspace",
  domain: "healthcare_staffing",
  health: "unknown",
  renewal_date: null,
  description: "Connect the backend and database to load live company memory.",
  supports_candidates: false,
  primary_user: "Account Manager",
  metrics: [],
  risk_trend: [],
  metadata: {},
};

const initialDashboardState: DashboardState = {
  accounts: [],
  account: initialAccount,
  recommendations: [],
  memory: [],
  sources: emptySources(),
  candidates: [],
  metrics: [],
  riskTrend: [],
  initialInteraction: "",
  mode: "live",
};

function sourceTypeFor(collection: SourceCollection) {
  return {
    crm: "crm_update",
    interactions: "customer_interaction",
    knowledge: "knowledge_article",
    risks: "risk_incident",
    candidates: "candidate_profile",
  }[collection];
}

const viewLabels: Record<ActiveView, string> = {
  today: "Home",
  accounts: "Accounts",
  dashboard: "Planner",
  source_data: "Source Data",
  planner_history: "Planner History",
  outcomes: "Outcomes",
  escalations: "Escalation Radar",
  blueprints: "Blueprints",
  crm: "CRM",
  interactions: "Meetings & Mail",
  knowledge: "Knowledge",
  risks: "Risks",
  candidates: "Candidates/BGV",
  memory: "Memory",
  execution: "Execution",
  trace: "Trace",
  settings: "Settings",
};

function stringifyField(value: unknown) {
  if (Array.isArray(value)) return value.join(", ");
  if (value === null || value === undefined) return "";
  return String(value);
}

function splitListField(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function titleCase(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function oneLine(value: string, fallback: string) {
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned || fallback;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unexpected API error";
}

function confidenceLabel(value: number) {
  return value > 0 ? `${value}%` : "Needs review";
}

function artifactFromExecution(execution: ActionExecution | null, key: ExecutionArtifactKey) {
  const raw = execution?.artifacts?.[key] ?? execution?.metadata?.artifacts?.[key];
  if (!raw) return null;
  if (typeof raw === "string") return { title: artifactTabs.find((item) => item.key === key)?.label ?? key, body: raw };
  return {
    title: raw.title ?? artifactTabs.find((item) => item.key === key)?.label ?? key,
    body: raw.body ?? "",
  };
}

function buildArtifactDraft(account: AccountSummary, recommendation: Recommendation, key: ExecutionArtifactKey) {
  const evidenceTitles = recommendation.evidence.map((item) => item.source_title).filter(Boolean);
  const evidenceLine = evidenceTitles.length ? evidenceTitles.slice(0, 3).join("; ") : "current company memory and retrieved context";
  const action = oneLine(recommendation.action, recommendation.title);
  const metric = oneLine(recommendation.business_metric, "improve the account outcome");

  const drafts: Record<ExecutionArtifactKey, { title: string; body: string }> = {
    email: {
      title: "Customer Email Draft",
      body: `Subject: ${account.name} - ${recommendation.title}

Hi team,

Following the latest review, we recommend the next step below:

${action}

Why this matters:
${recommendation.rationale}

Evidence checked:
${evidenceLine}

Owner: ${recommendation.owner_role}
Due: ${recommendation.due_date}
Target outcome: ${metric}

Please confirm if we can proceed with this plan or if another stakeholder should be included before execution.`,
    },
    crm: {
      title: "CRM Task",
      body: `Task: ${recommendation.title}
Account: ${account.name}
Owner: ${recommendation.owner_role}
Due: ${recommendation.due_date}
Priority: ${recommendation.priority}
Confidence: ${recommendation.confidence}%

Description:
${action}

Evidence to attach:
${evidenceLine}

Completion checklist:
- Confirm the named owner accepted the task.
- Attach evidence or customer communication.
- Update renewal/SLA risk after completion.
- Record result as human-reviewed memory.`,
    },
    escalation: {
      title: "Internal Escalation Note",
      body: `Escalation: ${recommendation.title}
Account: ${account.name}
Business risk: ${metric}

Decision needed:
${action}

Reason for escalation:
${recommendation.rationale}

Evidence:
${evidenceLine}

Ask:
Assign ${recommendation.owner_role} to complete this by ${recommendation.due_date}, then update Flow360 memory with the outcome.`,
    },
    sla: {
      title: "SLA / Risk Register Update",
      body: `Account: ${account.name}
Update type: Next best action approved
Risk level: ${recommendation.priority}
Action: ${recommendation.title}

SLA or business metric affected:
${metric}

Mitigation:
${action}

Control evidence:
${evidenceLine}

Follow-up:
Review after the due date and mark the result as resolved, delayed, or escalated.`,
    },
    summary: {
      title: "Meeting Summary",
      body: `Decision Summary

Flow360 recommended: ${recommendation.title}

Approved action:
${action}

Reasoning:
${recommendation.rationale}

Sources used:
${evidenceLine}

Owner and timing:
${recommendation.owner_role} - ${recommendation.due_date}

Memory update:
Future planner runs should remember that this action was reviewed by a human and should compare similar recommendations against the same evidence pattern.`,
    },
  };

  return drafts[key];
}

function buildLocalExecution(account: AccountSummary, recommendation: Recommendation): ActionExecution {
  const artifacts = Object.fromEntries(
    artifactTabs.map((item) => [item.key, buildArtifactDraft(account, recommendation, item.key)]),
  ) as NonNullable<ActionExecution["artifacts"]>;
  return {
    id: `exec-${recommendation.id}`,
    recommendation_id: recommendation.id,
    account_id: account.id,
    title: recommendation.title,
    owner_role: recommendation.owner_role,
    status: "ready",
    artifacts,
    metadata: {
      artifacts,
      evidence_titles: recommendation.evidence.map((item) => item.source_title).filter(Boolean),
      approval_summary: `Approved '${recommendation.title}' for ${account.name}.`,
      next_steps: [
        `Assign ${recommendation.owner_role}`,
        `Complete by ${recommendation.due_date}`,
        "Record the outcome after execution",
      ],
    },
    next_steps: [
      `Assign ${recommendation.owner_role}`,
      `Complete by ${recommendation.due_date}`,
      "Record the outcome after execution",
    ],
    created_at: new Date().toISOString(),
  };
}

function buildMemoryLedgerItems(
  memory: MemoryCard[],
  sources: Record<SourceCollection, SourceEntry[]>,
  account: AccountSummary,
): MemoryLedgerItem[] {
  const flatSources = Object.entries(sources).flatMap(([collection, entries]) =>
    entries.map((entry) => ({ collection: collection as SourceCollection, entry })),
  );
  return memory.slice(0, 12).map((item) => {
    const match = flatSources.find(({ entry }) => entry.title === item.title || item.id.endsWith(entry.id));
    const origin = match ? titleCase(match.collection === "interactions" ? "meetings_mail" : match.collection) : titleCase(item.memory_type);
    const haystack = `${item.title} ${item.summary}`.toLowerCase();
    const state: MemoryLedgerState =
      haystack.includes("approved") || haystack.includes("human review")
        ? "approved"
        : haystack.includes("blocked") ||
            haystack.includes("not be shortlisted") ||
            haystack.includes("pending") ||
            haystack.includes("contradict")
          ? "contradicted"
          : item.memory_type === "episodic" && (haystack.includes("rca") || haystack.includes("sla") || haystack.includes("incident"))
            ? "stale"
            : item.memory_type === "semantic" || haystack.includes("pattern") || haystack.includes("inferred")
              ? "inferred"
              : item.confidence >= 84
                ? "fresh"
                : "review";
    const stateLabel: Record<MemoryLedgerState, string> = {
      fresh: "Fresh",
      stale: "Stale warning",
      contradicted: "Needs review",
      approved: "Human-approved",
      inferred: "AI-inferred",
      review: "Review",
    };
    const plannerUse: Record<MemoryLedgerState, string> = {
      fresh: "Use directly",
      stale: "Use as warning",
      contradicted: "Block automation",
      approved: "Raise trust",
      inferred: "Explain pattern",
      review: "Ask human",
    };
    const why: Record<MemoryLedgerState, string> = {
      fresh: "This source is current enough to influence ranking, confidence, and due-date urgency.",
      stale: "This older event still matters as a failure pattern, but should not override newer source data.",
      contradicted: "This memory contains blockers or unresolved status, so Flow360 should avoid unsafe automatic execution.",
      approved: "A human has reviewed this decision or memory, so the planner can trust it more strongly in future runs.",
      inferred: "This is useful pattern memory created by the system, but it should explain recommendations instead of executing them alone.",
      review: "Confidence is not high enough for silent use, so the user should validate it before approval.",
    };
    const rule: Record<MemoryLedgerState, string> = {
      fresh: "Allow this memory to support recommendations and evidence citations.",
      stale: "Use this memory as risk context and ask for fresh data if the recommendation depends on it.",
      contradicted: "Require human review before using this memory to approve an external action.",
      approved: "Prioritize this memory when similar evidence appears in future planner runs.",
      inferred: "Use for explanation and pattern detection, not as the only basis for approval.",
      review: "Lower recommendation confidence until this memory is confirmed by a source or reviewer.",
    };

    return {
      id: item.id,
      title: item.title,
      source: match?.entry.source_type ?? item.memory_type,
      state,
      stateLabel: stateLabel[state],
      trust: item.confidence,
      origin,
      plannerUse: plannerUse[state],
      why: why[state],
      evidence: `Origin: ${origin}. Account: ${account.name}. Confidence: ${item.confidence}%. Summary: ${oneLine(item.summary, "No summary available.")}`,
      rule: rule[state],
    };
  });
}

function latestSource(sources: Record<SourceCollection, SourceEntry[]>) {
  const entries = Object.values(sources)
    .flat()
    .filter(Boolean);
  return entries.sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))[0] ?? null;
}

function possessiveName(name: string) {
  const trimmed = name.trim() || "this workspace";
  return trimmed.endsWith("s") ? `${trimmed}'` : `${trimmed}'s`;
}

function buildDailyBrief(data: DashboardState): DailyBrief {
  const account = data.account;
  const sources = data.sources ?? emptySources();
  const sourceCounts = Object.fromEntries(
    Object.entries(sources).map(([key, value]) => [key, value.length]),
  ) as Record<SourceCollection, number>;
  const topRecommendation = data.recommendations[0];
  const candidateBlockers = data.candidates.filter(
    (candidate) => candidate.missing_items.length > 0 || candidate.credentialing_status.toLowerCase().includes("pending"),
  );
  const latest = latestSource(sources);
  const healthScore = account.health === "red" ? 38 : account.health === "amber" ? 26 : 12;
  const priorityScore = topRecommendation
    ? { critical: 34, high: 26, medium: 16, low: 8 }[topRecommendation.priority]
    : 6;
  const blockerScore = candidateBlockers.length ? Math.min(22, 8 + candidateBlockers.length * 4) : 0;
  const renewalScore = account.metrics.some((metric) => /renewal|exposure|arr|sla|risk/i.test(`${metric.label} ${metric.value}`)) ? 10 : 0;
  const missingScore =
    (sourceCounts.crm < 2 ? 5 : 0) +
    (sourceCounts.interactions < 2 ? 6 : 0) +
    (sourceCounts.knowledge < 1 ? 6 : 0) +
    (sourceCounts.risks < 1 ? 6 : 0);
  const score = Math.min(99, healthScore + priorityScore + blockerScore + renewalScore + missingScore);
  const level: DailyBrief["level"] = score >= 82 ? "Critical" : score >= 66 ? "High" : score >= 46 ? "Watch" : "Stable";

  let nextView: ActiveView = "dashboard";
  let nextLabel = "Open Planner";
  let missing = "No major context gaps. Review the top recommendation and decide.";
  if (account.supports_candidates && candidateBlockers.length) {
    nextView = "candidates";
    nextLabel = "Open Candidates/BGV";
    missing = `${candidateBlockers.length} candidate blocker${candidateBlockers.length > 1 ? "s" : ""} need verification before safe execution.`;
  } else if (sourceCounts.interactions < 2) {
    nextView = "interactions";
    nextLabel = "Add Meeting/Mail";
    missing = "Latest customer conversation is thin; add meeting notes or mail before trusting a new plan.";
  } else if (sourceCounts.risks < 1 || account.health === "red") {
    nextView = "risks";
    nextLabel = "Open Risks";
    missing = account.health === "red" ? "Risk is high; confirm current RCA, owner, and customer impact." : "No risk/RCA context is connected yet.";
  } else if (sourceCounts.crm < 2) {
    nextView = "crm";
    nextLabel = "Open CRM";
    missing = "Add stakeholder, renewal, owner, or deal context to improve recommendations.";
  }

  const changed = latest
    ? `${latest.title} was the latest connected source from ${titleCase(latest.collection === "interactions" ? "meetings_mail" : latest.collection)}.`
    : "No new source entry is connected yet.";
  const actionTitle = topRecommendation?.title ?? "Capture missing context before running the planner";
  const reason = topRecommendation?.rationale ?? account.description;
  const signals = [
    `${Object.values(sourceCounts).reduce((total, count) => total + count, 0)} source entries connected`,
    `${data.memory.length} memory cards available`,
    topRecommendation ? `${topRecommendation.priority} priority recommendation` : "planner not run yet",
    candidateBlockers.length ? `${candidateBlockers.length} candidate blocker${candidateBlockers.length > 1 ? "s" : ""}` : `${account.health} account health`,
  ];

  return {
    account,
    score,
    level,
    nextView,
    nextLabel,
    actionTitle,
    reason,
    changed,
    missing,
    sourceCounts,
    signals,
  };
}

export function FlowDashboard() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [authForm, setAuthForm] = useState({
    company_name: "",
    industry: "",
    email: "",
    password: "",
  });
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [authError, setAuthError] = useState("");
  const [state, setState] = useState<DashboardState>(initialDashboardState);
  const [accountId, setAccountId] = useState(initialDashboardState.account.id);
  const [activeView, setActiveView] = useState<ActiveView>("today");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [guideCollapsed, setGuideCollapsed] = useState(true);
  const [dailyStates, setDailyStates] = useState<Record<string, DashboardState>>({});
  const [run, setRun] = useState<AgentRunResult | null>(null);
  const [selected, setSelected] = useState<Recommendation | null>(null);
  const [plannerObjective, setPlannerObjective] = useState("");
  const [interaction, setInteraction] = useState(initialDashboardState.initialInteraction);
  const [isRunning, setIsRunning] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<Record<string, string>>({});
  const [sourceDataKind, setSourceDataKind] = useState<SourceDataKind>("meetings");
  const [plannerRuns, setPlannerRuns] = useState<PlannerRunCase[]>([]);
  const [strategyProfile, setStrategyProfile] = useState<StrategyProfile | null>(null);
  const [selectedPlannerRunId, setSelectedPlannerRunId] = useState("");
  const [drafts, setDrafts] = useState<Record<string, { title: string; content: string; fields: Record<string, string> }>>({});
  const [loadedPendingIds, setLoadedPendingIds] = useState<Record<string, string>>({});
  const [ingestedPendingIds, setIngestedPendingIds] = useState<Record<string, boolean>>({});
  const [bgvResults, setBgvResults] = useState<Record<string, BGVResult>>({});
  const [lastExecution, setLastExecution] = useState<ActionExecution | null>(null);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [reviewStatus, setReviewStatus] = useState("");
  const [activeArtifact, setActiveArtifact] = useState<ExecutionArtifactKey>("email");
  const [copyStatus, setCopyStatus] = useState("");
  const [selectedLedgerId, setSelectedLedgerId] = useState<string | null>(null);
  const [intelligence, setIntelligence] = useState<AccountIntelligence[]>([]);
  const [isIntelligenceLoading, setIsIntelligenceLoading] = useState(false);
  const [selectedBlueprintId, setSelectedBlueprintId] = useState<BusinessDomain>("healthcare_staffing");
  const [builderOpen, setBuilderOpen] = useState(false);
  const [builderStep, setBuilderStep] = useState(-1);
  const [builderText, setBuilderText] = useState("");
  const [builderSuggestion, setBuilderSuggestion] = useState<BlueprintSuggestionResponse | null>(null);
  const [builderSelections, setBuilderSelections] = useState<Record<BlueprintBuilderKey, string[]>>({
    source_types: [],
    memory_types: [],
    business_rules: [],
    recommendation_categories: [],
    success_metrics: [],
    agents_enabled: [],
  });
  const [builderCustomPrompt, setBuilderCustomPrompt] = useState<Record<BlueprintBuilderKey, string>>({
    source_types: "",
    memory_types: "",
    business_rules: "",
    recommendation_categories: "",
    success_metrics: "",
    agents_enabled: "",
  });
  const [builderStatus, setBuilderStatus] = useState("");
  const [isSuggestingBlueprint, setIsSuggestingBlueprint] = useState(false);
  const [isAddingBlueprintOption, setIsAddingBlueprintOption] = useState(false);
  const [isCreatingBlueprintAccount, setIsCreatingBlueprintAccount] = useState(false);
  const [apiError, setApiError] = useState("");
  const [guideMessages, setGuideMessages] = useState<GuideMessage[]>([
    {
      role: "assistant",
      content:
        "I can see this company workspace. Pick a focus area, open source data, then run the planner after adding new context.",
    },
  ]);
  const [guideInput, setGuideInput] = useState("What should I do next on this screen?");
  const [isGuideLoading, setIsGuideLoading] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SESSION_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as AuthSession;
        setSession(parsed);
        if (parsed.account?.id) setAccountId(parsed.account.id);
      }
    } catch {
      window.localStorage.removeItem(SESSION_KEY);
    } finally {
      setSessionReady(true);
    }
  }, []);

  useEffect(() => {
    if (!session) return;
    getDashboardState(accountId, session.access_token)
      .then((data) => {
        setApiError("");
        setState(data);
        setDailyStates((current) => ({ ...current, [data.account.id]: data }));
        setRun(null);
        const firstRec = data.recommendations[0] ?? null;
        setSelected(firstRec);
        setLastExecution(null);
        setSelectedLedgerId(null);
      })
      .catch((error) => setApiError(`Could not load live dashboard state: ${errorMessage(error)}`));
    getPlannerRuns(session.access_token)
      .then((runs) => {
        setPlannerRuns(runs);
        setSelectedPlannerRunId((current) => current || runs[0]?.id || "");
      })
      .catch(() => setPlannerRuns([]));
    getStrategyProfile(session.access_token)
      .then(setStrategyProfile)
      .catch(() => setStrategyProfile(null));
  }, [accountId, session]);

  const accountIds = useMemo(() => state.accounts.map((item) => item.id).join("|"), [state.accounts]);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    const accounts = state.accounts;
    Promise.all(accounts.map((item) => getDashboardState(item.id, session.access_token)))
      .then((items) => {
        if (cancelled) return;
        setApiError("");
        setDailyStates(Object.fromEntries(items.map((item) => [item.account.id, item])));
      })
      .catch((error) => {
        if (!cancelled) setApiError(`Could not refresh live account briefs: ${errorMessage(error)}`);
      });
    return () => {
      cancelled = true;
    };
  }, [accountIds, state.accounts, session]);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    getIntelligenceBriefs(session.access_token)
      .then((data) => {
        if (!cancelled) {
          setIntelligence(data.accounts ?? []);
        }
      })
      .catch(() => {
        if (!cancelled) setIntelligence([]);
      })
      .finally(() => {
        if (!cancelled) {
          setIsIntelligenceLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [accountIds, session]);

  const account = state.account;
  const sources = state.sources ?? emptySources();
  const recommendations = useMemo(() => {
    const raw = run?.account_id === account.id && run.recommendations.length ? run.recommendations : state.recommendations;
    const seen = new Set<string>();
    return raw
      .filter((item) => {
        const key = `${item.title}-${item.action}`.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 8);
  }, [account.id, run, state.recommendations]);
  const activeSelected = selected && selected.account_id === account.id ? selected : recommendations[0] ?? null;
  const activeRunCase = useMemo(() => {
    const selectedRunId = activeSelected?.run_id || (run?.account_id === account.id ? run.run_id : "");
    if (!selectedRunId) return null;
    const savedRun = plannerRuns.find((item) => item.id === selectedRunId);
    if (savedRun) return savedRun;
    if (run?.run_id === selectedRunId) {
      return {
        id: run.run_id,
        account_id: run.account_id,
        objective: run.objective,
        title: run.title,
        intake_text: interaction,
        intake_hash: "",
        case_type: "manual",
        status: run.status,
        created_at: run.created_at,
        analysis: run.analysis,
        agent_trace: run.agent_trace,
        retrieved_context: run.retrieved_context,
        recommendations: run.recommendations,
        approval_history: [],
      } satisfies PlannerRunCase;
    }
    return null;
  }, [account.id, activeSelected?.run_id, interaction, plannerRuns, run]);
  const trace = run?.account_id === account.id ? run.agent_trace : [];
  const displayMemory = state.memory;
  const activeExecution =
    activeSelected && lastExecution && (!lastExecution.recommendation_id || lastExecution.recommendation_id === activeSelected.id)
      ? lastExecution
      : null;
  const intelligenceByAccount = useMemo(
    () => new Map(intelligence.map((item) => [item.account_id, item])),
    [intelligence],
  );

  const navItems = useMemo(() => {
    return [
      { id: "today", label: "Home", icon: CalendarDays },
      { id: "dashboard", label: "Planner", icon: ClipboardList },
      { id: "source_data", label: "Source Data", icon: Upload },
      { id: "memory", label: "Memory", icon: Database },
      { id: "planner_history", label: "Planner History", icon: History },
      { id: "outcomes", label: "Outcomes", icon: BadgeCheck },
      { id: "settings", label: "Settings", icon: Settings },
    ] satisfies Array<{ id: ActiveView; label: string; icon: typeof BriefcaseBusiness }>;
  }, []);

  async function refreshAccount(targetId = account.id) {
    const nextState = await getDashboardState(targetId, session?.access_token);
    setState(nextState);
    setSelected(nextState.recommendations[0] ?? null);
  }

  async function refreshIntelligence() {
    setIsIntelligenceLoading(true);
    try {
      const data = await getIntelligenceBriefs(session?.access_token);
      setIntelligence(data.accounts ?? []);
    } catch {
      setIntelligence([]);
    } finally {
      setIsIntelligenceLoading(false);
    }
  }

  async function refreshPlannerRuns() {
    if (!session) return;
    try {
      const runs = await getPlannerRuns(session.access_token);
      setPlannerRuns(runs);
      setSelectedPlannerRunId((current) => current || runs[0]?.id || "");
    } catch {
      setPlannerRuns([]);
    }
  }

  async function refreshStrategyProfile() {
    if (!session) return;
    try {
      setStrategyProfile(await getStrategyProfile(session.access_token));
    } catch {
      setStrategyProfile(null);
    }
  }

  async function handleAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsAuthenticating(true);
    setAuthError("");
    try {
      const nextSession =
        authMode === "signup"
          ? await signupCompany(authForm)
          : await loginCompany({ email: authForm.email, password: authForm.password });
      window.localStorage.setItem(SESSION_KEY, JSON.stringify(nextSession));
      setSession(nextSession);
      if (nextSession.account?.id) setAccountId(nextSession.account.id);
    } catch (error) {
      setAuthError(errorMessage(error));
    } finally {
      setIsAuthenticating(false);
    }
  }

  function handleLogout() {
    window.localStorage.removeItem(SESSION_KEY);
    setSession(null);
    setState(initialDashboardState);
    setAccountId(initialDashboardState.account.id);
  }

  function chooseAccount(next: AccountSummary) {
    setAccountId(next.id);
    setPlannerObjective("");
    setInteraction("");
    setReviewStatus("");
    setActiveView("dashboard");
  }

  function openAccountView(next: AccountSummary, view: ActiveView = "dashboard") {
    setAccountId(next.id);
    if (view === "crm" || view === "interactions" || view === "knowledge" || view === "risks" || view === "candidates") {
      setSourceDataKind(view === "crm" ? "crm" : view === "knowledge" ? "documents" : "meetings");
      setActiveView("source_data");
      return;
    }
    setActiveView(view);
  }

  async function handleRunPlanner(forceNew = false) {
    if (!plannerObjective.trim() || !interaction.trim()) return;
    setIsRunning(true);
    setApiError("");
    setReviewStatus("");
    try {
      const result = await runPlanner(account.id, interaction, plannerObjective, session?.access_token, forceNew);
      setRun(result);
      setSelected(result.recommendations[0] ?? null);
      setActiveView("dashboard");
      refreshIntelligence();
      refreshPlannerRuns();
    } catch (error) {
      setApiError(`Could not run planner: ${errorMessage(error)}`);
    } finally {
      setIsRunning(false);
    }
  }

  async function handleReview(decision: "approved" | "rejected") {
    if (!activeSelected) return;
    if (activeSelected.status !== "pending") {
      setReviewStatus(`Already reviewed as ${activeSelected.status}. Duplicate reviews are blocked.`);
      return;
    }
    setReviewingId(activeSelected.id);
    setReviewStatus("");
    setApiError("");
    try {
      const response = await reviewRecommendation(activeSelected.id, decision, session?.access_token);
      const reviewed = { ...activeSelected, status: decision };
      const execution =
        (response as { action_execution?: ActionExecution }).action_execution ??
        (decision === "approved" ? buildLocalExecution(account, reviewed) : null);
      const update = (item: Recommendation) => (item.id === activeSelected.id ? reviewed : item);

      setLastExecution(execution);
      setSelected(reviewed);
      setRun((current) =>
        current
          ? {
              ...current,
              recommendations: current.recommendations.map(update),
            }
          : current,
      );
      setState((current) => ({
        ...current,
        recommendations: current.recommendations.map(update),
        memory: [
          {
            id: `mem-feedback-${activeSelected.id}`,
            entity_type: "account",
            entity_id: account.id,
            title: decision === "approved" ? "Approved Action" : "Rejected Action",
            memory_type: "episodic",
            summary:
              decision === "approved"
                ? `Approved '${activeSelected.title}'. Execution artifacts are ready for ${activeSelected.owner_role}.`
                : `Rejected '${activeSelected.title}'. Future runs should avoid similar recommendations unless stronger evidence appears.`,
            confidence: 93,
            updated_at: new Date().toISOString(),
          },
          ...current.memory,
        ],
      }));
      setReviewStatus(
        decision === "approved"
          ? "Approval saved. The decision updated the AI Strategy Profile and action artifacts are ready."
          : "Rejection saved. The AI Strategy Profile will avoid similar plans unless stronger evidence appears.",
      );
      if (decision === "approved") {
        setActiveArtifact("email");
        setActiveView("execution");
      }
      refreshIntelligence();
      refreshPlannerRuns();
      refreshStrategyProfile();
    } catch (error) {
      setApiError(`Could not ${decision === "approved" ? "approve" : "reject"} recommendation: ${errorMessage(error)}`);
    } finally {
      setReviewingId(null);
    }
  }

  function draftFor(collection: SourceCollection) {
    return (
      drafts[collection] ?? {
        title: "",
        content: "",
        fields: Object.fromEntries(fieldSpecs[collection].map((field) => [field.key, ""])),
      }
    );
  }

  function updateDraft(collection: SourceCollection, next: Partial<{ title: string; content: string; fields: Record<string, string> }>) {
    setDrafts((current) => ({ ...current, [collection]: { ...draftFor(collection), ...next } }));
  }

  function pendingKey(collection: SourceCollection) {
    return `${account.id}:${collection}`;
  }

  function pendingSamplesFor(collection: SourceCollection) {
    const existingTitles = new Set((sources[collection] ?? []).map((entry) => entry.title));
    return (pendingSourceSamples[account.id]?.[collection] ?? []).filter(
      (sample) => !ingestedPendingIds[sample.id] && !existingTitles.has(sample.title),
    );
  }

  function loadPendingSample(collection: SourceCollection, sample: PendingSourceSample) {
    const fields = Object.fromEntries(fieldSpecs[collection].map((field) => [field.key, stringifyField(sample.fields[field.key])]));
    Object.entries(sample.fields).forEach(([key, value]) => {
      fields[key] = stringifyField(value);
    });
    updateDraft(collection, {
      title: sample.title,
      content: sample.content,
      fields,
    });
    setLoadedPendingIds((current) => ({ ...current, [pendingKey(collection)]: sample.id }));
    setUploadStatus((current) => ({ ...current, [collection]: "Sample loaded" }));
  }

  async function submitSource(collection: SourceCollection, sourceTypeOverride?: string) {
    const draft = draftFor(collection);
    if (!draft.title.trim() || !draft.content.trim()) return;
    if (
      sourceTypeOverride === "policy" &&
      isLowSignalPolicyEntry({
        id: "draft",
        account_id: account.id,
        collection,
        source_type: "policy",
        title: draft.title,
        content: draft.content,
        fields: draft.fields,
        created_at: new Date().toISOString(),
      })
    ) {
      setUploadStatus((current) => ({ ...current, [collection]: "Use a real policy" }));
      return;
    }
    const activePendingId = loadedPendingIds[pendingKey(collection)];
    const activePending = pendingSourceSamples[account.id]?.[collection]?.find((sample) => sample.id === activePendingId);
    const payload = {
      account_id: account.id,
      collection,
      source_type: activePending?.source_type ?? sourceTypeOverride ?? sourceTypeFor(collection),
      title: draft.title,
      content: draft.content,
      fields: draft.fields,
    };
    const created = await createSourceEntry(payload).catch(() => null);
    const newEntry = created?.entry ?? {
      id: `local-${collection}-${Date.now()}`,
      account_id: account.id,
      collection,
      source_type: payload.source_type,
      title: draft.title,
      content: draft.content,
      fields: draft.fields,
      created_at: new Date().toISOString(),
    };
    setState((current) => ({
      ...current,
      sources: {
        ...current.sources,
        [collection]: [newEntry, ...(current.sources?.[collection] ?? [])],
      },
      candidates:
        collection === "candidates"
          ? [
              {
                id: String(newEntry.fields.candidate_id || newEntry.id.replace(/^src-/, "cand-").replace(/^local-/, "cand-")),
                account_id: account.id,
                name: stringifyField(newEntry.fields.name || newEntry.title.replace("Candidate Profile - ", "")),
                role: stringifyField(newEntry.fields.role || "Candidate"),
                availability_date: stringifyField(newEntry.fields.availability_date || ""),
                credentialing_status: stringifyField(newEntry.fields.credentialing_status || "unknown"),
                bgv_status: stringifyField(newEntry.fields.bgv_status || "not_started"),
                fit_score: Number(newEntry.fields.fit_score || 70),
                rate_variance_percent: Number(newEntry.fields.rate_variance_percent || 0),
                missing_items: splitListField(newEntry.fields.missing_items),
                risk_flags: splitListField(newEntry.fields.risk_flags),
                metadata: newEntry.fields,
              },
              ...current.candidates.filter(
                (candidate) =>
                  candidate.name !== stringifyField(newEntry.fields.name || newEntry.title.replace("Candidate Profile - ", "")),
              ),
            ]
          : current.candidates,
      memory: [
        {
          id: `mem-${newEntry.id}`,
          entity_type: "account",
          entity_id: account.id,
          title: newEntry.title,
          memory_type: collection === "knowledge" ? "rule" : collection === "risks" ? "episodic" : collection === "crm" ? "profile" : "raw",
          summary: newEntry.content.slice(0, 360),
          confidence: 86,
          updated_at: new Date().toISOString(),
        },
        ...current.memory,
      ],
    }));
    if (activePendingId) {
      setIngestedPendingIds((current) => ({ ...current, [activePendingId]: true }));
      setLoadedPendingIds((current) => {
        const next = { ...current };
        delete next[pendingKey(collection)];
        return next;
      });
    }
    updateDraft(collection, {
      title: "",
      content: "",
      fields: Object.fromEntries(fieldSpecs[collection].map((field) => [field.key, ""])),
    });
    refreshIntelligence();
  }

  async function handleUpload(collection: SourceCollection, file?: File, sourceTypeOverride?: string) {
    if (!file) return;
    setUploadStatus((current) => ({ ...current, [collection]: "Uploading" }));
    try {
      await uploadDocument(file, account.id, collection, sourceTypeOverride ?? sourceTypeFor(collection));
      setUploadStatus((current) => ({ ...current, [collection]: "Indexed into memory" }));
      await refreshAccount(account.id);
      refreshIntelligence();
    } catch {
      setUploadStatus((current) => ({ ...current, [collection]: "Backend offline" }));
    }
  }

  async function handleBGV(candidate: CandidateProfile) {
    const result = await runBGV(account.id, candidate.id);
    setBgvResults((current) => ({ ...current, [candidate.id]: result }));
  }

  async function copyArtifact(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus("Copied");
      window.setTimeout(() => setCopyStatus(""), 1400);
    } catch {
      setCopyStatus("Copy failed");
      window.setTimeout(() => setCopyStatus(""), 1400);
    }
  }

  async function sendGuide() {
    const question = guideInput.trim();
    if (!question) return;
    const nextMessages: GuideMessage[] = [...guideMessages, { role: "user", content: question }];
    setGuideMessages(nextMessages);
    setGuideInput("");
    setIsGuideLoading(true);
    const response = await guideChat({
      account_id: account.id,
      current_view: activeView,
      visible_context: {
        account: account.name,
        current_screen: viewLabels[activeView],
        available_navigation: navItems.map((item) => item.label),
        visible_buttons: [
          activeView === "today" ? "Workspace" : "Current workspace",
          activeView === "today" ? "Open Planner" : "Run Planner",
          ...(activeView === "today" ? ["Open next action", "Open workspace next step"] : []),
          ...(activeView === "dashboard" ? ["Approve selected action", "Reject selected action"] : []),
          ...(activeView === "outcomes" ? ["Open account", "Open Escalation Radar"] : []),
          ...(activeView === "escalations" ? ["Open account", "Open action artifacts"] : []),
          ...(activeView === "blueprints" ? ["Select blueprint", "Compare domains"] : []),
          ...(activeView === "execution" ? ["Approve and generate artifacts", "Copy artifact", "Open Memory Ledger"] : []),
          ...(activeView === "crm" || activeView === "interactions" || activeView === "knowledge" || activeView === "risks" || activeView === "candidates"
            ? ["Load sample", "Save and ingest to memory", "Upload file"]
            : []),
          ...(activeView === "memory" ? ["Open Memory Ledger", "Inspect trust state"] : []),
        ],
        visible_sections:
          activeView === "today"
            ? ["Attention Today", "Pending Approvals", "Recent Planner Runs", "Memory and Source Health", "Source Data Gaps"]
            : activeView === "dashboard"
            ? ["Metrics", "Recommendation Inbox", "Agent Decision Flow", "Risk Trend"]
            : activeView === "outcomes"
              ? ["Business Outcome Scorecards", "Before / After Metrics", "Projected Impact"]
              : activeView === "escalations"
                ? ["Escalation Radar", "Owner Deadlines", "Evidence"]
                : activeView === "blueprints"
                  ? ["Domain Blueprint Studio", "Source Types", "Agents", "Business Rules", "Success Metrics"]
            : activeView === "memory"
              ? ["Neural Memory Mesh", "Memory Sources", "Memory Ledger", "Memory Cards", "Evidence For Selected Action"]
              : activeView === "execution"
                ? ["Approved Action Artifacts", "Generated Artifacts", "Execution Timeline", "Memory Writeback"]
                : activeView === "trace"
                  ? ["Agent Trace", "Retrieved Evidence", "Run Summary"]
                  : activeView === "accounts"
                    ? ["Focus Area Picker"]
                    : [sourceLabels[activeView as SourceCollection]?.title ?? viewLabels[activeView], "Add New Entry", "Existing Entries"],
        visible_recommendations: recommendations.slice(0, 5).map((item) => ({
          title: item.title,
          priority: item.priority,
          owner: item.owner_role,
          due: item.due_date,
          confidence: item.confidence,
        })),
        selected_recommendation: activeSelected
          ? {
              title: activeSelected.title,
              priority: activeSelected.priority,
              owner: activeSelected.owner_role,
              due: activeSelected.due_date,
              evidence_titles: activeSelected.evidence.slice(0, 4).map((item) => item.source_title),
            }
          : null,
        source_counts: Object.fromEntries(Object.entries(sources).map(([key, value]) => [key, value.length])),
        visible_source_titles: Object.fromEntries(
          Object.entries(sources).map(([key, value]) => [key, value.slice(0, 4).map((entry) => entry.title)]),
        ),
        visible_metrics: state.metrics,
        generated_intelligence: intelligenceByAccount.get(account.id) ?? null,
        candidate_names: state.candidates.slice(0, 6).map((candidate) => candidate.name),
        rule: "Use this visible_context as the only source of truth for UI navigation and button names.",
      },
      messages: nextMessages,
      question,
    });
    setGuideMessages((current) => [...current, { role: "assistant", content: response.answer }]);
    setIsGuideLoading(false);
  }

  function resetBuilder() {
    setBuilderStep(-1);
    setBuilderSuggestion(null);
    setBuilderStatus("");
    setBuilderSelections({
      source_types: [],
      memory_types: [],
      business_rules: [],
      recommendation_categories: [],
      success_metrics: [],
      agents_enabled: [],
    });
    setBuilderCustomPrompt({
      source_types: "",
      memory_types: "",
      business_rules: "",
      recommendation_categories: "",
      success_metrics: "",
      agents_enabled: "",
    });
  }

  function updateBuilderDraft(next: Partial<BlueprintAccountDraft>) {
    setBuilderSuggestion((current) => {
      if (!current) return current;
      return { ...current, account: { ...current.account, ...next } };
    });
  }

  async function generateBlueprintBuilder() {
    const description = builderText.trim();
    if (!description) {
      setBuilderStatus("Describe the account first.");
      return;
    }
    setIsSuggestingBlueprint(true);
    setBuilderStatus("Generating blueprint options from the account description...");
    const selectedBlueprint = domainBlueprints.find((item) => item.id === selectedBlueprintId) ?? domainBlueprints[0];
    try {
      const suggestion = await suggestBlueprint({
        account_text: description,
        domain: selectedBlueprint.id,
        blueprint_title: selectedBlueprint.title,
      });
      setBuilderSuggestion(suggestion);
      setBuilderSelections(
        Object.fromEntries(
          blueprintBuilderSteps.map((step) => [step.key, suggestion.options[step.key]?.slice(0, 5) ?? []]),
        ) as Record<BlueprintBuilderKey, string[]>,
      );
      setBuilderStep(0);
      setBuilderStatus("");
    } catch {
      setBuilderStatus("Could not reach the blueprint AI. Check the backend and Groq keys, then try again.");
    } finally {
      setIsSuggestingBlueprint(false);
    }
  }

  function toggleBuilderOption(key: BlueprintBuilderKey, option: string) {
    setBuilderSelections((current) => {
      const selected = new Set(current[key]);
      if (selected.has(option)) {
        selected.delete(option);
      } else {
        selected.add(option);
      }
      return { ...current, [key]: Array.from(selected) };
    });
  }

  async function addBlueprintOptions(key: BlueprintBuilderKey) {
    const instruction = builderCustomPrompt[key].trim();
    if (!instruction || !builderSuggestion) return;
    setIsAddingBlueprintOption(true);
    setBuilderStatus("Asking AI for more options on this step...");
    try {
      const response = await suggestBlueprintOptions({
        account_text: builderText,
        domain: selectedBlueprintId,
        category: key,
        instruction,
        selected_options: builderSelections[key],
      });
      const existing = new Set(builderSuggestion.options[key].map((item) => item.toLowerCase()));
      const fresh = response.options.filter((item) => !existing.has(item.toLowerCase()));
      setBuilderSuggestion((current) => {
        if (!current) return current;
        return {
          ...current,
          options: {
            ...current.options,
            [key]: [...current.options[key], ...fresh],
          },
        };
      });
      setBuilderSelections((current) => ({
        ...current,
        [key]: Array.from(new Set([...current[key], ...fresh])),
      }));
      setBuilderCustomPrompt((current) => ({ ...current, [key]: "" }));
      setBuilderStatus(fresh.length ? "Added new options to this card." : "No new options were added.");
    } catch {
      const typed = instruction
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      setBuilderSuggestion((current) => {
        if (!current) return current;
        return { ...current, options: { ...current.options, [key]: [...current.options[key], ...typed] } };
      });
      setBuilderSelections((current) => ({ ...current, [key]: Array.from(new Set([...current[key], ...typed])) }));
      setBuilderStatus("Backend unavailable, so I added your typed options directly.");
    } finally {
      setIsAddingBlueprintOption(false);
    }
  }

  async function createAccountFromBuilder() {
    if (!builderSuggestion) return;
    setIsCreatingBlueprintAccount(true);
    setBuilderStatus("Creating account and writing the first memory record...");
    try {
      const created = await createBlueprintAccount({
        account_text: builderText,
        domain: selectedBlueprintId,
        name: builderSuggestion.account.name,
        segment: builderSuggestion.account.segment,
        description: builderSuggestion.account.description,
        primary_user: builderSuggestion.account.primary_user,
        supports_candidates: builderSuggestion.account.supports_candidates,
        selections: builderSelections,
      });
      const nextState = await getDashboardState(created.account.id, session?.access_token);
      setState(nextState);
      setDailyStates((current) => ({ ...current, [nextState.account.id]: nextState }));
      setAccountId(created.account.id);
      setActiveView("dashboard");
      setBuilderOpen(false);
      resetBuilder();
      refreshIntelligence();
    } catch {
      setBuilderStatus("Could not create the account. Check backend/Supabase connection and try again.");
    } finally {
      setIsCreatingBlueprintAccount(false);
    }
  }

  function outcomesView() {
    const accountRuns = plannerRuns.filter((item) => item.account_id === account.id);
    const totals = accountRuns.reduce(
      (summary, item) => {
        const approved = item.recommendations.filter((rec) => rec.status === "approved").length;
        const rejected = item.recommendations.filter((rec) => rec.status === "rejected").length;
        const pending = item.recommendations.filter((rec) => rec.status === "pending").length;
        return {
          runs: summary.runs + 1,
          recommendations: summary.recommendations + item.recommendations.length,
          approved: summary.approved + approved,
          rejected: summary.rejected + rejected,
          pending: summary.pending + pending,
          evidence: summary.evidence + item.retrieved_context.length,
        };
      },
      { runs: 0, recommendations: 0, approved: 0, rejected: 0, pending: 0, evidence: 0 },
    );
    const approvalRate = totals.recommendations ? Math.round((totals.approved / totals.recommendations) * 100) : 0;
    const reviewedRate = totals.recommendations
      ? Math.round(((totals.approved + totals.rejected) / totals.recommendations) * 100)
      : 0;

    return (
      <div className="space-y-4">
        <section className="rounded-lg border border-black/10 bg-[#111111] p-5 text-white shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase text-cyan-300">Planner Outcome Scorecards</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-normal">Which decisions were reviewed, approved, and learned from.</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-white/62">
                Generated from persistent Planner Runs. Each card ties one business objective to its intake, evidence coverage,
                recommendations, human reviews, and memory writeback state.
              </p>
            </div>
            <button
              onClick={() => {
                refreshPlannerRuns();
                refreshIntelligence();
              }}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-white px-4 text-sm font-semibold text-black hover:bg-white/90"
            >
              {isIntelligenceLoading ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
              Refresh outcomes
            </button>
          </div>
        </section>

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {[
            ["Planner runs", String(totals.runs), "persistent business cases"],
            ["Recommendations", String(totals.recommendations), "generated next best actions"],
            ["Reviewed", `${reviewedRate}%`, `${totals.approved} approved, ${totals.rejected} rejected`],
            ["Pending review", String(totals.pending), "awaiting human decision"],
            ["Evidence used", String(totals.evidence), "retrieved source links"],
          ].map(([label, value, detail]) => (
            <div key={label} className="rounded-lg border border-black/10 bg-white p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase text-black/42">{label}</p>
              <p className="mt-2 text-2xl font-semibold tracking-normal">{value}</p>
              <p className="mt-1 text-xs text-black/48">{detail}</p>
            </div>
          ))}
        </section>

        <div className="grid gap-4">
          {accountRuns.map((plannerRun) => {
            const approved = plannerRun.recommendations.filter((item) => item.status === "approved");
            const rejected = plannerRun.recommendations.filter((item) => item.status === "rejected");
            const pending = plannerRun.recommendations.filter((item) => item.status === "pending");
            const reviewed = approved.length + rejected.length;
            const evidenceTitles = Array.from(
              new Set(
                plannerRun.retrieved_context
                  .map((item) => item.source_title)
                  .filter(Boolean)
                  .slice(0, 5),
              ),
            );
            const outcomeState =
              approved.length > 0
                ? "Approved actions ready for execution"
                : rejected.length > 0
                  ? "Rejected actions recorded as memory"
                  : "Awaiting human review";
            const statusTone =
              approved.length > 0
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : rejected.length > 0
                  ? "border-rose-200 bg-rose-50 text-rose-800"
                  : "border-amber-200 bg-amber-50 text-amber-800";
            return (
              <article key={plannerRun.id} className="rounded-lg border border-black/10 bg-white p-4 shadow-sm">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase text-indigo-700">Planner Run</p>
                    <h3 className="mt-1 text-xl font-semibold tracking-normal">{plannerRun.objective}</h3>
                    {plannerRun.intake_text && (
                      <p className="mt-2 line-clamp-3 max-w-5xl text-sm leading-6 text-black/60">{plannerRun.intake_text}</p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-md border px-3 py-2 text-xs font-semibold ${statusTone}`}>{outcomeState}</span>
                    <button
                      onClick={() => {
                        setSelectedPlannerRunId(plannerRun.id);
                        setActiveView("planner_history");
                      }}
                      className="inline-flex h-10 items-center gap-2 rounded-md bg-black px-3 text-sm font-semibold text-white hover:bg-black/85"
                    >
                      Open run
                      <ChevronRight size={16} />
                    </button>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  {[
                    ["Recommendations", String(plannerRun.recommendations.length), "generated actions"],
                    ["Human review", `${reviewed}/${plannerRun.recommendations.length}`, `${approved.length} approved, ${rejected.length} rejected`],
                    ["Evidence coverage", `${plannerRun.retrieved_context.length}`, "retrieved source links"],
                    ["Pending actions", String(pending.length), "still awaiting review"],
                  ].map(([label, value, detail]) => (
                    <div key={label} className="rounded-lg border border-black/10 bg-[#fbfaf8] p-3">
                      <p className="text-xs font-semibold uppercase text-black/42">{label}</p>
                      <p className="mt-2 text-xl font-semibold">{value}</p>
                      <p className="mt-1 text-xs text-black/50">{detail}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                  <div className="rounded-lg border border-black/10 bg-[#fbfaf8] p-3">
                    <p className="text-xs font-semibold uppercase text-black/42">Approved / rejected learning</p>
                    <p className="mt-2 text-sm leading-6 text-black/62">
                      {approved.length > 0
                        ? `Approved: ${approved.map((item) => item.title).slice(0, 3).join("; ")}`
                        : rejected.length > 0
                          ? `Rejected: ${rejected.map((item) => item.title).slice(0, 3).join("; ")}`
                          : "No review decision yet. Approval or rejection will write outcome memory for future planner runs."}
                    </p>
                  </div>
                  <div className="rounded-lg border border-black/10 bg-[#fbfaf8] p-3">
                    <p className="text-xs font-semibold uppercase text-black/42">Evidence used</p>
                    <p className="mt-2 text-sm leading-6 text-black/62">
                      {evidenceTitles.length ? evidenceTitles.join("; ") : "No retrieved evidence captured for this run."}
                    </p>
                  </div>
                </div>
              </article>
            );
          })}
          {!accountRuns.length && (
            <section className="rounded-lg border border-dashed border-black/10 bg-white p-5 text-sm text-black/55 shadow-sm">
              No Planner Runs yet. Create a Planner Run, review recommendations, then Outcomes will show run-level value.
            </section>
          )}
        </div>
      </div>
    );
  }

  function escalationsView() {
    const priorityWeight: Record<Recommendation["priority"], number> = { critical: 4, high: 3, medium: 2, low: 1 };
    const items = state.accounts
      .flatMap((item) => {
        const generated = intelligenceByAccount.get(item.id);
        return (generated?.escalations ?? []).map((escalation) => ({ account: item, escalation }));
      })
      .sort((a, b) => priorityWeight[b.escalation.priority] - priorityWeight[a.escalation.priority]);

    return (
      <div className="space-y-4">
        <section className="rounded-lg border border-black/10 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase text-rose-700">Escalation Radar</p>
              <h2 className="mt-1 text-2xl font-semibold tracking-normal">Who needs to be contacted, why, and by when.</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-black/58">
                Generated from company memory and current recommendations. Use this when the next best action depends on a CFO, technical
                owner, safety owner, compliance lead, or hiring manager.
              </p>
            </div>
            <button
              onClick={refreshIntelligence}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-black/10 px-4 text-sm font-semibold hover:bg-black/5"
            >
              {isIntelligenceLoading ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
              Refresh radar
            </button>
          </div>
        </section>

        <div className="grid gap-3 xl:grid-cols-3">
          {items.map(({ account: target, escalation }, escalationIndex) => (
            <article
              key={`${target.id}-${escalation.title}-${escalationIndex}`}
              className="flex h-full flex-col rounded-lg border border-black/10 bg-white p-4 shadow-sm"
            >
              <div className="flex min-h-[84px] items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase text-black/42">{target.name}</p>
                  <h3 className="mt-2 text-lg font-semibold leading-6 tracking-normal">{escalation.title}</h3>
                </div>
                <span className={`rounded-md border px-2 py-1 text-xs font-semibold ${priorityClass[escalation.priority]}`}>
                  {escalation.priority}
                </span>
              </div>
              <div className="mt-4 grid gap-2 text-sm">
                <div className="rounded-md bg-[#f7f6f3] p-3">
                  <p className="text-xs font-semibold uppercase text-black/42">Owner</p>
                  <p className="mt-1 font-semibold">{escalation.owner}</p>
                  <p className="mt-1 text-xs text-black/50">{escalation.role}</p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-md bg-[#f7f6f3] p-3">
                    <p className="text-xs font-semibold uppercase text-black/42">Deadline</p>
                    <p className="mt-1 font-semibold">{escalation.deadline}</p>
                  </div>
                  <div className="rounded-md bg-[#f7f6f3] p-3">
                    <p className="text-xs font-semibold uppercase text-black/42">Channel</p>
                    <p className="mt-1 font-semibold">{escalation.channel}</p>
                  </div>
                </div>
              </div>
              <p className="mt-4 text-sm leading-6 text-black/62">{escalation.reason}</p>
              <div className="mt-4 flex-1">
                <p className="text-xs font-semibold uppercase text-black/42">Evidence</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {escalation.evidence.map((evidence, evidenceIndex) => (
                    <span
                      key={`${target.id}-${escalationIndex}-evidence-${evidenceIndex}`}
                      className="rounded-md bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700 ring-1 ring-indigo-100"
                    >
                      {evidence}
                    </span>
                  ))}
                </div>
              </div>
              <div className="mt-auto grid grid-cols-2 gap-2 pt-4">
                <button
                  onClick={() => openAccountView(target, "dashboard")}
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-black px-3 text-sm font-semibold text-white hover:bg-black/85"
                >
                  Open account
                </button>
                <button
                  onClick={() => openAccountView(target, "execution")}
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-black/10 px-3 text-sm font-semibold hover:bg-black/5"
                >
                  Execution
                </button>
              </div>
            </article>
          ))}
          {!items.length && (
            <section className="rounded-lg border border-dashed border-black/10 bg-white p-5 text-sm text-black/55 shadow-sm xl:col-span-3">
              {isIntelligenceLoading ? "Generating escalation radar from memory..." : "No escalations generated yet. Add memory or run the planner."}
            </section>
          )}
        </div>
      </div>
    );
  }

  function blueprintStudioView() {
    const selectedBlueprint = domainBlueprints.find((item) => item.id === selectedBlueprintId) ?? domainBlueprints[0];
    const columns: Array<[string, string[]]> = [
      ["Source types", selectedBlueprint.sourceTypes],
      ["Agents enabled", selectedBlueprint.agents],
      ["Business rules", selectedBlueprint.businessRules],
      ["Memory types", selectedBlueprint.memoryTypes],
      ["Success metrics", selectedBlueprint.successMetrics],
      ["Recommendation categories", selectedBlueprint.recommendationCategories],
    ];
    const activeBuilderStep = blueprintBuilderSteps[builderStep];
    const isReviewStep = builderSuggestion && builderStep >= blueprintBuilderSteps.length;

    return (
      <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <section className="rounded-lg border border-black/10 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2">
            <FolderOpen size={18} className="text-indigo-600" />
            <h2 className="text-lg font-semibold tracking-normal">Domain Blueprint Studio</h2>
          </div>
          <p className="mt-2 text-sm leading-6 text-black/55">
            Pick a domain to see how the same planner, memory, retrieval, and recommendation architecture is configured without rebuilding the
            product.
          </p>
          <button
            onClick={() => {
              setBuilderOpen(true);
              resetBuilder();
            }}
            className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-black px-4 text-sm font-semibold text-white hover:bg-black/85"
          >
            <Sparkles size={16} />
            Build New Account
          </button>
          <div className="mt-4 space-y-2">
            {domainBlueprints.map((blueprint) => (
              <button
                key={blueprint.id}
                onClick={() => {
                  setSelectedBlueprintId(blueprint.id);
                  setBuilderOpen(false);
                }}
                className={`w-full rounded-lg border p-3 text-left transition ${
                  selectedBlueprint.id === blueprint.id
                    ? "border-indigo-200 bg-indigo-50 text-indigo-900"
                    : "border-black/10 bg-[#fbfaf8] hover:bg-black/[0.035]"
                }`}
              >
                <p className="text-sm font-semibold">{blueprint.title}</p>
                <p className="mt-1 line-clamp-2 text-xs leading-5 text-black/55">{blueprint.description}</p>
              </button>
            ))}
          </div>
        </section>

        {!builderOpen && (
          <section className="rounded-lg border border-black/10 bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase text-indigo-700">Reusable configuration</p>
                <h2 className="mt-1 text-2xl font-semibold tracking-normal">{selectedBlueprint.title}</h2>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-black/58">{selectedBlueprint.description}</p>
              </div>
              <span className="rounded-md bg-black px-3 py-2 text-xs font-semibold text-white">Single backend workflow</span>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {columns.map(([title, values]) => (
                <div key={title} className="rounded-lg border border-black/10 bg-[#fbfaf8] p-4">
                  <p className="text-xs font-semibold uppercase text-black/42">{title}</p>
                  <div className="mt-3 space-y-2">
                    {values.map((value) => (
                      <div key={value} className="flex gap-2 rounded-md bg-white p-2 text-sm leading-5 text-black/68 ring-1 ring-black/8">
                        <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-600" />
                        <span>{value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {builderOpen && (
          <section className="rounded-lg border border-black/10 bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase text-indigo-700">New account builder</p>
                <h2 className="mt-1 text-2xl font-semibold tracking-normal">Create a reusable account configuration.</h2>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-black/58">
                  Describe the account once. Flow360 suggests one configuration card at a time, you approve the choices, then it creates the account
                  and stores the first operating brief in memory.
                </p>
              </div>
              <button
                onClick={() => {
                  setBuilderOpen(false);
                  resetBuilder();
                }}
                className="inline-flex h-9 items-center justify-center rounded-md border border-black/10 px-3 text-sm font-semibold hover:bg-black/5"
              >
                Close builder
              </button>
            </div>

            <div className="mt-4 rounded-lg border border-black/10 bg-[#fbfaf8] p-3">
              <div className="flex flex-wrap items-center gap-2">
                {["Describe", ...blueprintBuilderSteps.map((step) => step.label), "Create"].map((label, index) => {
                  const active = index === 0 ? builderStep < 0 : index - 1 === builderStep || (isReviewStep && index === blueprintBuilderSteps.length + 1);
                  const done = index === 0 ? !!builderSuggestion : builderStep > index - 1;
                  return (
                    <span
                      key={label}
                      className={`rounded-md px-2 py-1 text-xs font-semibold ${
                        active
                          ? "bg-black text-white"
                          : done
                            ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100"
                            : "bg-white text-black/45 ring-1 ring-black/8"
                      }`}
                    >
                      {label}
                    </span>
                  );
                })}
              </div>
            </div>

            {builderStep < 0 && (
              <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_320px]">
                <div className="rounded-lg border border-black/10 bg-white p-4">
                  <label className="text-sm font-semibold">Describe the account in normal language</label>
                  <textarea
                    value={builderText}
                    onChange={(event) => setBuilderText(event.target.value)}
                    placeholder="Example: An enterprise logistics company manages cold-chain shipments for pharma clients across India. They handle fleet dispatch, temperature incidents, customer escalations, route delays, warehouse SLAs, and renewal risk with large hospital suppliers."
                    className="mt-3 min-h-[180px] w-full resize-none rounded-lg border border-black/10 bg-[#fbfaf8] p-3 text-sm leading-6 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                  />
                  <button
                    onClick={generateBlueprintBuilder}
                    className="mt-3 inline-flex h-10 items-center justify-center gap-2 rounded-md bg-black px-4 text-sm font-semibold text-white hover:bg-black/85"
                  >
                    {isSuggestingBlueprint ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                    Generate options
                  </button>
                </div>
                <div className="rounded-lg border border-black/10 bg-[#111111] p-4 text-white">
                  <p className="text-xs font-semibold uppercase text-cyan-300">Base blueprint</p>
                  <h3 className="mt-2 text-lg font-semibold">{selectedBlueprint.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-white/58">{selectedBlueprint.description}</p>
                </div>
              </div>
            )}

            {builderSuggestion && activeBuilderStep && (
              <div className="mt-4 rounded-lg border border-black/10 bg-white p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase text-indigo-700">
                      Step {builderStep + 1} of {blueprintBuilderSteps.length}
                    </p>
                    <h3 className="mt-1 text-xl font-semibold tracking-normal">{activeBuilderStep.label}</h3>
                    <p className="mt-2 text-sm leading-6 text-black/55">{activeBuilderStep.helper}</p>
                  </div>
                  <span className="rounded-md bg-[#f7f6f3] px-3 py-2 text-xs font-semibold text-black/55">
                    {builderSelections[activeBuilderStep.key].length} selected
                  </span>
                </div>

                <div className="mt-4 grid gap-2 md:grid-cols-2">
                  {builderSuggestion.options[activeBuilderStep.key].map((option) => {
                    const selected = builderSelections[activeBuilderStep.key].includes(option);
                    return (
                      <button
                        key={option}
                        onClick={() => toggleBuilderOption(activeBuilderStep.key, option)}
                        className={`rounded-lg border p-3 text-left text-sm font-medium leading-6 transition ${
                          selected
                            ? "border-indigo-200 bg-indigo-50 text-indigo-900"
                            : "border-black/10 bg-[#fbfaf8] text-black/62 hover:bg-black/[0.035]"
                        }`}
                      >
                        {option}
                      </button>
                    );
                  })}
                </div>

                <div className="mt-4 rounded-lg border border-dashed border-black/10 bg-[#fbfaf8] p-3">
                  <p className="text-sm font-semibold">Need another option?</p>
                  <div className="mt-2 grid gap-2 md:grid-cols-[1fr_160px]">
                    <input
                      value={builderCustomPrompt[activeBuilderStep.key]}
                      onChange={(event) =>
                        setBuilderCustomPrompt((current) => ({ ...current, [activeBuilderStep.key]: event.target.value }))
                      }
                      placeholder="Ask AI to add options, e.g. include vendor risk or compliance audits"
                      className="h-10 rounded-md border border-black/10 bg-white px-3 text-sm outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                    />
                    <button
                      onClick={() => addBlueprintOptions(activeBuilderStep.key)}
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-black/10 bg-white px-3 text-sm font-semibold hover:bg-black/5"
                    >
                      {isAddingBlueprintOption ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                      Add options
                    </button>
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between gap-2">
                  <button
                    onClick={() => setBuilderStep((value) => Math.max(-1, value - 1))}
                    className="inline-flex h-10 items-center justify-center rounded-md border border-black/10 px-4 text-sm font-semibold hover:bg-black/5"
                  >
                    Back
                  </button>
                  <button
                    onClick={() => setBuilderStep((value) => value + 1)}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-black px-4 text-sm font-semibold text-white hover:bg-black/85"
                  >
                    Next
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            )}

            {builderSuggestion && isReviewStep && (
              <div className="mt-4 grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
                <div className="rounded-lg border border-black/10 bg-[#fbfaf8] p-4">
                  <p className="text-xs font-semibold uppercase text-indigo-700">Account draft</p>
                  {[
                    ["name", "Account name"],
                    ["segment", "Segment"],
                    ["primary_user", "Primary user"],
                  ].map(([key, label]) => (
                    <label key={key} className="mt-3 block text-xs font-semibold uppercase text-black/42">
                      {label}
                      <input
                        value={String(builderSuggestion.account[key as keyof BlueprintAccountDraft] ?? "")}
                        onChange={(event) => updateBuilderDraft({ [key]: event.target.value } as Partial<BlueprintAccountDraft>)}
                        className="mt-1 h-9 w-full rounded-md border border-black/10 bg-white px-3 text-sm normal-case text-black outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                      />
                    </label>
                  ))}
                  <label className="mt-3 block text-xs font-semibold uppercase text-black/42">
                    Description
                    <textarea
                      value={builderSuggestion.account.description}
                      onChange={(event) => updateBuilderDraft({ description: event.target.value })}
                      className="mt-1 min-h-[110px] w-full resize-none rounded-md border border-black/10 bg-white p-3 text-sm normal-case leading-6 text-black outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                    />
                  </label>
                  <label className="mt-3 flex items-center gap-2 text-sm font-medium">
                    <input
                      type="checkbox"
                      checked={builderSuggestion.account.supports_candidates}
                      onChange={(event) => updateBuilderDraft({ supports_candidates: event.target.checked })}
                    />
                    Needs candidate/BGV workflow
                  </label>
                </div>

                <div className="rounded-lg border border-black/10 bg-white p-4">
                  <p className="text-xs font-semibold uppercase text-indigo-700">Review selected configuration</p>
                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    {blueprintBuilderSteps.map((step) => (
                      <div key={step.key} className="rounded-lg border border-black/10 bg-[#fbfaf8] p-3">
                        <p className="text-xs font-semibold uppercase text-black/42">{step.label}</p>
                        <p className="mt-2 text-sm font-semibold">{builderSelections[step.key].length} selected</p>
                        <p className="mt-1 line-clamp-2 text-xs leading-5 text-black/50">{builderSelections[step.key].join(", ")}</p>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 flex items-center justify-between gap-2">
                    <button
                      onClick={() => setBuilderStep(blueprintBuilderSteps.length - 1)}
                      className="inline-flex h-10 items-center justify-center rounded-md border border-black/10 px-4 text-sm font-semibold hover:bg-black/5"
                    >
                      Back
                    </button>
                    <button
                      onClick={createAccountFromBuilder}
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-black px-4 text-sm font-semibold text-white hover:bg-black/85"
                    >
                      {isCreatingBlueprintAccount ? <Loader2 size={16} className="animate-spin" /> : <Building2 size={16} />}
                      Create account
                    </button>
                  </div>
                </div>
              </div>
            )}

            {builderStatus && <p className="mt-3 rounded-md bg-[#f7f6f3] p-3 text-sm text-black/62">{builderStatus}</p>}
          </section>
        )}
      </div>
    );
  }

  function todayView() {
    const workspaceStates = state.accounts.map(
      (item) =>
        dailyStates[item.id] ?? {
          ...initialDashboardState,
          accounts: state.accounts,
          account: item,
          recommendations: [],
          memory: [],
          sources: emptySources(),
          candidates: [],
          metrics: item.metrics,
          riskTrend: item.risk_trend,
          initialInteraction: item.description,
          mode: state.mode,
        },
    );
    const briefs = workspaceStates
      .map(buildDailyBrief)
      .sort((a, b) => b.score - a.score);
    const topBrief = briefs[0];
    const pendingApprovalItems = plannerRuns.flatMap((plannerRun) =>
      plannerRun.recommendations
        .filter((recommendation) => recommendation.status === "pending")
        .map((recommendation) => ({ plannerRun, recommendation })),
    );
    const pendingPlannerRuns = plannerRuns.filter(
      (plannerRun) =>
        plannerRun.recommendations.some((recommendation) => recommendation.status === "pending") ||
        /pending|queued|running|review/i.test(plannerRun.status),
    );
    const recentPlannerRuns = [...plannerRuns].sort(
      (a, b) => (Date.parse(b.created_at ?? "") || 0) - (Date.parse(a.created_at ?? "") || 0),
    );
    const sourceTotals: Record<SourceCollection, number> = { crm: 0, interactions: 0, knowledge: 0, risks: 0, candidates: 0 };
    workspaceStates.forEach((item) => {
      Object.entries(item.sources ?? emptySources()).forEach(([collection, entries]) => {
        sourceTotals[collection as SourceCollection] += entries.length;
      });
    });
    const totalSources = Object.values(sourceTotals).reduce((total, count) => total + count, 0);
    const totalMemory = workspaceStates.reduce((total, item) => total + item.memory.length, 0);
    const sourceGapCount = briefs.filter((brief) => !brief.missing.startsWith("No major")).length;
    const memoryHealth =
      totalMemory >= Math.max(3, briefs.length * 3) && sourceGapCount === 0
        ? "Healthy"
        : totalMemory > 0
          ? "Needs refresh"
          : "Needs memory";
    const companyName = session?.account.name ?? account.name;
    const strategyLevel = strategyProfile?.personalization_level ?? "learning";
    const strategyGuidance = strategyProfile?.next_planner_guidance?.slice(0, 4) ?? [];

    return (
      <div className="space-y-4">
        <section className="overflow-hidden rounded-lg border border-black/10 bg-[#101319] text-white shadow-sm">
          <div
            className="relative p-5 md:p-6"
            style={{
              backgroundImage:
                "radial-gradient(circle at 16% 0%, rgba(34,211,238,0.2), transparent 30%), radial-gradient(circle at 88% 12%, rgba(99,102,241,0.22), transparent 28%), linear-gradient(135deg, rgba(255,255,255,0.08), transparent)",
            }}
          >
            <div className="relative z-10 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase text-cyan-200">Workspace Command Center</p>
                <h2 className="mt-2 max-w-3xl text-3xl font-semibold tracking-normal md:text-4xl">
                  What needs {possessiveName(companyName)} attention today?
                </h2>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-white/62">
                  A single company workspace view for pending Planner Runs, approval decisions, memory risks, source gaps, and the next recommended action.
                </p>
              </div>
              <button
                onClick={() => topBrief && openAccountView(topBrief.account, topBrief.nextView)}
                disabled={!topBrief}
                className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-md bg-white px-4 text-sm font-semibold text-black hover:bg-white/90"
              >
                Open next action
                <ChevronRight size={17} />
              </button>
            </div>
            <div className="relative z-10 mt-6 grid gap-3 md:grid-cols-4">
              {[
                ["Pending Planner Runs", String(pendingPlannerRuns.length), pendingPlannerRuns.length ? "need review or completion" : "none waiting"],
                ["Pending approvals", String(pendingApprovalItems.length), "human decisions queued"],
                ["AI strategy", titleCase(strategyLevel), `${strategyProfile?.approved_count ?? 0} approved, ${strategyProfile?.rejected_count ?? 0} rejected`],
                ["Source data gaps", String(sourceGapCount), "areas reducing confidence"],
              ].map(([label, value, detail]) => (
                <div key={label} className="rounded-lg border border-white/10 bg-white/[0.07] p-4 backdrop-blur">
                  <p className="text-xs font-medium uppercase text-white/42">{label}</p>
                  <p className="mt-2 text-2xl font-semibold">{value}</p>
                  <p className="mt-1 text-xs text-white/46">{detail}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <section className="space-y-3">
            {briefs.map((brief, index) => {
              const generated = intelligenceByAccount.get(brief.account.id);
              const topEscalation = generated?.escalations[0];
              const latestRun = recentPlannerRuns.find((plannerRun) => plannerRun.account_id === brief.account.id);
              const focusPendingApprovals = pendingApprovalItems.filter((item) => item.plannerRun.account_id === brief.account.id);
              return (
              <article key={brief.account.id} className="rounded-lg border border-black/10 bg-white p-4 shadow-sm">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="flex h-8 w-8 items-center justify-center rounded-md bg-black text-xs font-bold text-white">
                        {index + 1}
                      </span>
                      <p className="text-xs font-semibold uppercase text-indigo-700">{brief.account.segment}</p>
                      <span
                        className={`rounded-md border px-2 py-1 text-xs font-semibold ${
                          brief.level === "Critical"
                            ? "border-rose-200 bg-rose-50 text-rose-700"
                            : brief.level === "High"
                              ? "border-amber-200 bg-amber-50 text-amber-700"
                              : brief.level === "Watch"
                                ? "border-sky-200 bg-sky-50 text-sky-700"
                                : "border-emerald-200 bg-emerald-50 text-emerald-700"
                        }`}
                      >
                        {brief.level}
                      </span>
                    </div>
                    <h3 className="mt-3 text-xl font-semibold tracking-normal">{brief.actionTitle}</h3>
                    <p className="mt-2 text-sm leading-6 text-black/60">{brief.account.name}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <div className="text-right">
                      <p className="text-xs font-semibold uppercase text-black/42">Attention score</p>
                      <p className="text-3xl font-semibold">{brief.score}</p>
                    </div>
                    <button
                      onClick={() => openAccountView(brief.account, brief.nextView)}
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-black px-3 text-sm font-semibold text-white hover:bg-black/85"
                    >
                      {brief.nextLabel}
                      <ChevronRight size={16} />
                    </button>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 lg:grid-cols-3">
                  <div className="rounded-md bg-[#f7f6f3] p-3">
                    <p className="text-xs font-semibold uppercase text-black/42">Risk detected from memory</p>
                    <p className="mt-2 text-sm leading-6 text-black/65">{brief.reason}</p>
                  </div>
                  <div className="rounded-md bg-[#f7f6f3] p-3">
                    <p className="text-xs font-semibold uppercase text-black/42">Recent Planner Run</p>
                    <p className="mt-2 text-sm leading-6 text-black/65">
                      {latestRun
                        ? `${latestRun.title || latestRun.objective} - ${latestRun.recommendations.length} recommendations`
                        : brief.changed}
                    </p>
                  </div>
                  <div className="rounded-md bg-[#f7f6f3] p-3">
                    <p className="text-xs font-semibold uppercase text-black/42">Source data gaps</p>
                    <p className="mt-2 text-sm leading-6 text-black/65">{brief.missing}</p>
                  </div>
                </div>

                {focusPendingApprovals.length > 0 && (
                  <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3">
                    <p className="text-xs font-semibold uppercase text-amber-700">Pending approvals</p>
                    <p className="mt-2 text-sm leading-6 text-amber-900">
                      {focusPendingApprovals
                        .slice(0, 2)
                        .map((item) => item.recommendation.title)
                        .join("; ")}
                    </p>
                  </div>
                )}

                {(generated || topEscalation) && (
                  <div className="mt-3 grid gap-3 lg:grid-cols-2">
                    <div className="rounded-md border border-emerald-100 bg-emerald-50 p-3">
                      <p className="text-xs font-semibold uppercase text-emerald-700">Projected outcome</p>
                      <p className="mt-2 text-sm leading-6 text-emerald-900">
                        {generated?.outcomes.projected_impact ?? "Generate outcomes from memory to view impact."}
                      </p>
                    </div>
                    <div className="rounded-md border border-rose-100 bg-rose-50 p-3">
                      <p className="text-xs font-semibold uppercase text-rose-700">Escalation radar</p>
                      <p className="mt-2 text-sm leading-6 text-rose-900">
                        {topEscalation
                          ? `${topEscalation.owner} - ${topEscalation.deadline}: ${topEscalation.title}`
                          : "No escalation generated yet."}
                      </p>
                    </div>
                  </div>
                )}

                <div className="mt-3 flex flex-wrap gap-2">
                  {brief.signals.map((signal) => (
                    <span key={signal} className="rounded-md bg-white px-2 py-1 text-xs font-medium text-black/55 ring-1 ring-black/8">
                      {signal}
                    </span>
                  ))}
                </div>
              </article>
              );
            })}
          </section>

          <aside className="space-y-3">
            <section className="rounded-lg border border-indigo-100 bg-indigo-50 p-4 shadow-sm">
              <div className="flex items-center gap-2">
                <BrainCircuit size={18} className="text-indigo-700" />
                <h2 className="text-lg font-semibold tracking-normal">AI Strategy Profile</h2>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {[
                  ["Level", titleCase(strategyLevel)],
                  ["Approved", String(strategyProfile?.approved_count ?? 0)],
                  ["Rejected", String(strategyProfile?.rejected_count ?? 0)],
                  ["Signals", String(strategyGuidance.length)],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-md bg-white p-3 ring-1 ring-indigo-100">
                    <p className="text-xs font-semibold uppercase text-black/42">{label}</p>
                    <p className="mt-1 font-semibold text-black/75">{value}</p>
                  </div>
                ))}
              </div>
              <div className="mt-3 space-y-2">
                {strategyGuidance.map((item) => (
                  <p key={item} className="rounded-md bg-white p-3 text-sm leading-5 text-black/62 ring-1 ring-indigo-100">
                    {item}
                  </p>
                ))}
                {!strategyGuidance.length && (
                  <div className="rounded-md border border-dashed border-indigo-200 bg-white/70 p-3 text-sm leading-6 text-black/55">
                    Approve or reject Planner recommendations to teach Flow360 which plans, owners, evidence, and categories this workspace prefers.
                  </div>
                )}
              </div>
            </section>

            <section className="rounded-lg border border-black/10 bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2">
                <Sparkles size={18} className="text-indigo-600" />
                <h2 className="text-lg font-semibold tracking-normal">Next Recommended Actions</h2>
              </div>
              <div className="mt-3 space-y-2">
                {briefs.slice(0, 4).map((brief) => (
                  <button
                    key={brief.account.id}
                    onClick={() => openAccountView(brief.account, brief.nextView)}
                    className="flex w-full items-center justify-between gap-3 rounded-md border border-black/10 bg-[#fbfaf8] p-3 text-left hover:bg-black/[0.035]"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">{brief.account.name}</span>
                      <span className="mt-1 block truncate text-xs text-black/52">{brief.nextLabel}</span>
                    </span>
                    <ChevronRight size={16} className="shrink-0 text-black/38" />
                  </button>
                ))}
              </div>
            </section>

            <section className="rounded-lg border border-black/10 bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2">
                <Check size={18} className="text-amber-600" />
                <h2 className="text-lg font-semibold tracking-normal">Pending Approvals</h2>
              </div>
              <div className="mt-3 space-y-2">
                {pendingApprovalItems.slice(0, 4).map(({ plannerRun, recommendation }) => (
                  <button
                    key={`${plannerRun.id}-${recommendation.id}`}
                    onClick={() => {
                      setSelectedPlannerRunId(plannerRun.id);
                      setSelected(recommendation);
                      openAccountView(
                        state.accounts.find((item) => item.id === plannerRun.account_id) ?? account,
                        "dashboard",
                      );
                    }}
                    className="w-full rounded-md border border-black/10 bg-[#fbfaf8] p-3 text-left hover:bg-black/[0.035]"
                  >
                    <span className="block truncate text-sm font-semibold">{recommendation.title}</span>
                    <span className="mt-1 block truncate text-xs text-black/52">{plannerRun.title || plannerRun.objective}</span>
                  </button>
                ))}
                {!pendingApprovalItems.length && (
                  <div className="rounded-md border border-dashed border-black/12 bg-[#fbfaf8] p-3 text-sm text-black/55">
                    No approval decisions are waiting.
                  </div>
                )}
              </div>
            </section>

            <section className="rounded-lg border border-black/10 bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2">
                <History size={18} className="text-indigo-600" />
                <h2 className="text-lg font-semibold tracking-normal">Recent Planner Runs</h2>
              </div>
              <div className="mt-3 space-y-2">
                {recentPlannerRuns.slice(0, 3).map((plannerRun) => (
                  <button
                    key={plannerRun.id}
                    onClick={() => {
                      setSelectedPlannerRunId(plannerRun.id);
                      setActiveView("planner_history");
                    }}
                    className="w-full rounded-md border border-black/10 bg-[#fbfaf8] p-3 text-left hover:bg-black/[0.035]"
                  >
                    <span className="block truncate text-sm font-semibold">{plannerRun.title || plannerRun.objective}</span>
                    <span className="mt-1 block truncate text-xs text-black/52">
                      {plannerRun.created_at ? new Date(plannerRun.created_at).toLocaleString() : "No timestamp"}
                    </span>
                  </button>
                ))}
                {!recentPlannerRuns.length && (
                  <div className="rounded-md border border-dashed border-black/12 bg-[#fbfaf8] p-3 text-sm text-black/55">
                    No Planner Runs yet.
                  </div>
                )}
              </div>
            </section>

            <section className="rounded-lg border border-black/10 bg-[#111111] p-4 text-white shadow-sm">
              <div className="flex items-center gap-2">
                <Activity size={18} className="text-cyan-300" />
                <h2 className="text-lg font-semibold tracking-normal">Memory and Source Health</h2>
              </div>
              <div className="mt-3 space-y-3 text-sm leading-6 text-white/62">
                <p>{memoryHealth}: {totalMemory} memory cards and {totalSources} source entries are available for this workspace.</p>
                <p>Source coverage: CRM {sourceTotals.crm}, interactions {sourceTotals.interactions}, knowledge {sourceTotals.knowledge}, risks {sourceTotals.risks}, candidates {sourceTotals.candidates}.</p>
                <p>Flow360 uses company memory, approval state, source freshness, and current blockers to choose the next recommended action.</p>
              </div>
            </section>
          </aside>
        </div>
      </div>
    );
  }

  function accountCards() {
    return (
      <div className="grid gap-4 xl:grid-cols-3">
        {state.accounts.map((item) => (
          <button
            key={item.id}
            onClick={() => chooseAccount(item)}
            className={`rounded-lg border bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${
              item.id === account.id ? "border-indigo-300 ring-2 ring-indigo-100" : "border-black/10"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase text-indigo-700">{item.segment}</p>
                <h2 className="mt-2 text-xl font-semibold tracking-normal">{item.name}</h2>
              </div>
              <span className="rounded-md bg-black px-2 py-1 text-xs font-semibold text-white">{item.health}</span>
            </div>
            <p className="mt-4 text-sm leading-6 text-black/60">{item.description}</p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              {item.metrics.slice(0, 4).map((metric) => (
                <div key={metric.label} className="rounded-md bg-[#f7f6f3] p-3">
                  <p className="text-xs text-black/45">{metric.label}</p>
                  <p className="mt-1 font-semibold">{metric.value}</p>
                </div>
              ))}
            </div>
          </button>
        ))}
      </div>
    );
  }

  function recommendationInbox() {
    return (
      <section className="rounded-lg border border-black/10 bg-white p-4 shadow-sm">
        {activeRunCase && (
          <div className="mb-4 rounded-lg border border-indigo-100 bg-indigo-50/70 p-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase text-indigo-700">Planner Run Context</p>
                <h3 className="mt-1 truncate text-base font-semibold tracking-normal text-black">{activeRunCase.objective}</h3>
                {activeRunCase.intake_text && (
                  <p className="mt-2 line-clamp-3 text-sm leading-6 text-black/62">{activeRunCase.intake_text}</p>
                )}
              </div>
              <div className="flex shrink-0 flex-col gap-2 text-xs text-black/55 sm:flex-row lg:flex-col lg:items-end">
                <span className="rounded-md bg-white px-2 py-1 ring-1 ring-indigo-100">{activeRunCase.id}</span>
                <button
                  onClick={() => {
                    setSelectedPlannerRunId(activeRunCase.id);
                    setActiveView("planner_history");
                  }}
                  className="inline-flex h-8 items-center justify-center rounded-md border border-indigo-200 bg-white px-3 font-semibold text-indigo-700 hover:bg-indigo-50"
                >
                  Open full run
                </button>
              </div>
            </div>
          </div>
        )}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold tracking-normal">Recommendation Inbox</h2>
            <p className="text-sm text-black/55">{recommendations.length} ranked actions for {account.name}</p>
          </div>
          <span className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
            Human review required
          </span>
        </div>
        <div className="mt-4 divide-y divide-black/8">
          {recommendations.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                setSelected(item);
                setReviewStatus("");
              }}
              className={`grid w-full gap-3 py-4 text-left transition sm:grid-cols-[1fr_24px] sm:items-center ${
                activeSelected?.id === item.id ? "bg-indigo-50/70 px-3" : "hover:bg-black/[0.025]"
              }`}
            >
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold leading-6 tracking-normal text-black">{item.title}</h3>
                  <span className={`rounded-md border px-2 py-1 text-xs font-semibold ${priorityClass[item.priority]}`}>
                    {item.priority}
                  </span>
                  <span className="rounded-md bg-white px-2 py-1 text-xs font-medium text-black/50 ring-1 ring-black/8">
                    {item.status}
                  </span>
                </div>
                <p className="mt-2 line-clamp-2 text-sm leading-6 text-black/58">{item.action}</p>
              </div>
              <ChevronRight size={18} className="hidden text-black/38 md:block" />
            </button>
          ))}
          {!recommendations.length && (
            <div className="rounded-lg bg-[#f7f6f3] p-5 text-sm text-black/58">
              No recommendations yet. Add source context or click Run Planner.
            </div>
          )}
        </div>
      </section>
    );
  }

  function plannerOutputSummary() {
    if (!run || run.account_id !== account.id) return null;
    const risks = Array.isArray(run.analysis.risks) ? run.analysis.risks.slice(0, 3) : [];
    const opportunities = Array.isArray(run.analysis.opportunities) ? run.analysis.opportunities.slice(0, 2) : [];
    return (
      <section className="rounded-lg border border-indigo-100 bg-indigo-50/60 p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase text-indigo-700">Planner output</p>
            <h2 className="mt-1 text-lg font-semibold tracking-normal">{run.title || run.objective}</h2>
            <p className="mt-2 text-sm leading-6 text-black/62">{run.objective}</p>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4 lg:min-w-[520px]">
            {[
              ["Run", run.run_id || "saved"],
              ["Evidence", `${run.retrieved_context.length} sources`],
              ["Actions", `${run.recommendations.length} recommendations`],
              ["Trace", `${run.agent_trace.length} steps`],
            ].map(([label, value]) => (
              <div key={label} className="rounded-md bg-white px-3 py-2 ring-1 ring-indigo-100">
                <p className="text-xs font-semibold uppercase text-black/42">{label}</p>
                <p className="mt-1 truncate font-medium text-black/75">{value}</p>
              </div>
            ))}
          </div>
        </div>
        {(risks.length > 0 || opportunities.length > 0) && (
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {risks.length > 0 && (
              <div className="rounded-md bg-white p-3 ring-1 ring-indigo-100">
                <p className="text-xs font-semibold uppercase text-black/42">Analysis risks</p>
                <ul className="mt-2 space-y-1 text-sm leading-5 text-black/62">
                  {risks.map((item, index) => (
                    <li key={`risk-${index}`}>{String(item)}</li>
                  ))}
                </ul>
              </div>
            )}
            {opportunities.length > 0 && (
              <div className="rounded-md bg-white p-3 ring-1 ring-indigo-100">
                <p className="text-xs font-semibold uppercase text-black/42">Opportunities</p>
                <ul className="mt-2 space-y-1 text-sm leading-5 text-black/62">
                  {opportunities.map((item, index) => (
                    <li key={`opportunity-${index}`}>{String(item)}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </section>
    );
  }

  function selectedAction() {
    if (!activeSelected) {
      return (
        <section className="rounded-lg border border-black/10 bg-white p-4 shadow-sm">
          <h2 className="text-lg font-semibold">No selected action</h2>
          <p className="mt-2 text-sm text-black/55">Run the planner to generate account-specific next best actions.</p>
        </section>
      );
    }
    const isReviewing = reviewingId === activeSelected.id;
    const reviewedAlready = activeSelected.status !== "pending";
    return (
      <section className="rounded-lg border border-black/10 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase text-black/45">Selected Action</p>
            <h2 className="mt-2 text-xl font-semibold tracking-normal">{activeSelected.title}</h2>
          </div>
          <span className="rounded-md bg-black px-3 py-1 text-sm font-semibold text-white">{confidenceLabel(activeSelected.confidence)}</span>
        </div>
        <div className="mt-4 rounded-md bg-[#f7f6f3] p-3">
          <p className="text-xs font-semibold uppercase text-black/42">Recommended action</p>
          <p className="mt-1 text-sm leading-6 text-black/70">{activeSelected.action}</p>
        </div>
        {activeRunCase && (
          <div className="mt-4 rounded-md border border-indigo-100 bg-indigo-50/60 p-3">
            <p className="text-xs font-semibold uppercase text-indigo-700">For planner intake</p>
            <p className="mt-1 text-sm font-semibold leading-5 text-black/78">{activeRunCase.objective}</p>
            {activeRunCase.intake_text && (
              <p className="mt-2 line-clamp-4 text-sm leading-5 text-black/62">{activeRunCase.intake_text}</p>
            )}
          </div>
        )}
        <p className="mt-4 text-sm leading-6 text-black/64">{activeSelected.rationale}</p>
        <div className="mt-4 rounded-md border border-black/10 p-3">
          <p className="text-xs font-semibold uppercase text-black/42">Supporting evidence</p>
          {activeSelected.evidence.length > 0 ? (
            <ul className="mt-2 space-y-2">
              {activeSelected.evidence.slice(0, 4).map((item) => (
                <li key={`${activeSelected.id}-${item.source_id}`} className="text-sm leading-5 text-black/62">
                  <span className="font-medium text-black/78">{item.source_title}</span>
                  <span className="text-black/40"> · {item.source_type} · {Math.round(item.relevance * 100)}%</span>
                  <p className="mt-1 line-clamp-2">{item.snippet}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-black/50">No linked evidence returned for this recommendation.</p>
          )}
        </div>
        <div className="mt-4 grid gap-2 text-sm">
          <div className="flex items-center justify-between rounded-md bg-[#f7f6f3] px-3 py-2">
            <span className="text-black/48">Owner</span>
            <span className="font-medium">{activeSelected.owner_role}</span>
          </div>
          <div className="flex items-center justify-between rounded-md bg-[#f7f6f3] px-3 py-2">
            <span className="text-black/48">Due</span>
            <span className="font-medium">{activeSelected.due_date}</span>
          </div>
          <div className="rounded-md bg-[#f7f6f3] px-3 py-2">
            <span className="text-black/48">Metric</span>
            <p className="mt-1 font-medium">{activeSelected.business_metric}</p>
          </div>
        </div>
        {reviewStatus && (
          <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
            {reviewStatus}
          </div>
        )}
        <div className="mt-4 flex gap-2">
          <button
            onClick={() => handleReview("approved")}
            disabled={isReviewing || reviewedAlready}
            className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-md bg-emerald-600 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-emerald-300"
          >
            {isReviewing ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
            {activeSelected.status === "approved" ? "Approved" : "Approve"}
          </button>
          <button
            onClick={() => handleReview("rejected")}
            disabled={isReviewing || reviewedAlready}
            className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-md border border-black/10 text-sm font-semibold hover:bg-black/5 disabled:cursor-not-allowed disabled:text-black/35"
          >
            {isReviewing ? <Loader2 size={16} className="animate-spin" /> : <X size={16} />}
            {activeSelected.status === "rejected" ? "Rejected" : "Reject"}
          </button>
        </div>
        {activeExecution && (
          <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
            <p className="font-semibold">Execution artifacts are ready.</p>
            <p className="mt-1">Open action artifacts to copy the email, CRM task, escalation note, SLA update, or summary.</p>
            <button
              onClick={() => setActiveView("execution")}
              className="mt-3 inline-flex h-8 items-center justify-center rounded-md bg-emerald-700 px-3 text-xs font-semibold text-white hover:bg-emerald-800"
            >
              Open action artifacts
            </button>
          </div>
        )}
      </section>
    );
  }

  function executionStudioView() {
    if (!activeSelected) {
      return (
        <section className="rounded-lg border border-black/10 bg-white p-5 shadow-sm">
          <h2 className="text-xl font-semibold tracking-normal">Approved Action Artifacts</h2>
          <p className="mt-2 text-sm leading-6 text-black/58">
            Run the planner or select a recommendation first. Once a recommendation is approved, this panel turns it into practical artifacts.
          </p>
        </section>
      );
    }

    const approved = activeSelected.status === "approved" || !!activeExecution;
    const artifact = artifactFromExecution(activeExecution, activeArtifact) ?? buildArtifactDraft(account, activeSelected, activeArtifact);
    const evidenceTitles =
      activeExecution?.metadata?.evidence_titles ??
      activeSelected.evidence.map((item) => item.source_title).filter(Boolean).slice(0, 4);
    const nextSteps =
      activeExecution?.next_steps ??
      activeExecution?.metadata?.next_steps ?? [
        `Assign ${activeSelected.owner_role}`,
        `Complete by ${activeSelected.due_date}`,
        "Capture the result as reviewed memory",
      ];

    return (
      <div className="grid gap-3 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <section className="rounded-lg border border-black/10 bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase text-indigo-700">Human-in-the-loop</p>
              <h2 className="mt-1 text-xl font-semibold tracking-normal">Approved Action Artifacts</h2>
              <p className="mt-2 text-sm leading-6 text-black/58">
                One approval creates the customer communication, internal task, escalation note, SLA update, and memory writeback.
              </p>
            </div>
            <span className={`rounded-md border px-2 py-1 text-xs font-semibold ${approved ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}>
              {approved ? "Artifacts ready" : "Awaiting approval"}
            </span>
          </div>

          <div className="mt-4 rounded-lg border border-black/10 bg-[#fbfaf8] p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold">{activeSelected.title}</h3>
              <span className={`rounded-md border px-2 py-1 text-xs font-semibold ${priorityClass[activeSelected.priority]}`}>
                {activeSelected.priority}
              </span>
              <span className="rounded-md bg-white px-2 py-1 text-xs font-semibold text-black/55 ring-1 ring-black/8">
                {confidenceLabel(activeSelected.confidence)} confidence
              </span>
            </div>
            <p className="mt-3 text-sm leading-6 text-black/62">{activeSelected.rationale}</p>
            <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2 xl:grid-cols-1">
              <div className="rounded-md bg-white px-3 py-2 ring-1 ring-black/8">
                <span className="text-black/45">Owner</span>
                <p className="font-semibold">{activeSelected.owner_role}</p>
              </div>
              <div className="rounded-md bg-white px-3 py-2 ring-1 ring-black/8">
                <span className="text-black/45">Due</span>
                <p className="font-semibold">{activeSelected.due_date}</p>
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-2">
            {[
              ["1", "Recommendation selected", "A business user chooses the next best action."],
              ["2", "Evidence checked", evidenceTitles.length ? evidenceTitles[0] : "No evidence linked yet."],
              ["3", approved ? "Human approval captured" : "Waiting for approval", approved ? "Decision written back to episodic memory." : "Click approve when the recommendation is correct."],
              ["4", approved ? "Execution artifacts generated" : "Artifact preview prepared", "Email, CRM task, escalation note, SLA update, and summary."],
            ].map(([number, title, detail]) => (
              <div key={number} className="grid grid-cols-[30px_1fr] gap-3 rounded-md border border-black/8 bg-white p-3">
                <span className="flex h-7 w-7 items-center justify-center rounded-md bg-black text-xs font-bold text-white">{number}</span>
                <div>
                  <p className="text-sm font-semibold">{title}</p>
                  <p className="mt-0.5 text-xs leading-5 text-black/52">{detail}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 flex gap-2">
            <button
              onClick={() => handleReview("approved")}
              disabled={activeSelected.status === "approved"}
              className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-md bg-black text-sm font-semibold text-white hover:bg-black/85 disabled:cursor-not-allowed disabled:bg-black/35"
            >
              <Check size={16} />
              {activeSelected.status === "approved" ? "Approved" : "Approve & Generate"}
            </button>
            <button
              onClick={() => handleReview("rejected")}
              disabled={activeSelected.status === "rejected"}
              className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-md border border-black/10 text-sm font-semibold hover:bg-black/5 disabled:cursor-not-allowed disabled:text-black/35"
            >
              <X size={16} />
              {activeSelected.status === "rejected" ? "Rejected" : "Reject"}
            </button>
          </div>
        </section>

        <section className="rounded-lg border border-black/10 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase text-emerald-700">Generated artifacts</p>
              <h2 className="mt-1 text-xl font-semibold tracking-normal">{artifact.title}</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-black/55">
                These drafts are generated from the selected recommendation, evidence, owner, and due date. Copy the one you need and send it
                through the real business system.
              </p>
            </div>
            <button
              onClick={() => copyArtifact(artifact.body)}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-black/10 px-3 text-sm font-semibold hover:bg-black/5"
            >
              <ClipboardList size={15} />
              {copyStatus || "Copy"}
            </button>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {artifactTabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveArtifact(tab.key)}
                  className={`inline-flex h-9 items-center gap-2 rounded-full border px-3 text-sm font-semibold transition ${
                    activeArtifact === tab.key
                      ? "border-black bg-black text-white"
                      : "border-black/10 bg-[#fbfaf8] text-black/68 hover:bg-black/5"
                  }`}
                >
                  <Icon size={15} />
                  {tab.label}
                </button>
              );
            })}
          </div>

          <div className="mt-4 rounded-lg border border-black/10 bg-[#fbfaf8]">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-black/10 px-4 py-3">
              <p className="text-sm font-semibold">{approved ? "Ready after approval" : "Preview before approval"}</p>
              <span className="rounded-md bg-white px-2 py-1 text-xs font-semibold text-black/50 ring-1 ring-black/8">
                {activeSelected.owner_role} - {activeSelected.due_date}
              </span>
            </div>
            <pre className="whitespace-pre-wrap p-4 font-sans text-sm leading-6 text-black/72">{artifact.body}</pre>
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_0.85fr]">
            <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-3">
              <p className="text-sm font-semibold text-emerald-900">Memory writeback</p>
              <p className="mt-2 text-sm leading-6 text-emerald-800">
                {approved
                  ? "This approval is stored as episodic memory, so future recommendations can learn from the human decision."
                  : "Approval will create episodic memory and mark these artifacts as reviewed output."}
              </p>
            </div>
            <div className="rounded-lg border border-black/10 bg-white p-3">
              <p className="text-sm font-semibold">Next steps</p>
              <ul className="mt-2 space-y-1 text-sm leading-6 text-black/60">
                {nextSteps.map((step) => (
                  <li key={step} className="flex gap-2">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-black" />
                    <span>{step}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      </div>
    );
  }

  function dashboardView() {
    return (
      <div className="space-y-4">
        <section className="rounded-lg border border-black/10 bg-white p-4 shadow-sm">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
            <div>
              <div className="flex items-center gap-2">
                <ClipboardList size={18} className="text-indigo-600" />
                <h2 className="text-lg font-semibold tracking-normal">New Planner Run</h2>
              </div>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-black/58">
                Create one persistent business case for a specific objective. Flow360 retrieves company memory, analyzes the context, and
                generates reviewable next best actions with evidence.
              </p>
              <label className="mt-3 block text-sm font-semibold">
                Business objective
                <input
                  value={plannerObjective}
                  onChange={(event) => setPlannerObjective(event.target.value)}
                  className="mt-1 h-10 w-full rounded-md border border-black/10 bg-[#fbfaf8] px-3 text-sm font-normal outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                  placeholder="Customer escalation, hiring delay, renewal risk, SLA issue, pricing approval..."
                />
              </label>
              <label className="mt-3 block text-sm font-semibold">
                Intake and context
              <textarea
                value={interaction}
                onChange={(event) => setInteraction(event.target.value)}
                  className="mt-1 min-h-[132px] w-full resize-none rounded-lg border border-black/10 bg-[#fbfaf8] p-3 text-sm font-normal leading-6 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                  placeholder="Paste the meeting note, email, CRM update, policy reference, or business problem description for this one planner run."
              />
              </label>
              <div className="mt-3 flex flex-wrap gap-2">
                <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-black/10 px-3 text-sm font-semibold hover:bg-black/5">
                  <Upload size={16} />
                  Attach source file
                  <input type="file" className="sr-only" onChange={(event) => handleUpload("interactions", event.target.files?.[0])} />
                </label>
                <button
                  onClick={() => handleRunPlanner(false)}
                  disabled={isRunning || !plannerObjective.trim() || !interaction.trim()}
                  className="inline-flex h-10 items-center gap-2 rounded-md bg-black px-4 text-sm font-semibold text-white hover:bg-black/85 disabled:cursor-not-allowed disabled:bg-black/25"
                >
                  {isRunning ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                  Run Planner
                </button>
                <button
                  onClick={() => handleRunPlanner(true)}
                  disabled={isRunning || !plannerObjective.trim() || !interaction.trim()}
                  className="inline-flex h-10 items-center gap-2 rounded-md border border-black/10 px-4 text-sm font-semibold hover:bg-black/5 disabled:cursor-not-allowed disabled:text-black/35"
                >
                  {isRunning ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                  Run new version
                </button>
              </div>
            </div>
            <div className="grid content-start gap-2 rounded-lg bg-[#f7f6f3] p-3 text-sm">
              {[
                ["Objective", "Stored with the run"],
                ["Evidence", "Retrieved from company memory"],
                ["Trace", "Captured for explainability"],
                ["Review", "Approval or rejection updates memory"],
              ].map(([label, detail]) => (
                <div key={label} className="rounded-md bg-white px-3 py-2 ring-1 ring-black/8">
                  <p className="text-xs font-semibold uppercase text-black/42">{label}</p>
                  <p className="mt-1 text-black/65">{detail}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
        {plannerOutputSummary()}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {state.metrics.map((metric) => (
            <div key={metric.label} className="rounded-lg border border-black/10 bg-white p-4 shadow-sm">
              <p className="text-xs font-medium uppercase text-black/45">{metric.label}</p>
              <p className="mt-3 text-2xl font-semibold tracking-normal">{metric.value}</p>
              <p className="mt-1 text-xs text-black/48">{metric.delta}</p>
            </div>
          ))}
        </div>
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
          {recommendationInbox()}
          <aside className="space-y-4">
            {selectedAction()}
            <section className="rounded-lg border border-black/10 bg-white p-4 shadow-sm">
              <h2 className="text-lg font-semibold tracking-normal">Risk And Confidence</h2>
              <div className="mt-4 h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={state.riskTrend} margin={{ top: 10, right: 12, left: -24, bottom: 0 }}>
                    <CartesianGrid stroke="#e7e5df" strokeDasharray="3 3" />
                    <XAxis dataKey="day" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                    <Tooltip />
                    <Line type="linear" dataKey="risk" stroke="#f43f5e" strokeWidth={3} dot={false} isAnimationActive={false} />
                    <Line type="linear" dataKey="confidence" stroke="#4f46e5" strokeWidth={3} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </section>
          </aside>
        </div>
      </div>
    );
  }

  function sourceDataView() {
    const activeSourceKind = sourceDataKindFor(sourceDataKind);
    const totalSources = Object.values(sources).flat().length;
    const pendingCount = ["interactions", "crm", "knowledge", "risks", "candidates"].reduce(
      (total, collection) => total + pendingSamplesFor(collection as SourceCollection).length,
      0,
    );
    return (
      <div className="space-y-3">
        <section className="rounded-lg border border-black/10 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase text-indigo-700">Organizational Input Layer</p>
              <h2 className="mt-1 text-2xl font-semibold tracking-normal">Source Data</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-black/58">
                Upload and save meetings, CRM updates, emails, documents, notes, policies, incidents, and domain records. Every saved item
                becomes retrievable company memory for future Planner Runs.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-md bg-[#f7f6f3] px-3 py-2">
                <p className="text-xs font-semibold uppercase text-black/42">Stored sources</p>
                <p className="mt-1 text-xl font-semibold">{totalSources}</p>
              </div>
              <div className="rounded-md bg-[#f7f6f3] px-3 py-2">
                <p className="text-xs font-semibold uppercase text-black/42">Pending imports</p>
                <p className="mt-1 text-xl font-semibold">{pendingCount}</p>
              </div>
            </div>
          </div>
          <div className="mt-4 flex gap-2 overflow-x-auto">
            {sourceDataKinds.map((kind) => {
              const Icon = kind.icon;
              return (
                <button
                  key={kind.id}
                  onClick={() => setSourceDataKind(kind.id)}
                  className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-md border px-3 text-sm font-semibold ${
                    activeSourceKind.id === kind.id
                      ? "border-black bg-black text-white"
                      : "border-black/10 bg-[#fbfaf8] text-black/68 hover:bg-black/5"
                  }`}
                >
                  <Icon size={16} />
                  {kind.title}
                </button>
              );
            })}
          </div>
        </section>
        {sourcePage(activeSourceKind.collection, {
          title: activeSourceKind.title,
          subtitle: activeSourceKind.subtitle,
          sourceType: activeSourceKind.sourceType,
          icon: activeSourceKind.icon,
        })}
      </div>
    );
  }

  function plannerHistoryView() {
    const visibleRuns = plannerRuns.length
      ? plannerRuns
      : run
        ? [
            {
              id: run.run_id,
              account_id: run.account_id,
              objective: run.objective,
              title: run.title,
              intake_text: interaction,
              intake_hash: "",
              case_type: "planner_run",
              status: run.status,
              created_at: run.created_at,
              analysis: run.analysis,
              agent_trace: run.agent_trace,
              retrieved_context: run.retrieved_context,
              recommendations: run.recommendations,
              approval_history: [],
            } satisfies PlannerRunCase,
          ]
        : [];
    const selectedRun = visibleRuns.find((item) => item.id === selectedPlannerRunId) ?? visibleRuns[0];
    const approvedCount = selectedRun?.recommendations.filter((item) => item.status === "approved").length ?? 0;
    const rejectedCount = selectedRun?.recommendations.filter((item) => item.status === "rejected").length ?? 0;
    return (
      <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <section className="rounded-lg border border-black/10 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2">
            <History size={18} className="text-indigo-600" />
            <h2 className="text-lg font-semibold tracking-normal">Planner Runs</h2>
          </div>
          <p className="mt-2 text-sm leading-6 text-black/55">
            Each run is a persistent business case with objective, intake, evidence, analysis, recommendations, review state, and trace.
          </p>
          <div className="mt-4 space-y-2">
            {visibleRuns.map((item) => (
              <button
                key={item.id}
                onClick={() => setSelectedPlannerRunId(item.id)}
                className={`w-full rounded-md border p-3 text-left transition ${
                  selectedRun?.id === item.id ? "border-indigo-200 bg-indigo-50" : "border-black/10 bg-[#fbfaf8] hover:bg-black/[0.025]"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{item.title || item.objective}</p>
                    <p className="mt-1 text-xs text-black/45">
                      {item.created_at ? new Date(item.created_at).toLocaleString() : "No timestamp"}
                    </p>
                  </div>
                  <span className="rounded-md bg-white px-2 py-1 text-xs font-semibold text-black/55 ring-1 ring-black/8">
                    {item.status}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <span className="rounded-md bg-white px-2 py-1 text-black/55 ring-1 ring-black/8">
                    {item.recommendations.length} actions
                  </span>
                  <span className="rounded-md bg-emerald-50 px-2 py-1 text-emerald-700 ring-1 ring-emerald-100">
                    {item.retrieved_context.length} evidence
                  </span>
                </div>
              </button>
            ))}
            {!visibleRuns.length && (
              <div className="rounded-md border border-dashed border-black/12 bg-[#fbfaf8] p-4 text-sm leading-6 text-black/55">
                No planner runs yet. Open Planner, describe a business objective, and run it once.
              </div>
            )}
          </div>
        </section>

        <section className="rounded-lg border border-black/10 bg-white p-4 shadow-sm">
          {!selectedRun ? (
            <div className="rounded-md border border-dashed border-black/12 bg-[#fbfaf8] p-4 text-sm text-black/55">
              Select a planner run to inspect its recommendations, evidence, analysis, approvals, and execution trace.
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase text-black/42">Business Objective</p>
                  <h2 className="mt-1 text-2xl font-semibold tracking-normal">{selectedRun.title || selectedRun.objective}</h2>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-black/60">{selectedRun.objective}</p>
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="rounded-md bg-emerald-50 px-2 py-1 font-semibold text-emerald-700 ring-1 ring-emerald-100">
                    {approvedCount} approved
                  </span>
                  <span className="rounded-md bg-rose-50 px-2 py-1 font-semibold text-rose-700 ring-1 ring-rose-100">
                    {rejectedCount} rejected
                  </span>
                </div>
              </div>

              {selectedRun.intake_text && (
                <div className="rounded-md bg-[#f7f6f3] p-3">
                  <p className="text-xs font-semibold uppercase text-black/42">Intake</p>
                  <p className="mt-2 whitespace-pre-line text-sm leading-6 text-black/62">{selectedRun.intake_text}</p>
                </div>
              )}

              <div className="grid gap-4 xl:grid-cols-2">
                <div>
                  <h3 className="text-sm font-semibold">Recommendations</h3>
                  <div className="mt-3 space-y-2">
                    {selectedRun.recommendations.map((item) => (
                      <article key={item.id} className="rounded-md border border-black/10 bg-[#fbfaf8] p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold">{item.title}</p>
                          <span className={`rounded-md border px-2 py-1 text-xs font-semibold ${priorityClass[item.priority]}`}>
                            {item.priority}
                          </span>
                          <span className="rounded-md bg-white px-2 py-1 text-xs font-semibold text-black/52 ring-1 ring-black/8">
                            {item.status}
                          </span>
                        </div>
                        <p className="mt-2 text-sm leading-6 text-black/58">{item.action}</p>
                        <p className="mt-2 text-xs text-black/45">
                          {item.owner_role} - {item.due_date} - {confidenceLabel(item.confidence)} confidence
                        </p>
                      </article>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-semibold">Retrieved Evidence</h3>
                  <div className="mt-3 space-y-2">
                    {selectedRun.retrieved_context.slice(0, 6).map((item) => (
                      <article key={`${selectedRun.id}-${item.source_id}-${item.snippet}`} className="rounded-md bg-[#f7f6f3] p-3">
                        <p className="text-sm font-semibold">{item.source_title}</p>
                        <p className="mt-1 text-xs uppercase text-black/42">{item.source_type}</p>
                        <p className="mt-2 line-clamp-3 text-sm leading-6 text-black/58">{item.snippet}</p>
                      </article>
                    ))}
                    {!selectedRun.retrieved_context.length && (
                      <div className="rounded-md border border-dashed border-black/12 bg-[#fbfaf8] p-3 text-sm text-black/55">
                        No evidence was captured for this run.
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                <div>
                  <h3 className="text-sm font-semibold">Business Analysis</h3>
                  <div className="mt-3 rounded-md bg-[#f7f6f3] p-3">
                    <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap font-sans text-sm leading-6 text-black/62">
                      {JSON.stringify(selectedRun.analysis ?? {}, null, 2)}
                    </pre>
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-semibold">Approvals / Rejections</h3>
                  <div className="mt-3 space-y-2">
                    {selectedRun.approval_history.map((item, index) => (
                      <article key={`${selectedRun.id}-approval-${index}`} className="rounded-md bg-[#f7f6f3] p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-md bg-white px-2 py-1 text-xs font-semibold text-black/55 ring-1 ring-black/8">
                            {String(item.decision ?? "reviewed")}
                          </span>
                          <p className="text-sm font-semibold">{String(item.reviewer ?? "Reviewer")}</p>
                        </div>
                        <p className="mt-2 text-sm leading-6 text-black/58">{String(item.notes ?? "")}</p>
                        <p className="mt-1 text-xs text-black/42">{String(item.created_at ?? "")}</p>
                      </article>
                    ))}
                    {!selectedRun.approval_history.length && (
                      <div className="rounded-md border border-dashed border-black/12 bg-[#fbfaf8] p-3 text-sm text-black/55">
                        No human review recorded for this planner run yet.
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-semibold">Execution Trace</h3>
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  {selectedRun.agent_trace.map((step, index) => (
                    <div key={`${selectedRun.id}-${step.name}-${index}`} className="rounded-md bg-[#f7f6f3] p-3">
                      <p className="text-sm font-semibold">{index + 1}. {step.name}</p>
                      <p className="mt-1 text-sm leading-6 text-black/58">{step.summary}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    );
  }

  function sourcePage(
    collection: SourceCollection,
    override?: { title: string; subtitle: string; sourceType: string; icon?: typeof BriefcaseBusiness; uploadLabel?: string },
  ) {
    const baseConfig = sourceLabels[collection];
    const config = {
      ...baseConfig,
      title: override?.title ?? baseConfig.title,
      subtitle: override?.subtitle ?? baseConfig.subtitle,
    };
    const Icon = override?.icon ?? config.icon;
    const entries = (sources[collection] ?? []).filter((entry) => sourceEntryMatchesKind(entry, override?.sourceType));
    const draft = draftFor(collection);
    const pendingSamples = pendingSamplesFor(collection);
    return (
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="rounded-lg border border-black/10 bg-white p-3 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-md bg-indigo-50 text-indigo-700">
                <Icon size={19} />
              </span>
              <div>
                <h2 className="text-lg font-semibold tracking-normal">{config.title}</h2>
                <p className="text-sm text-black/55">{config.subtitle}</p>
              </div>
            </div>
            <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-black/10 px-3 text-sm font-medium hover:bg-black/5">
              <Upload size={16} />
              <span>{uploadStatus[collection] ?? "Upload doc"}</span>
              <input
                type="file"
                className="sr-only"
                onChange={(event) => handleUpload(collection, event.target.files?.[0], override?.sourceType)}
              />
            </label>
          </div>
          {pendingSamples.length > 0 && (
            <div className="mt-3 rounded-lg border border-dashed border-indigo-200 bg-indigo-50/60 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-indigo-900">Pending import queue</p>
                  <p className="text-xs text-indigo-700/70">These records are visible here but not in memory until you load and save them.</p>
                </div>
                <span className="rounded-md bg-white px-2 py-1 text-xs font-semibold text-indigo-700 ring-1 ring-indigo-100">
                  {pendingSamples.length} not ingested
                </span>
              </div>
              <div className="mt-3 grid gap-2">
                {pendingSamples.map((sample) => (
                  <article key={sample.id} className="rounded-md border border-indigo-100 bg-white p-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-sm font-semibold">{sample.title}</h3>
                          <span className="rounded-md bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700">
                            not in memory yet
                          </span>
                        </div>
                        <p className="mt-2 line-clamp-2 text-sm leading-6 text-black/58">{sample.content}</p>
                        <p className="mt-2 text-xs font-medium text-indigo-700">{sample.ingest_hint}</p>
                      </div>
                      <button
                        onClick={() => loadPendingSample(collection, sample)}
                        className="inline-flex h-9 shrink-0 items-center justify-center rounded-md bg-indigo-600 px-3 text-sm font-semibold text-white hover:bg-indigo-700"
                      >
                        Load sample
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          )}
          <div className="mt-3 grid gap-2">
            {entries.map((entry) => (
              <article key={entry.id} className="rounded-md border border-black/10 bg-[#fbfaf8] p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold">{entry.title}</h3>
                  <span className="rounded-md bg-white px-2 py-1 text-xs font-medium text-black/50 ring-1 ring-black/8">
                    {entry.source_type}
                  </span>
                </div>
                <p className="mt-2 line-clamp-3 text-sm leading-6 text-black/62">{entry.content}</p>
                {!!Object.keys(entry.fields ?? {}).length && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {Object.entries(entry.fields).slice(0, 4).map(([key, value]) => (
                      <span key={key} className="rounded-md bg-white px-2 py-1 text-xs text-black/55 ring-1 ring-black/8">
                        {key}: {String(value)}
                      </span>
                    ))}
                  </div>
                )}
              </article>
            ))}
            {!entries.length && (
              <div className="rounded-md border border-dashed border-black/12 bg-[#fbfaf8] p-4 text-sm leading-6 text-black/55">
                No saved {config.title.toLowerCase()} yet. Add a clean entry or load a sample, then save it into Flow360 memory.
              </div>
            )}
          </div>
        </section>

        <aside className="rounded-lg border border-black/10 bg-white p-3 shadow-sm">
          <h2 className="text-lg font-semibold tracking-normal">Add New {config.title}</h2>
          <p className="mt-1 text-sm text-black/55">Saving this entry immediately ingests it into Flow360 memory.</p>
          <input
            value={draft.title}
            onChange={(event) => updateDraft(collection, { title: event.target.value })}
            placeholder="Title"
            className="mt-3 h-9 w-full rounded-md border border-black/10 bg-[#fbfaf8] px-3 text-sm outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
          />
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {fieldSpecs[collection].map((field) => (
              <label key={field.key} className="text-xs font-medium text-black/55">
                {field.label}
                <input
                  value={draft.fields[field.key] ?? ""}
                  onChange={(event) => updateDraft(collection, { fields: { ...draft.fields, [field.key]: event.target.value } })}
                  placeholder={field.placeholder}
                  className="mt-1 h-9 w-full rounded-md border border-black/10 bg-[#fbfaf8] px-2 text-sm font-normal text-black outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                />
              </label>
            ))}
          </div>
          <textarea
            value={draft.content}
            onChange={(event) => updateDraft(collection, { content: event.target.value })}
            placeholder="Paste the CRM note, email, meeting note, policy, RCA, or candidate detail here."
            className="mt-3 min-h-[140px] w-full resize-none rounded-lg border border-black/10 bg-[#fbfaf8] p-3 text-sm leading-6 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
          />
          <button
            onClick={() => submitSource(collection, override?.sourceType)}
            className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-black px-4 text-sm font-semibold text-white hover:bg-black/85"
          >
            <Database size={16} />
            Save And Ingest To Memory
          </button>
        </aside>
      </div>
    );
  }

  function candidatesView() {
    const collection: SourceCollection = "candidates";
    const draft = draftFor(collection);
    const pendingSamples = pendingSamplesFor(collection);
    return (
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="rounded-lg border border-black/10 bg-white p-3 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <SearchCheck size={18} className="text-indigo-600" />
              <div>
                <h2 className="text-lg font-semibold tracking-normal">Candidate BGV And Credentialing</h2>
                <p className="text-sm text-black/55">Applicable only when decisions are about individual people.</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded-md bg-[#f7f6f3] px-2 py-1 font-medium">{state.candidates.length} candidates</span>
              <span className="rounded-md bg-emerald-50 px-2 py-1 font-medium text-emerald-700">
                {state.candidates.filter((candidate) => candidate.bgv_status === "verified").length} verified
              </span>
              <span className="rounded-md bg-rose-50 px-2 py-1 font-medium text-rose-700">
                {state.candidates.filter((candidate) => candidate.missing_items.length > 0).length} blockers
              </span>
            </div>
          </div>

          <div className="mt-3 overflow-hidden rounded-md border border-black/10">
            <div className="grid grid-cols-[1.1fr_0.9fr_0.8fr_0.7fr_120px] bg-[#f7f6f3] px-3 py-2 text-xs font-semibold uppercase text-black/45">
              <span>Candidate</span>
              <span>Credentialing</span>
              <span>BGV</span>
              <span>Fit</span>
              <span className="text-right">Action</span>
            </div>
            {state.candidates.map((candidate) => {
              const result = bgvResults[candidate.id];
              return (
                <article key={candidate.id} className="border-t border-black/8 bg-white px-3 py-3">
                  <div className="grid gap-3 md:grid-cols-[1.1fr_0.9fr_0.8fr_0.7fr_120px] md:items-center">
                    <div>
                      <h3 className="text-sm font-semibold">{candidate.name}</h3>
                      <p className="mt-1 text-xs text-black/52">{candidate.role} - available {candidate.availability_date}</p>
                    </div>
                    <span className="rounded-md bg-[#fbfaf8] px-2 py-1 text-xs text-black/62 ring-1 ring-black/8">
                      {candidate.credentialing_status}
                    </span>
                    <span className="rounded-md bg-[#fbfaf8] px-2 py-1 text-xs text-black/62 ring-1 ring-black/8">
                      {candidate.bgv_status}
                    </span>
                    <span className="text-sm font-semibold">{candidate.fit_score}%</span>
                    <button
                      onClick={() => handleBGV(candidate)}
                      className="inline-flex h-8 items-center justify-center gap-2 rounded-md bg-indigo-600 px-3 text-xs font-semibold text-white hover:bg-indigo-700"
                    >
                      <SearchCheck size={15} />
                      Run BGV
                    </button>
                  </div>
                  {(candidate.missing_items.length > 0 || candidate.risk_flags.length > 0) && (
                    <div className="mt-2 flex flex-wrap gap-2 text-xs">
                      {candidate.missing_items.map((item) => (
                        <span key={item} className="rounded-md bg-rose-50 px-2 py-1 text-rose-700 ring-1 ring-rose-100">
                          {item}
                        </span>
                      ))}
                      {candidate.risk_flags.map((item) => (
                        <span key={item} className="rounded-md bg-amber-50 px-2 py-1 text-amber-700 ring-1 ring-amber-100">
                          {item}
                        </span>
                      ))}
                    </div>
                  )}
                  {result && (
                    <div
                      className={`mt-2 rounded-md border px-3 py-2 text-xs ${
                        result.status === "blocked"
                          ? "border-rose-200 bg-rose-50 text-rose-800"
                          : result.status === "verified"
                            ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                            : "border-amber-200 bg-amber-50 text-amber-800"
                      }`}
                    >
                      <p className="font-semibold">
                        {result.status} - {result.score}% confidence
                      </p>
                      <p className="mt-1 leading-5">{result.summary}</p>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </section>

        <aside className="rounded-lg border border-black/10 bg-white p-3 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold tracking-normal">Add Candidate</h2>
              <p className="text-xs text-black/52">Save to candidate memory and BGV context.</p>
            </div>
            <label className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-md border border-black/10 px-2 text-xs font-medium hover:bg-black/5">
              <Upload size={14} />
              <span>{uploadStatus[collection] ?? "Upload"}</span>
              <input type="file" className="sr-only" onChange={(event) => handleUpload(collection, event.target.files?.[0])} />
            </label>
          </div>

          {pendingSamples.length > 0 && (
            <div className="mt-3 rounded-md border border-dashed border-indigo-200 bg-indigo-50/70 p-2">
              <p className="text-xs font-semibold uppercase text-indigo-700">Pending import</p>
              {pendingSamples.slice(0, 2).map((sample) => (
                <button
                  key={sample.id}
                  onClick={() => loadPendingSample(collection, sample)}
                  className="mt-2 w-full rounded-md bg-white p-2 text-left text-xs ring-1 ring-indigo-100 hover:bg-indigo-50"
                >
                  <span className="font-semibold">{sample.title}</span>
                  <span className="mt-1 block line-clamp-2 text-black/55">{sample.content}</span>
                </button>
              ))}
            </div>
          )}

          <input
            value={draft.title}
            onChange={(event) => updateDraft(collection, { title: event.target.value })}
            placeholder="Candidate Profile - Nikhil Bhat"
            className="mt-3 h-9 w-full rounded-md border border-black/10 bg-[#fbfaf8] px-3 text-sm outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
          />
          <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
            {fieldSpecs[collection].map((field) => (
              <label key={field.key} className="text-xs font-medium text-black/55">
                {field.label}
                <input
                  value={draft.fields[field.key] ?? ""}
                  onChange={(event) => updateDraft(collection, { fields: { ...draft.fields, [field.key]: event.target.value } })}
                  placeholder={field.placeholder}
                  className="mt-1 h-8 w-full rounded-md border border-black/10 bg-[#fbfaf8] px-2 text-xs font-normal text-black outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                />
              </label>
            ))}
          </div>
          <textarea
            value={draft.content}
            onChange={(event) => updateDraft(collection, { content: event.target.value })}
            placeholder="Paste candidate summary, credentialing notes, BGV status, missing items, and rate details."
            className="mt-3 min-h-[120px] w-full resize-none rounded-lg border border-black/10 bg-[#fbfaf8] p-3 text-sm leading-6 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
          />
          <button
            onClick={() => submitSource(collection)}
            className="mt-3 inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-black px-3 text-sm font-semibold text-white hover:bg-black/85"
          >
            <Database size={15} />
            Save And Ingest
          </button>
        </aside>
      </div>
    );
  }

  function memoryView() {
    const memoryMeshNodes = [
      {
        id: "crm",
        label: "CRM",
        detail: "account, stakeholders, renewal",
        count: sources.crm.length,
        tone: "profile",
      },
      {
        id: "interactions",
        label: "Meetings & Mail",
        detail: "calls, transcripts, emails",
        count: sources.interactions.length,
        tone: "raw",
      },
      {
        id: "knowledge",
        label: "Knowledge Base",
        detail: "policies, playbooks, rate cards",
        count: sources.knowledge.length,
        tone: "rule",
      },
      {
        id: "risks",
        label: "Risks & Incidents",
        detail: "SLA, renewal, RCA memory",
        count: sources.risks.length,
        tone: "episodic",
      },
      {
        id: "candidates",
        label: "Candidates/BGV",
        detail: "profiles, checks, blockers",
        count: sources.candidates.length,
        tone: "profile",
      },
      {
        id: "review",
        label: "Review Memory",
        detail: "approvals, rejections, execution",
        count: displayMemory.filter((item) => item.memory_type === "episodic").length,
        tone: "review",
      },
    ];
    const memoryQuality = Math.round(
      displayMemory.reduce((total, item) => total + item.confidence, 0) / Math.max(displayMemory.length, 1),
    );
    const positions: Record<string, { left: string; top: string; x: number; y: number }> = {
      crm: { left: "15%", top: "22%", x: 15, y: 22 },
      interactions: { left: "42%", top: "14%", x: 42, y: 14 },
      knowledge: { left: "78%", top: "24%", x: 78, y: 24 },
      risks: { left: "20%", top: "72%", x: 20, y: 72 },
      candidates: { left: "54%", top: "80%", x: 54, y: 80 },
      review: { left: "84%", top: "70%", x: 84, y: 70 },
    };
    const meshEdges = [
      ["crm", "interactions"],
      ["interactions", "knowledge"],
      ["knowledge", "review"],
      ["crm", "risks"],
      ["risks", "candidates"],
      ["candidates", "review"],
      ["interactions", "risks"],
      ["knowledge", "candidates"],
    ];
    const ledgerItems = buildMemoryLedgerItems(displayMemory, sources, account);
    const selectedLedger = ledgerItems.find((item) => item.id === selectedLedgerId) ?? ledgerItems[0];
    const trustedCount = ledgerItems.filter((item) => item.state === "fresh" || item.state === "approved").length;
    return (
      <div className="space-y-3">
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_280px]">
          <section className="rounded-lg border border-black/10 bg-white p-3 shadow-sm">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <Database size={18} className="text-emerald-600" />
                <h2 className="text-lg font-semibold tracking-normal">Neural Memory Mesh</h2>
              </div>
              <p className="text-sm text-black/48">Source memory, rules, risk episodes, and human decisions connected to this account.</p>
            </div>

            <div
              className="relative mt-3 h-[390px] overflow-hidden rounded-lg border border-white/10 bg-[#101319] text-white"
              style={{
                backgroundImage:
                  "linear-gradient(rgba(255,255,255,0.055) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.055) 1px, transparent 1px), radial-gradient(circle at 52% 46%, rgba(45,212,191,0.2), transparent 34%), radial-gradient(circle at 22% 74%, rgba(99,102,241,0.18), transparent 30%)",
                backgroundSize: "42px 42px, 42px 42px, 100% 100%, 100% 100%",
              }}
            >
              <svg className="pointer-events-none absolute inset-0 h-full w-full opacity-70" aria-hidden viewBox="0 0 100 100" preserveAspectRatio="none">
                {meshEdges.map(([from, to]) => (
                  <line
                    key={`${from}-${to}`}
                    x1={positions[from].x}
                    y1={positions[from].y}
                    x2={positions[to].x}
                    y2={positions[to].y}
                    stroke="rgba(125,211,252,0.42)"
                    strokeWidth="0.45"
                  />
                ))}
                <line x1="15" y1="22" x2="84" y2="70" stroke="rgba(99,102,241,0.25)" strokeWidth="0.45" />
                <line x1="78" y1="24" x2="20" y2="72" stroke="rgba(99,102,241,0.25)" strokeWidth="0.45" />
              </svg>

              <div className="absolute left-1/2 top-1/2 z-10 w-[214px] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-cyan-200/25 bg-cyan-300/[0.10] p-4 text-center shadow-[0_0_56px_rgba(45,212,191,0.22)] backdrop-blur">
                <p className="text-xs font-semibold uppercase text-cyan-200">Planner Core</p>
                <h3 className="mt-2 text-lg font-semibold leading-6">{account.name}</h3>
                <p className="mt-2 text-sm leading-5 text-white/58">
                  {Object.values(sources).flat().length} sources - {memoryQuality}% trust - {trustedCount} trusted memories
                </p>
              </div>

              {memoryMeshNodes.map((node) => (
                <div
                  key={node.id}
                  className={`absolute z-10 w-[176px] -translate-x-1/2 -translate-y-1/2 rounded-xl border p-3 shadow-lg backdrop-blur transition hover:scale-[1.02] ${
                    node.tone === "profile"
                      ? "border-indigo-200/50 bg-indigo-50 text-indigo-900"
                      : node.tone === "rule"
                        ? "border-emerald-200/60 bg-emerald-50 text-emerald-900"
                        : node.tone === "episodic"
                          ? "border-amber-200/70 bg-amber-50 text-amber-900"
                          : node.tone === "review"
                            ? "border-violet-200/70 bg-violet-50 text-violet-900"
                            : "border-cyan-200/60 bg-cyan-50 text-cyan-900"
                  }`}
                  style={{ left: positions[node.id].left, top: positions[node.id].top }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold uppercase">{node.label}</p>
                    <span className="text-xs font-semibold">{node.count}</span>
                  </div>
                  <p className="mt-2 text-sm font-semibold leading-5">{node.detail}</p>
                  <p className="mt-1 text-xs opacity-60">
                    {node.count ? "connected to planner" : "waiting for source data"}
                  </p>
                </div>
              ))}

              <div className="absolute bottom-3 left-3 right-3 z-10 grid gap-2 md:grid-cols-3">
                {[
                  ["Planner use", "Edges show which memory layers can influence the selected recommendation."],
                  ["Trust rule", "Rules and human-reviewed items get stronger influence than fresh raw notes."],
                  ["Gap signal", "Empty nodes show what the account still needs before confidence rises."],
                ].map(([label, detail]) => (
                  <div key={label} className="rounded-lg border border-white/10 bg-white/[0.07] p-3 backdrop-blur">
                    <p className="text-xs font-semibold uppercase text-white/42">{label}</p>
                    <p className="mt-1 text-xs leading-5 text-white/66">{detail}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-black/10 bg-[#111111] p-3 text-white shadow-sm">
            <div className="flex items-center gap-2">
              <FolderOpen size={18} className="text-cyan-300" />
              <h2 className="text-lg font-semibold tracking-normal">Memory Sources</h2>
            </div>
            <div className="mt-3 grid gap-2">
              {Object.entries(sources).map(([collection, entries]) => (
                <div key={collection} className="flex items-center justify-between rounded-md border border-white/10 bg-white/[0.06] p-3">
                  <div>
                    <p className="text-xs font-semibold uppercase text-cyan-300">
                      {collection === "interactions" ? "meetings/mail" : collection}
                    </p>
                    <p className="mt-1 text-xs text-white/50">connected entries</p>
                  </div>
                  <p className="text-2xl font-semibold">{entries.length}</p>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="grid gap-3 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
          <section className="rounded-lg border border-black/10 bg-white p-3 shadow-sm">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <BadgeCheck size={18} className="text-indigo-600" />
                <h2 className="text-lg font-semibold tracking-normal">Memory Ledger</h2>
              </div>
              <span className="rounded-md border border-indigo-100 bg-indigo-50 px-2 py-1 text-xs font-semibold text-indigo-700">
                {trustedCount} trusted items
              </span>
            </div>
            <p className="mt-2 text-sm leading-6 text-black/55">
              Audits memory before it influences a recommendation: fresh, stale, contradicted, human-approved, or AI-inferred.
            </p>

            <div className="mt-3 overflow-x-auto rounded-lg border border-black/10">
              <div className="min-w-[740px]">
                <div className="grid grid-cols-[1.35fr_0.75fr_0.75fr_0.7fr] bg-[#f7f6f3] px-3 py-2 text-xs font-semibold uppercase text-black/45">
                  <span>Memory</span>
                  <span>Trust state</span>
                  <span>Origin</span>
                  <span>Planner use</span>
                </div>
                {ledgerItems.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setSelectedLedgerId(item.id)}
                    className={`grid w-full grid-cols-[1.35fr_0.75fr_0.75fr_0.7fr] items-center gap-2 border-t border-black/8 px-3 py-3 text-left text-sm transition ${
                      selectedLedger?.id === item.id ? "bg-indigo-50/70" : "bg-white hover:bg-black/[0.025]"
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{item.title}</span>
                      <span className="mt-1 block truncate text-xs text-black/45">{item.source}</span>
                    </span>
                    <span className={`w-fit rounded-md border px-2 py-1 text-xs font-semibold ${ledgerStateStyle[item.state]}`}>
                      {item.stateLabel}
                    </span>
                    <span className="truncate text-black/58">{item.origin}</span>
                    <span className="truncate text-black/58">{item.plannerUse}</span>
                  </button>
                ))}
              </div>
              {!ledgerItems.length && (
                <div className="bg-white p-4 text-sm text-black/55">No memory yet. Add source data or run the planner.</div>
              )}
            </div>
          </section>

          <section className="rounded-lg border border-black/10 bg-white p-3 shadow-sm">
            {selectedLedger ? (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase text-black/42">Planner trust decision</p>
                    <h2 className="mt-1 text-lg font-semibold tracking-normal">{selectedLedger.title}</h2>
                    <p className="mt-1 text-sm text-black/48">{selectedLedger.trust}% trust</p>
                  </div>
                  <span className={`rounded-md border px-2 py-1 text-xs font-semibold ${ledgerStateStyle[selectedLedger.state]}`}>
                    {selectedLedger.stateLabel}
                  </span>
                </div>
                <div className="mt-3 grid gap-2">
                  <div className="rounded-md bg-[#f7f6f3] p-3">
                    <p className="text-xs font-semibold uppercase text-black/42">Why it matters</p>
                    <p className="mt-2 text-sm leading-6 text-black/65">{selectedLedger.why}</p>
                  </div>
                  <div className="rounded-md bg-[#f7f6f3] p-3">
                    <p className="text-xs font-semibold uppercase text-black/42">Evidence chain</p>
                    <p className="mt-2 text-sm leading-6 text-black/65">{selectedLedger.evidence}</p>
                  </div>
                  <div className="rounded-md bg-[#f7f6f3] p-3">
                    <p className="text-xs font-semibold uppercase text-black/42">Planner rule</p>
                    <p className="mt-2 text-sm leading-6 text-black/65">{selectedLedger.rule}</p>
                  </div>
                </div>
              </>
            ) : (
              <div className="rounded-md bg-[#f7f6f3] p-4 text-sm text-black/55">Select a memory item to inspect its planner rule.</div>
            )}
          </section>
        </div>

        <div className="grid gap-3 xl:grid-cols-[0.9fr_1.1fr]">
          <section className="rounded-lg border border-black/10 bg-white p-3 shadow-sm">
            <div className="flex items-center gap-2">
              <Database size={18} className="text-emerald-600" />
              <h2 className="text-lg font-semibold tracking-normal">Memory Cards</h2>
            </div>
            <div className="mt-3 grid max-h-[420px] content-start gap-2 overflow-y-auto pr-1">
              {displayMemory.map((item) => (
                <article key={item.id} className="rounded-md bg-[#f7f6f3] p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold">{item.title}</p>
                    <span className={`rounded-md border px-2 py-1 text-xs font-semibold ${memoryTypeStyle[item.memory_type]}`}>
                      {item.memory_type}
                    </span>
                  </div>
                  <p className="mt-2 line-clamp-3 text-sm leading-5 text-black/62">{item.summary}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-black/10 bg-white p-3 shadow-sm">
            <div className="flex items-center gap-2">
              <BadgeCheck size={18} className="text-amber-600" />
              <h2 className="text-lg font-semibold tracking-normal">Evidence For Selected Action</h2>
            </div>
            <div className="mt-3 grid max-h-[420px] content-start gap-2 overflow-y-auto pr-1">
              {(activeSelected?.evidence.length ? activeSelected.evidence : []).map((item) => (
                <article key={`${item.source_id}-${item.snippet}`} className="rounded-md border border-black/10 bg-[#fbfaf8] p-3">
                  <p className="text-sm font-semibold">{item.source_title}</p>
                  <p className="mt-1 text-xs uppercase text-black/42">
                    {item.source_type} - relevance {Math.round(item.relevance * 100)}%
                  </p>
                  <p className="mt-2 text-sm leading-6 text-black/62">{item.snippet}</p>
                </article>
              ))}
              {!activeSelected?.evidence.length && (
                <div className="rounded-md bg-[#f7f6f3] p-3 text-sm text-black/58">
                  Select a recommendation to inspect the evidence connected to memory.
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    );
  }

  function traceView() {
    return (
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section className="rounded-lg border border-black/10 bg-[#111111] p-4 text-white shadow-sm">
          <div className="flex items-center gap-2">
            <BadgeCheck size={18} className="text-cyan-300" />
            <h2 className="text-lg font-semibold tracking-normal">Agent Trace</h2>
          </div>
          <div className="mt-4 space-y-4">
            {(trace.length
              ? trace
              : [{ name: "Planner Agent", summary: "Ready to orchestrate source ingestion, retrieval, reasoning, recommendation, and memory." }]
            ).map((step, index) => (
              <div key={`${step.name}-${index}`} className="grid grid-cols-[24px_1fr] gap-3">
                <div className="mt-1 flex h-6 w-6 items-center justify-center rounded-md bg-white/10 text-xs font-bold">
                  {index + 1}
                </div>
                <div>
                  <p className="text-sm font-semibold">{step.name}</p>
                  <p className="mt-1 text-sm leading-5 text-white/64">{step.summary}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
        <section className="rounded-lg border border-black/10 bg-white p-4 shadow-sm">
          <h2 className="text-lg font-semibold tracking-normal">Run Status</h2>
          <div className="mt-4 grid gap-2 text-sm">
            <div className="flex items-center justify-between rounded-md bg-[#f7f6f3] px-3 py-2">
              <span className="text-black/48">Mode</span>
              <span className="font-medium">{run?.mode ?? state.mode}</span>
            </div>
            <div className="flex items-center justify-between rounded-md bg-[#f7f6f3] px-3 py-2">
              <span className="text-black/48">Actions</span>
              <span className="font-medium">{recommendations.length}</span>
            </div>
            <div className="flex items-center justify-between rounded-md bg-[#f7f6f3] px-3 py-2">
              <span className="text-black/48">Source entries</span>
              <span className="font-medium">{Object.values(sources).flat().length}</span>
            </div>
          </div>
        </section>
      </div>
    );
  }

  function settingsView() {
    return (
      <div className="space-y-4">
        <section className="rounded-lg border border-black/10 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase text-indigo-700">Workspace Configuration</p>
              <h2 className="mt-1 text-2xl font-semibold tracking-normal">Settings</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-black/58">
                Manage this company workspace, reusable domain blueprints, and planner configuration without leaving the workflow.
              </p>
            </div>
            <div className="inline-flex h-10 items-center gap-2 rounded-md border border-black/10 bg-white px-4 text-sm font-semibold text-black/70">
              <Building2 size={16} />
              Current workspace
            </div>
          </div>
        </section>
        <section className="rounded-lg border border-black/10 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2">
            <Building2 size={18} className="text-indigo-600" />
            <h2 className="text-lg font-semibold tracking-normal">Company Workspace</h2>
          </div>
          <div className="mt-4 max-w-xl rounded-lg border border-indigo-200 bg-indigo-50/60 p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase text-indigo-700">{account.segment}</p>
                <h3 className="mt-2 text-xl font-semibold tracking-normal">{account.name}</h3>
              </div>
              <span className="rounded-md bg-black px-2 py-1 text-xs font-semibold text-white">{account.health}</span>
            </div>
            <p className="mt-4 text-sm leading-6 text-black/62">{account.description}</p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              {account.metrics.slice(0, 4).map((metric) => (
                <div key={metric.label} className="rounded-md bg-white p-3 ring-1 ring-indigo-100">
                  <p className="text-xs text-black/45">{metric.label}</p>
                  <p className="mt-1 font-semibold">{metric.value}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
        {blueprintStudioView()}
      </div>
    );
  }

  function guidePanel() {
    if (guideCollapsed) {
      return (
        <aside className="fixed bottom-4 right-4 z-40">
          <button
            onClick={() => setGuideCollapsed(false)}
            className="inline-flex h-11 items-center gap-2 rounded-full border border-black/10 bg-black px-4 text-sm font-semibold text-white shadow-[0_14px_40px_rgba(0,0,0,0.22)] hover:bg-black/85"
            aria-label="Expand FlowGuide"
            title="Expand FlowGuide"
          >
            <Bot size={17} />
            FlowGuide
            <PanelRightOpen size={15} />
          </button>
        </aside>
      );
    }

    return (
      <aside className="fixed bottom-4 right-4 z-40 flex max-h-[560px] w-[380px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-black/10 bg-white shadow-[0_18px_60px_rgba(0,0,0,0.22)]">
        <div className="border-b border-black/10 p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-black text-white">
                <Bot size={18} />
              </span>
              <div className="min-w-0">
                <h2 className="font-semibold tracking-normal">FlowGuide</h2>
                <p className="truncate text-xs text-black/50">Screen-aware assistant</p>
              </div>
            </div>
            <button
              onClick={() => setGuideCollapsed(true)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-black/10 hover:bg-black/5"
              aria-label="Collapse FlowGuide"
              title="Collapse FlowGuide"
            >
              <PanelRightClose size={17} />
            </button>
          </div>
        </div>
        <div className="max-h-[270px] space-y-2 overflow-y-auto p-3">
          {guideMessages.map((message, index) => (
            <div
              key={`${message.role}-${index}`}
              className={`rounded-lg p-3 text-sm leading-6 ${
                message.role === "assistant" ? "bg-[#f4f3f0] text-black/70" : "bg-black text-white"
              }`}
            >
              {message.content}
            </div>
          ))}
          {isGuideLoading && (
            <div className="inline-flex items-center gap-2 rounded-lg bg-[#f4f3f0] p-3 text-sm text-black/60">
              <Loader2 size={15} className="animate-spin" />
              Thinking with memory
            </div>
          )}
        </div>
        <div className="border-t border-black/10 p-3">
          <textarea
            value={guideInput}
            onChange={(event) => setGuideInput(event.target.value)}
            className="min-h-[72px] w-full resize-none rounded-lg border border-black/10 bg-[#fbfaf8] p-3 text-sm leading-6 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
            placeholder="Ask FlowGuide how to use this screen..."
          />
          <button
            onClick={sendGuide}
            className="mt-2 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-black px-4 text-sm font-semibold text-white hover:bg-black/85"
          >
            {isGuideLoading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            Send
          </button>
        </div>
      </aside>
    );
  }

  function activeContent() {
    if (activeView === "accounts") return accountCards();
    if (activeView === "today") return todayView();
    if (activeView === "dashboard") return dashboardView();
    if (activeView === "source_data") return sourceDataView();
    if (activeView === "planner_history") return plannerHistoryView();
    if (activeView === "outcomes") return outcomesView();
    if (activeView === "escalations") return escalationsView();
    if (activeView === "blueprints") return blueprintStudioView();
    if (activeView === "crm") return sourcePage("crm");
    if (activeView === "interactions") return sourcePage("interactions");
    if (activeView === "knowledge") return sourcePage("knowledge");
    if (activeView === "risks") return sourcePage("risks");
    if (activeView === "candidates" && account.supports_candidates) return candidatesView();
    if (activeView === "memory") return memoryView();
    if (activeView === "execution") return executionStudioView();
    if (activeView === "settings") return settingsView();
    return traceView();
  }

  if (!sessionReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f4f3f0] text-[#141414]">
        <div className="inline-flex items-center gap-2 rounded-md border border-black/10 bg-white px-4 py-3 text-sm text-black/65">
          <Loader2 size={16} className="animate-spin" />
          Opening workspace
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen bg-[#f4f3f0] px-4 py-8 text-[#141414]">
        <div className="mx-auto grid max-w-5xl gap-4 lg:grid-cols-[1fr_420px]">
          <section className="rounded-lg border border-black/10 bg-white p-6">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-md bg-black text-white">
                <Building2 size={20} />
              </span>
              <div>
                <p className="text-sm font-semibold text-indigo-700">Flow360</p>
                <h1 className="text-2xl font-semibold tracking-normal">Decision workspace for business operators</h1>
              </div>
            </div>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {[
                ["Daily command brief", "See what needs this company workspace's attention first and why."],
                ["Human-approved actions", "Review owners, due dates, evidence, and business impact before execution."],
                ["Reusable domains", "Configure healthcare staffing, SaaS customer success, and field operations workflows."],
                ["Execution drafts", "Turn approvals into customer email, CRM task, escalation note, and risk updates."],
              ].map(([title, copy]) => (
                <div key={title} className="rounded-lg border border-black/10 bg-[#fbfaf8] p-4">
                  <p className="font-semibold">{title}</p>
                  <p className="mt-1 text-sm leading-6 text-black/58">{copy}</p>
                </div>
              ))}
            </div>
          </section>

          <form onSubmit={handleAuth} className="rounded-lg border border-black/10 bg-white p-5 shadow-sm">
            <div className="flex rounded-md bg-[#f4f3f0] p-1">
              <button
                type="button"
                onClick={() => setAuthMode("login")}
                className={`h-9 flex-1 rounded-md text-sm font-semibold ${authMode === "login" ? "bg-white shadow-sm" : "text-black/55"}`}
              >
                Log in
              </button>
              <button
                type="button"
                onClick={() => setAuthMode("signup")}
                className={`h-9 flex-1 rounded-md text-sm font-semibold ${authMode === "signup" ? "bg-white shadow-sm" : "text-black/55"}`}
              >
                Create workspace
              </button>
            </div>
            {authMode === "signup" && (
              <div className="mt-4 grid gap-3">
                <label className="text-sm font-medium">
                  Company name
                  <input
                    value={authForm.company_name}
                    onChange={(event) => setAuthForm((current) => ({ ...current, company_name: event.target.value }))}
                    className="mt-1 h-10 w-full rounded-md border border-black/10 px-3 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                    placeholder="Aarogya Health Network"
                  />
                </label>
                <label className="text-sm font-medium">
                  Business type
                  <input
                    value={authForm.industry}
                    onChange={(event) => setAuthForm((current) => ({ ...current, industry: event.target.value }))}
                    className="mt-1 h-10 w-full rounded-md border border-black/10 px-3 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                    placeholder="Healthcare staffing"
                  />
                </label>
              </div>
            )}
            <div className="mt-4 grid gap-3">
              <label className="text-sm font-medium">
                Work email
                <input
                  type="email"
                  value={authForm.email}
                  onChange={(event) => setAuthForm((current) => ({ ...current, email: event.target.value }))}
                  className="mt-1 h-10 w-full rounded-md border border-black/10 px-3 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                  placeholder="admin@company.com"
                />
              </label>
              <label className="text-sm font-medium">
                Password
                <input
                  type="password"
                  value={authForm.password}
                  onChange={(event) => setAuthForm((current) => ({ ...current, password: event.target.value }))}
                  className="mt-1 h-10 w-full rounded-md border border-black/10 px-3 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                  placeholder="Enter password"
                />
              </label>
            </div>
            {authError && <p className="mt-3 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{authError}</p>}
            <button
              type="submit"
              className="mt-5 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-black px-4 text-sm font-semibold text-white hover:bg-black/85"
            >
              {isAuthenticating ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
              {authMode === "signup" ? "Create workspace" : "Log in"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen overflow-x-hidden bg-[#f4f3f0] text-[#141414]">
      <div className="flex min-h-screen">
        <aside
          className={`hidden shrink-0 border-r border-black/10 bg-white/82 px-3 py-5 transition-all lg:block ${
            sidebarCollapsed ? "w-[78px]" : "w-[230px]"
          }`}
        >
          <div className="mb-6 flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-black/10 bg-black text-white">
                <Sparkles size={20} />
              </div>
              {!sidebarCollapsed && <span className="font-semibold tracking-normal">Flow360</span>}
            </div>
            <button
              onClick={() => setSidebarCollapsed((value) => !value)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-black/10 hover:bg-black/5"
              aria-label="Toggle sidebar"
            >
              {sidebarCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
            </button>
          </div>
          <nav className="space-y-2">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => setActiveView(item.id)}
                title={item.label}
                className={`flex h-11 w-full items-center gap-3 rounded-md border px-3 text-sm font-medium transition ${
                  activeView === item.id
                    ? "border-indigo-200 bg-indigo-50 text-indigo-700"
                    : "border-transparent text-black/70 hover:border-black/10 hover:bg-black/5"
                } ${sidebarCollapsed ? "justify-center" : ""}`}
              >
                <item.icon size={19} />
                {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
              </button>
            ))}
          </nav>
        </aside>

        <main className="min-w-0 flex-1">
          <header className="border-b border-black/10 bg-white/86 px-4 py-3 backdrop-blur md:px-5">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-medium text-indigo-700">
                  {activeView === "dashboard"
                    ? "Planner workspace"
                    : activeView === "today" ||
                        activeView === "source_data" ||
                        activeView === "memory" ||
                        activeView === "planner_history" ||
                        activeView === "outcomes" ||
                        activeView === "settings"
                      ? "Decision intelligence platform"
                      : account.segment}
                </p>
                <h1 className="mt-0.5 text-2xl font-semibold tracking-normal text-black md:text-3xl">
                  {activeView === "today"
                    ? "Home"
                    : activeView === "dashboard"
                      ? "Planner"
                      : activeView === "source_data" ||
                          activeView === "memory" ||
                          activeView === "planner_history" ||
                          activeView === "outcomes" ||
                          activeView === "settings" ||
                          activeView === "escalations" ||
                          activeView === "blueprints"
                      ? viewLabels[activeView]
                      : account.name}
                </h1>
                <p className="mt-1 max-w-3xl text-sm leading-6 text-black/58">
                  {activeView === "today"
                    ? "What needs attention today: pending planner runs, approvals, risks, recent activity, and memory health."
                    : activeView === "dashboard"
                      ? "Create one persistent Planner Run for a business objective, then review evidence-backed next best actions."
                      : activeView === "source_data"
                        ? "Continuously add company data so retrieval and recommendations improve over time."
                        : activeView === "planner_history"
                          ? "Inspect previous Planner Runs, recommendations, approvals, evidence, reasoning, and traces."
                        : activeView === "memory"
                          ? "See what Flow360 knows about the company and how each memory affects future recommendations."
                    : activeView === "outcomes"
                      ? "Business outcome scorecards generated from each account's memory, source coverage, recommendations, and review state."
                      : activeView === "settings"
                        ? "Manage this company workspace, planner configuration, and reusable domain workflows."
                      : activeView === "escalations"
                        ? "A generated owner, deadline, channel, and evidence view for every account that needs escalation."
                        : activeView === "blueprints"
                          ? "Reusable domain configuration showing how Flow360 adapts beyond one hardcoded use case."
                      : account.description}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {state.accounts.length > 1 ? (
                  <button
                    onClick={() => setActiveView("accounts")}
                    className="inline-flex h-10 items-center gap-2 rounded-md border border-black/10 bg-white px-4 text-sm font-semibold hover:bg-black/5"
                  >
                    <Building2 size={16} />
                    Choose Focus Area
                  </button>
                ) : (
                  <div className="inline-flex h-10 items-center gap-2 rounded-md border border-black/10 bg-white px-4 text-sm font-semibold text-black/70">
                    <Building2 size={16} />
                    {account.name}
                  </div>
                )}
                <button
                  onClick={handleLogout}
                  className="inline-flex h-10 items-center gap-2 rounded-md border border-black/10 bg-white px-4 text-sm font-semibold hover:bg-black/5"
                >
                  Sign out
                </button>
                <button
                  onClick={activeView === "dashboard" ? () => handleRunPlanner(false) : () => setActiveView("dashboard")}
                  disabled={activeView === "dashboard" && (isRunning || !plannerObjective.trim() || !interaction.trim())}
                  className="inline-flex h-10 items-center gap-2 rounded-md bg-black px-4 text-sm font-semibold text-white hover:bg-black/85 disabled:cursor-not-allowed disabled:bg-black/25"
                >
                  {activeView === "dashboard" && isRunning ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <ClipboardList size={16} />
                  )}
                  {activeView === "dashboard" ? "Run Planner" : "New Planner Run"}
                </button>
              </div>
            </div>
          </header>

          <div className="border-b border-black/10 bg-white/70 px-4 py-3 lg:hidden">
            <div className="flex gap-2 overflow-x-auto">
              {navItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setActiveView(item.id)}
                  className={`inline-flex h-9 shrink-0 items-center gap-2 rounded-md border px-3 text-sm font-medium ${
                    activeView === item.id ? "border-indigo-200 bg-indigo-50 text-indigo-700" : "border-black/10 bg-white text-black/70"
                  }`}
                >
                  <item.icon size={16} />
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div className={`min-w-0 p-3 ${activeView === "memory" ? "pb-6" : "pb-20"}`}>
            {apiError && (
              <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                <p className="font-semibold">Live API unavailable</p>
                <p className="mt-1">{apiError}</p>
              </div>
            )}
            {activeContent()}
          </div>
        </main>
      </div>
      {guidePanel()}
    </div>
  );
}
