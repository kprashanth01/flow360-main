from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


class Evidence(BaseModel):
    source_id: str
    source_title: str
    source_type: str
    snippet: str
    relevance: float = 0.0


class Recommendation(BaseModel):
    id: str
    account_id: str
    run_id: str
    title: str
    action: str
    category: str
    priority: Literal["critical", "high", "medium", "low"]
    owner_role: str
    due_date: str
    confidence: int = Field(ge=0, le=100)
    rationale: str
    evidence: list[Evidence]
    business_metric: str
    status: Literal["pending", "approved", "rejected"] = "pending"
    created_at: datetime = Field(default_factory=datetime.utcnow)


class AgentStep(BaseModel):
    name: str
    status: Literal["planned", "running", "completed", "skipped", "failed"] = "completed"
    summary: str
    artifacts: list[str] = Field(default_factory=list)
    started_at: datetime = Field(default_factory=datetime.utcnow)
    completed_at: datetime = Field(default_factory=datetime.utcnow)


class AgentRunRequest(BaseModel):
    account_id: str = ""
    interaction: str | None = None
    objective: str = "Recommend the next best actions for the account team."
    force_new: bool = False


class AgentRunResult(BaseModel):
    run_id: str
    account_id: str
    account_name: str
    objective: str = ""
    title: str = ""
    status: str = "completed"
    created_at: datetime | None = None
    duplicate_of: str | None = None
    analysis: dict[str, Any]
    recommendations: list[Recommendation]
    agent_trace: list[AgentStep]
    retrieved_context: list[Evidence]
    memory_updates: list[dict[str, Any]]
    mode: Literal["live", "offline"] = "offline"


BusinessDomain = Literal["healthcare_staffing", "saas_customer_success", "energy_field_service"]
SourceCollection = Literal["crm", "interactions", "knowledge", "risks", "candidates"]


class DashboardMetric(BaseModel):
    label: str
    value: str
    delta: str


class RiskTrendPoint(BaseModel):
    day: str
    risk: int = Field(ge=0, le=100)
    confidence: int = Field(ge=0, le=100)


class AccountSummary(BaseModel):
    id: str
    name: str
    segment: str
    domain: BusinessDomain = "healthcare_staffing"
    health: str = "unknown"
    renewal_date: str | None = None
    description: str = ""
    supports_candidates: bool = False
    primary_user: str = "Account Manager"
    metrics: list[DashboardMetric] = Field(default_factory=list)
    risk_trend: list[RiskTrendPoint] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class AuthSignupRequest(BaseModel):
    company_name: str
    industry: str
    email: str
    password: str


class AuthLoginRequest(BaseModel):
    email: str
    password: str


class AuthSession(BaseModel):
    account: AccountSummary
    email: str
    access_token: str
    refresh_token: str | None = None


class TextIngestRequest(BaseModel):
    account_id: str = ""
    title: str
    content: str
    source_type: str = "note"


class BusinessProfileRequest(BaseModel):
    content: str


class BlueprintConfigurationRequest(BaseModel):
    blueprint_id: str
    account_name: str
    segment: str
    primary_user: str
    description: str
    needs_candidate_workflow: bool = False
    source_types: list[str] = Field(default_factory=list)
    memory_types: list[str] = Field(default_factory=list)
    roles: list[dict[str, Any]] = Field(default_factory=list)
    business_rules: list[dict[str, Any]] = Field(default_factory=list)
    recommendation_categories: list[str] = Field(default_factory=list)
    success_metrics: list[dict[str, Any]] = Field(default_factory=list)
    agents_enabled: list[str] = Field(default_factory=list)


class BlueprintSuggestionRequest(BaseModel):
    account_text: str
    domain: BusinessDomain = "healthcare_staffing"
    blueprint_title: str = "Healthcare Staffing"


class BlueprintOptionRequest(BaseModel):
    account_text: str
    domain: BusinessDomain = "healthcare_staffing"
    category: str
    instruction: str
    selected_options: list[str] = Field(default_factory=list)


class BlueprintCreateAccountRequest(BaseModel):
    account_text: str
    domain: BusinessDomain = "healthcare_staffing"
    name: str
    segment: str
    description: str
    primary_user: str = "Account Manager"
    supports_candidates: bool = False
    selections: dict[str, list[str]] = Field(default_factory=dict)


class SourceEntry(BaseModel):
    id: str
    account_id: str
    collection: SourceCollection
    source_type: str
    title: str
    content: str
    fields: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class SourceEntryRequest(BaseModel):
    account_id: str
    collection: SourceCollection
    source_type: str = "manual_entry"
    title: str
    content: str
    fields: dict[str, Any] = Field(default_factory=dict)


class CandidateProfile(BaseModel):
    id: str
    account_id: str
    name: str
    role: str
    availability_date: str | None = None
    credentialing_status: str = "unknown"
    bgv_status: str = "not_started"
    fit_score: int = Field(ge=0, le=100, default=70)
    rate_variance_percent: float = 0
    missing_items: list[str] = Field(default_factory=list)
    risk_flags: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class BGVResult(BaseModel):
    candidate_id: str
    status: Literal["verified", "needs_review", "blocked"]
    score: int = Field(ge=0, le=100)
    summary: str
    missing_items: list[str] = Field(default_factory=list)
    evidence: list[Evidence] = Field(default_factory=list)


class GuideMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class GuideChatRequest(BaseModel):
    account_id: str
    current_view: str = "dashboard"
    visible_context: dict[str, Any] = Field(default_factory=dict)
    messages: list[GuideMessage] = Field(default_factory=list)
    question: str


class WorkspaceItemRequest(BaseModel):
    data: dict[str, Any]


class IngestResponse(BaseModel):
    document_id: str
    title: str
    chunks_created: int
    storage: Literal["supabase", "memory"]


class RecommendationReviewRequest(BaseModel):
    decision: Literal["approved", "rejected"]
    reviewer: str = "reviewer@company.example"
    notes: str = ""


class MemoryQueryRequest(BaseModel):
    entity_type: str = "account"
    entity_id: str = ""
    question: str


class MemoryCard(BaseModel):
    id: str
    entity_type: str
    entity_id: str
    title: str
    memory_type: Literal["raw", "semantic", "episodic", "profile", "rule"]
    summary: str
    confidence: int = Field(ge=0, le=100, default=80)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class MemoryQueryResponse(BaseModel):
    answer: str
    confidence: int = Field(ge=0, le=100, default=78)
    memory_used: list[MemoryCard] = Field(default_factory=list)
    evidence_used: list[Evidence] = Field(default_factory=list)
    mode: Literal["live", "offline"] = "offline"
