import { emptyDashboardState } from "./empty-state";
import type {
  AgentRunResult,
  AccountSummary,
  AuthSession,
  BGVResult,
  BlueprintBuilderKey,
  BlueprintConfigurationPayload,
  BlueprintOptionResponse,
  BlueprintSuggestionResponse,
  BusinessDomain,
  DashboardState,
  GuideChatResponse,
  GuideMessage,
  IntelligenceBriefsResponse,
  MemoryQueryResponse,
  PlannerRunCase,
  SourceCollection,
  SourceEntry,
  StrategyProfile,
  WorkspaceData,
} from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8001";
const SESSION_KEY = "flow360-company-session";

function storedAccessToken() {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return undefined;
    return (JSON.parse(raw) as AuthSession).access_token;
  } catch {
    return undefined;
  }
}

async function request<T>(path: string, init?: RequestInit, accessToken?: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(accessToken ?? storedAccessToken() ? { Authorization: `Bearer ${accessToken ?? storedAccessToken()}` } : {}),
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    throw new Error("Could not reach the Flow360 API. Make sure the backend is running on http://127.0.0.1:8001.");
  }
  if (!response.ok) {
    let detail = `Request failed: ${response.status}`;
    try {
      const body = await response.json();
      if (body?.detail) detail = String(body.detail);
    } catch {
      // Keep the status fallback.
    }
    throw new Error(detail);
  }
  return response.json() as Promise<T>;
}

export async function signupCompany(payload: {
  company_name: string;
  industry: string;
  email: string;
  password: string;
}): Promise<AuthSession> {
  return request<AuthSession>("/auth/signup", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function loginCompany(payload: {
  email: string;
  password: string;
}): Promise<AuthSession> {
  return request<AuthSession>("/auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

function normalizeDashboardState(data: Partial<DashboardState>): DashboardState {
  const account = {
    ...emptyDashboardState.account,
    ...(data.account ?? {}),
  };
  return {
    ...emptyDashboardState,
    ...data,
    accounts: data.accounts?.length ? data.accounts : [account],
    account,
    recommendations: data.recommendations ?? [],
    memory: data.memory ?? [],
    sources: data.sources ?? emptyDashboardState.sources,
    candidates: data.candidates ?? [],
    metrics: data.metrics ?? account.metrics ?? [],
    riskTrend: data.riskTrend ?? account.risk_trend ?? [],
    initialInteraction: data.initialInteraction ?? "",
  };
}

export async function getDashboardState(accountIdOrToken?: string, accessTokenOverride?: string): Promise<DashboardState> {
  const isAccountId = accountIdOrToken?.startsWith("acct-");
  const path = isAccountId ? `/dashboard/state?account_id=${encodeURIComponent(accountIdOrToken ?? "")}` : "/dashboard/state";
  const data = await request<DashboardState>(path, undefined, accessTokenOverride ?? (isAccountId ? undefined : accountIdOrToken));
  return normalizeDashboardState(data);
}

export async function runPlanner(
  accountIdOrInteraction: string,
  interactionOrToken?: string,
  objectiveOrToken?: string,
  accessTokenOverride?: string,
  forceNew = false,
): Promise<AgentRunResult> {
  const isAccountId = accountIdOrInteraction.startsWith("acct-");
  const accountId = isAccountId ? accountIdOrInteraction : "";
  const interaction = isAccountId ? interactionOrToken ?? "" : accountIdOrInteraction;
  const objective = isAccountId ? objectiveOrToken ?? "" : "";
  const accessToken = accessTokenOverride ?? (isAccountId ? undefined : interactionOrToken);
  return request<AgentRunResult>("/agent/run", {
    method: "POST",
    body: JSON.stringify({
      account_id: accountId,
      interaction,
      objective: objective.trim() || interaction.split("\n")[0]?.trim() || "Review a new business objective.",
      force_new: forceNew,
    }),
  }, accessToken);
}

export async function getPlannerRuns(accessToken: string): Promise<PlannerRunCase[]> {
  const data = await request<{ runs: PlannerRunCase[] }>("/agent/runs", undefined, accessToken);
  return data.runs ?? [];
}

export async function getStrategyProfile(accessToken: string): Promise<StrategyProfile> {
  return request<StrategyProfile>("/strategy/profile", undefined, accessToken);
}

export async function reviewRecommendation(id: string, decision: "approved" | "rejected", accessToken?: string) {
  return request(`/recommendations/${id}/review`, {
    method: "POST",
    body: JSON.stringify({
      decision,
      reviewer: "reviewer@company.example",
      notes: decision === "approved" ? "Accepted during human review." : "Rejected during human review.",
    }),
  }, accessToken);
}

export async function uploadDocument(file: File, accessTokenOrAccountId: string, collection?: SourceCollection, sourceType = "uploaded_document") {
  const formData = new FormData();
  formData.append("file", file);
  const isAccountId = accessTokenOrAccountId.startsWith("acct-");
  formData.append("account_id", isAccountId ? accessTokenOrAccountId : "");
  formData.append("source_type", sourceType);
  if (collection) formData.append("collection", collection);

  const response = await fetch(`${API_URL}/ingest/upload`, {
    method: "POST",
    headers: {
      ...(isAccountId ? storedAccessToken() ? { Authorization: `Bearer ${storedAccessToken()}` } : {} : { Authorization: `Bearer ${accessTokenOrAccountId}` }),
    },
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`Upload failed: ${response.status}`);
  }

  return response.json();
}

export async function saveBusinessProfile(content: string, accessToken: string) {
  return request("/business/profile", {
    method: "POST",
    body: JSON.stringify({ content }),
  }, accessToken);
}

export async function saveBlueprintConfiguration(payload: BlueprintConfigurationPayload, accessToken: string) {
  return request<{ account_id: string; account_name: string; rows: Record<string, number> }>("/business/blueprint", {
    method: "POST",
    body: JSON.stringify(payload),
  }, accessToken);
}

export async function getWorkspaceData(accessToken: string): Promise<WorkspaceData> {
  return request<WorkspaceData>("/workspace/data", undefined, accessToken);
}

export async function createWorkspaceItem(kind: string, data: Record<string, unknown>, accessToken: string) {
  return request(`/workspace/items/${kind}`, {
    method: "POST",
    body: JSON.stringify({ data }),
  }, accessToken);
}

export async function updateWorkspaceItem(kind: string, id: string, data: Record<string, unknown>, accessToken: string) {
  return request(`/workspace/items/${kind}/${id}`, {
    method: "PUT",
    body: JSON.stringify({ data }),
  }, accessToken);
}

export async function deleteWorkspaceItem(kind: string, id: string, accessToken: string) {
  return request(`/workspace/items/${kind}/${id}`, {
    method: "DELETE",
  }, accessToken);
}

export async function askMemory(question: string, accessToken: string): Promise<MemoryQueryResponse> {
  return request<MemoryQueryResponse>("/memory/query", {
    method: "POST",
    body: JSON.stringify({
      entity_type: "account",
      entity_id: "",
      question,
    }),
  }, accessToken);
}

export async function createSourceEntry(payload: {
  account_id: string;
  collection: SourceCollection;
  source_type: string;
  title: string;
  content: string;
  fields: Record<string, unknown>;
}) {
  return request<{ entry: SourceEntry }>("/sources", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function runBGV(accountId: string, candidateId: string): Promise<BGVResult> {
  return request<BGVResult>(`/candidates/${accountId}/${candidateId}/bgv`, { method: "POST" });
}

export async function guideChat(payload: {
  account_id: string;
  current_view: string;
  visible_context: Record<string, unknown>;
  messages: GuideMessage[];
  question: string;
}): Promise<GuideChatResponse> {
  return request<GuideChatResponse>("/guide/chat", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function getIntelligenceBriefs(accessToken?: string): Promise<IntelligenceBriefsResponse> {
  return request<IntelligenceBriefsResponse>("/intelligence/briefs", undefined, accessToken);
}

export async function suggestBlueprint(payload: {
  account_text: string;
  domain: BusinessDomain;
  blueprint_title: string;
}): Promise<BlueprintSuggestionResponse> {
  return request<BlueprintSuggestionResponse>("/blueprints/suggest", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function suggestBlueprintOptions(payload: {
  account_text: string;
  domain: BusinessDomain;
  category: BlueprintBuilderKey;
  instruction: string;
  selected_options: string[];
}): Promise<BlueprintOptionResponse> {
  return request<BlueprintOptionResponse>("/blueprints/options", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function createBlueprintAccount(payload: {
  account_text: string;
  domain: BusinessDomain;
  name: string;
  segment: string;
  description: string;
  primary_user: string;
  supports_candidates: boolean;
  selections: Record<BlueprintBuilderKey, string[]>;
}): Promise<{ account: AccountSummary }> {
  return request<{ account: AccountSummary }>("/accounts", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
