from __future__ import annotations

from io import BytesIO
from pathlib import Path
from datetime import datetime
from typing import Any

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from app.agents.workflow import Flow360Workflow
from app.config import get_settings
from app.models import (
    AgentRunRequest,
    AuthLoginRequest,
    AuthSession,
    AuthSignupRequest,
    BlueprintCreateAccountRequest,
    BlueprintConfigurationRequest,
    BlueprintOptionRequest,
    BlueprintSuggestionRequest,
    BusinessProfileRequest,
    Evidence,
    GuideChatRequest,
    MemoryCard,
    MemoryQueryRequest,
    RecommendationReviewRequest,
    SourceEntryRequest,
    TextIngestRequest,
    WorkspaceItemRequest,
)
from app.services.embeddings import EmbeddingService
from app.services.groq_client import GroqRouter
from app.services.store import PlatformStore


settings = get_settings()
embeddings = EmbeddingService(settings)
store = PlatformStore(settings, embeddings)
llm = GroqRouter(settings)
workflow = Flow360Workflow(settings, store, llm)

app = FastAPI(title="Flow360 Workforce Next Best Action API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def current_session(authorization: str | None = Header(default=None)) -> AuthSession:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token.")
    token = authorization.split(" ", 1)[1].strip()
    session = store.session_from_access_token(token)
    if not session:
        raise HTTPException(status_code=401, detail="Invalid or expired session.")
    return AuthSession(**session)


@app.get("/health")
def health() -> dict[str, str | bool]:
    return {
        "status": "ok",
        "mode": "live" if store.live_mode else "offline",
        "groq_enabled": llm.enabled,
        "supabase_enabled": store.live_mode,
    }


@app.get("/dashboard/state")
def dashboard_state(account_id: str | None = None, session: AuthSession = Depends(current_session)) -> dict:
    if account_id and account_id != session.account.id:
        raise HTTPException(status_code=403, detail="You cannot access another company workspace.")
    return store.dashboard_state(session.account.id)


@app.get("/accounts")
def list_accounts(session: AuthSession = Depends(current_session)):
    return {"accounts": [store.get_account(session.account.id).model_dump(mode="json")]}


@app.post("/accounts")
def create_account(payload: BlueprintCreateAccountRequest, session: AuthSession = Depends(current_session)):
    return store.create_account_from_blueprint(
        name=payload.name,
        segment=payload.segment,
        domain=payload.domain,
        description=payload.description,
        primary_user=payload.primary_user,
        supports_candidates=payload.supports_candidates,
        account_text=payload.account_text,
        selections=payload.selections,
    )


@app.post("/blueprints/suggest")
def suggest_blueprint(payload: BlueprintSuggestionRequest, session: AuthSession = Depends(current_session)):
    return _fallback_blueprint(payload.account_text, payload.domain, payload.blueprint_title)


@app.post("/blueprints/options")
def suggest_blueprint_options(payload: BlueprintOptionRequest, session: AuthSession = Depends(current_session)):
    return {"options": _fallback_options_for(payload.category, payload.domain, payload.account_text)}


@app.post("/auth/signup", response_model=AuthSession)
def signup(payload: AuthSignupRequest):
    try:
        return store.create_company_account(payload.company_name, payload.industry, payload.email, payload.password)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/auth/login", response_model=AuthSession)
def login(payload: AuthLoginRequest):
    session = store.authenticate_company_account(payload.email, payload.password)
    if not session:
        raise HTTPException(status_code=401, detail="Invalid email or password.")
    return session


@app.get("/sources/{account_id}")
def list_sources(account_id: str, collection: str | None = None, session: AuthSession = Depends(current_session)):
    if account_id != session.account.id:
        raise HTTPException(status_code=403, detail="You cannot access another company workspace.")
    return {"sources": [entry.model_dump(mode="json") for entry in store.list_source_entries(account_id, collection)]}


@app.post("/sources")
def create_source_entry(payload: SourceEntryRequest, session: AuthSession = Depends(current_session)):
    return store.ingest_source_entry(
        account_id=payload.account_id or session.account.id,
        collection=payload.collection,
        source_type=payload.source_type,
        title=payload.title,
        content=payload.content,
        fields=payload.fields,
    )


@app.post("/ingest/text")
def ingest_text(payload: TextIngestRequest, session: AuthSession = Depends(current_session)):
    return store.ingest_text(session.account.id, payload.title, payload.content, payload.source_type)


@app.post("/business/profile")
def save_business_profile(payload: BusinessProfileRequest, session: AuthSession = Depends(current_session)):
    content = payload.content.strip()
    if len(content) < 40:
        raise HTTPException(status_code=400, detail="Business profile needs at least 40 characters.")
    document = store.ingest_text(
        session.account.id,
        f"{session.account.name} - Approved Business Profile",
        content,
        "business_profile",
    )
    memory = {
        "id": f"mem-profile-{session.account.id}",
        "entity_type": "account",
        "entity_id": session.account.id,
        "title": "Approved Business Profile",
        "memory_type": "profile",
        "summary": content[:900],
        "confidence": 96,
        "metadata": {"approved_by_user": True, "source": "business_profile_form"},
        "updated_at": datetime.utcnow().isoformat(),
    }
    if store.client:
        store.client.table("memory_cards").upsert(memory).execute()
    return {"document": document.model_dump(), "memory": memory}


@app.post("/business/blueprint")
def save_blueprint_configuration(payload: BlueprintConfigurationRequest, session: AuthSession = Depends(current_session)):
    try:
        return store.apply_blueprint_configuration(session.account.id, payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/workspace/data")
def workspace_data(session: AuthSession = Depends(current_session)):
    return store.list_workspace_data(session.account.id)


@app.post("/workspace/items/{kind}")
def create_workspace_item(kind: str, payload: WorkspaceItemRequest, session: AuthSession = Depends(current_session)):
    try:
        return store.create_workspace_item(session.account.id, kind, payload.data)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.put("/workspace/items/{kind}/{item_id}")
def update_workspace_item(
    kind: str,
    item_id: str,
    payload: WorkspaceItemRequest,
    session: AuthSession = Depends(current_session),
):
    try:
        return store.update_workspace_item(session.account.id, kind, item_id, payload.data)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.delete("/workspace/items/{kind}/{item_id}")
def delete_workspace_item(kind: str, item_id: str, session: AuthSession = Depends(current_session)):
    store.delete_workspace_item(session.account.id, kind, item_id)
    return {"deleted": True}


@app.post("/ingest/upload")
async def ingest_upload(
    file: UploadFile = File(...),
    account_id: str = Form(""),
    source_type: str = Form("uploaded_document"),
    collection: str = Form("knowledge"),
    session: AuthSession = Depends(current_session),
):
    content = await file.read()
    text = _extract_text(file.filename or "uploaded-file", content)
    if not text.strip():
        raise HTTPException(status_code=400, detail="Could not extract text from uploaded file.")
    target_account = account_id or session.account.id
    if target_account != session.account.id:
        raise HTTPException(status_code=403, detail="You cannot ingest into another company workspace.")
    return store.ingest_source_entry(
        account_id=target_account,
        collection=collection,
        source_type=source_type,
        title=file.filename or "uploaded-file",
        content=text,
        fields={"filename": file.filename or "uploaded-file"},
    )


@app.post("/agent/run")
def run_agent(payload: AgentRunRequest, session: AuthSession = Depends(current_session)):
    payload.account_id = payload.account_id or session.account.id
    intake_text = payload.interaction or ""
    objective_text = payload.objective.strip()
    if len(objective_text) < 8:
        raise HTTPException(status_code=400, detail="Planner runs require a specific business objective.")
    if len(intake_text.strip()) < 10:
        raise HTTPException(status_code=400, detail="Planner runs require intake context for the business objective.")
    if not payload.force_new:
        duplicate = store.find_duplicate_run(session.account.id, objective_text, intake_text)
        if duplicate:
            result = store.planner_run_result(duplicate["id"], session.account.id)
            if result:
                result["duplicate_of"] = duplicate["id"]
                return result
    payload.objective = objective_text
    return workflow.run(payload)


@app.get("/agent/runs")
def list_runs(session: AuthSession = Depends(current_session)):
    return {"runs": store.list_planner_runs(session.account.id)}


@app.get("/agent/runs/{run_id}")
def get_run(run_id: str, session: AuthSession = Depends(current_session)):
    run = store.planner_run_result(run_id, session.account.id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found.")
    return run


@app.get("/strategy/profile")
def strategy_profile(session: AuthSession = Depends(current_session)):
    return store.get_strategy_profile(session.account.id)


@app.get("/recommendations")
def list_recommendations(session: AuthSession = Depends(current_session)):
    return {"recommendations": store.list_recommendations(session.account.id)}


@app.post("/recommendations/{recommendation_id}/review")
def review_recommendation(
    recommendation_id: str,
    payload: RecommendationReviewRequest,
    session: AuthSession = Depends(current_session),
):
    rec_account_id = store.recommendation_account_id(recommendation_id)
    if rec_account_id and rec_account_id != session.account.id:
        raise HTTPException(status_code=404, detail="Recommendation not found for this company.")
    try:
        return store.review_recommendation(recommendation_id, payload.decision, payload.reviewer, payload.notes)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/intelligence/briefs")
def intelligence_briefs(session: AuthSession = Depends(current_session)):
    return {"mode": "live" if store.live_mode else "offline", "accounts": [_generate_account_intelligence(session.account.id)]}


@app.get("/intelligence/accounts/{account_id}")
def account_intelligence(account_id: str, session: AuthSession = Depends(current_session)):
    if account_id != session.account.id:
        raise HTTPException(status_code=403, detail="You cannot access another company workspace.")
    return _generate_account_intelligence(account_id)


@app.get("/candidates/{account_id}")
def list_candidates(account_id: str, session: AuthSession = Depends(current_session)):
    if account_id != session.account.id:
        raise HTTPException(status_code=403, detail="You cannot access another company workspace.")
    return {"candidates": [candidate.model_dump(mode="json") for candidate in store.list_candidates(account_id)]}


@app.post("/candidates/{account_id}/{candidate_id}/bgv")
def run_bgv(account_id: str, candidate_id: str, session: AuthSession = Depends(current_session)):
    if account_id != session.account.id:
        raise HTTPException(status_code=403, detail="You cannot access another company workspace.")
    return store.run_bgv_check(account_id, candidate_id)


@app.get("/memory/{entity_type}/{entity_id}")
def get_memory(entity_type: str, entity_id: str, session: AuthSession = Depends(current_session)):
    return {"memory": [item.model_dump(mode="json") for item in store.get_memory(entity_type, session.account.id)]}


@app.post("/memory/query")
def query_memory(payload: MemoryQueryRequest, session: AuthSession = Depends(current_session)):
    memories = store.get_memory(payload.entity_type, session.account.id)
    evidence = store.retrieve_context(payload.question, account_id=session.account.id, top_k=5)
    answer, confidence, mode = _answer_memory_query(payload.question, memories, evidence)
    return {
        "answer": answer,
        "confidence": confidence,
        "memory_used": [item.model_dump(mode="json") for item in memories[:5]],
        "evidence_used": [item.model_dump(mode="json") for item in evidence[:4]],
        "mode": mode,
    }


@app.post("/guide/chat")
def guide_chat(payload: GuideChatRequest, session: AuthSession = Depends(current_session)):
    account = store.get_account(payload.account_id or session.account.id)
    context = payload.visible_context or {}
    source_counts = context.get("source_counts") or {}
    recommendations = context.get("recommendations") or []
    count_text = ""
    if isinstance(source_counts, dict) and source_counts:
        count_text = ", ".join(f"{key}: {value}" for key, value in source_counts.items())
    if payload.current_view == "today":
        answer = (
            "Start with the highest-urgency account, then open the recommended next screen. "
            "Check what changed, add any missing source context, and run the planner only when the intake represents a real business objective."
        )
    elif payload.current_view in {"crm", "interactions", "knowledge", "risks", "candidates"}:
        answer = (
            f"On this screen, save one useful source entry for {account.name}. "
            "Pending imports are only drafts until saved. After saving, it becomes account memory and can change the next recommendations."
        )
    elif payload.current_view == "execution":
        answer = "Approve a recommendation first, then use Execution to copy the customer email, task, escalation note, risk update, or meeting summary."
    else:
        answer = (
            f"For {account.name}, review the visible recommendations, confirm owner and due date, then approve only the action you want executed. "
            f"Visible source coverage: {count_text or 'no source counts available'}. "
            f"Visible actions: {len(recommendations) if isinstance(recommendations, list) else 0}."
        )
    return {
        "answer": answer,
        "suggestions": _guide_suggestions(payload.current_view),
        "confidence": 82,
        "mode": "live" if store.live_mode else "offline",
    }


def _answer_memory_query(question: str, memories: list[MemoryCard], evidence: list[Evidence]) -> tuple[str, int, str]:
    memory_context = "\n".join(
        f"- {item.memory_type}: {item.title} ({item.confidence}%): {item.summary}" for item in memories[:8]
    )
    evidence_context = "\n".join(
        f"- {item.source_title} [{item.source_type}, relevance {item.relevance:.2f}]: {item.snippet}"
        for item in evidence[:6]
    )
    fallback_context = memory_context or evidence_context or "No persistent memory is available yet."
    fallback = (
        "No persistent business memory is available yet. Add approved account context, operating constraints, source documents, "
        "and review feedback before asking for recommendations."
    )
    if fallback_context != "No persistent memory is available yet.":
        first_line = fallback_context.splitlines()[0].lstrip("- ")
        fallback = f"Based on persistent memory, the strongest signal is: {first_line}"

    if not llm.enabled:
        return fallback, 74, "offline"

    system = (
        "You answer questions for account managers using only the provided persistent memory and evidence. "
        "Be concise, operational, and cite the memory/evidence titles in plain language. "
        "If context is missing, say what is missing and recommend the next data to capture. "
        "Do not mention model providers or implementation details."
    )
    user = f"""Question:
{question}

Persistent memory:
{memory_context or "None"}

Retrieved evidence:
{evidence_context or "None"}

Return a short answer with 2-4 concrete bullets or sentences."""
    result = llm.complete(system=system, user=user, model=settings.groq_fast_model, temperature=0.1, max_tokens=650)
    if not result or not result.content.strip():
        return fallback, 74, "offline"

    base_confidence = 78
    if memories:
        base_confidence = max(base_confidence, round(sum(item.confidence for item in memories[:5]) / min(len(memories), 5)))
    if evidence:
        base_confidence = min(92, base_confidence + 4)
    return result.content.strip(), base_confidence, "live"


def _fallback_options_for(category: str, domain: str, account_text: str = "") -> list[str]:
    options = {
        "healthcare_staffing": {
            "source_types": ["CRM account profile", "Meeting notes", "Email thread", "Candidate profile", "Credentialing checklist", "SLA breach note"],
            "memory_types": ["Account profile", "Stakeholder preference", "Credentialing rule", "SLA incident", "Candidate clearance"],
            "business_rules": ["Do not mark uncleared candidates as ready", "Escalate premium rates above policy threshold", "Require evidence for replacement guarantees"],
            "recommendation_categories": ["Credentialing escalation", "Shortlist delivery", "Rate approval", "Replacement coverage"],
            "success_metrics": ["Candidate clearance speed", "SLA breach risk", "Approval turnaround", "Start-date adherence"],
            "agents_enabled": ["Planner", "Evidence lookup", "Business analysis", "Recommendation", "BGV/Credentialing", "Memory update"],
        },
        "saas_customer_success": {
            "source_types": ["CRM renewal record", "QBR notes", "Support ticket summary", "Usage snapshot", "Executive email"],
            "memory_types": ["Account profile", "Stakeholder memory", "Incident history", "Adoption pattern", "Renewal risk"],
            "business_rules": ["Red renewals inside 90 days need a save plan", "Technical blockers need named owners", "Executive complaints require visible follow-up"],
            "recommendation_categories": ["Renewal save plan", "Product escalation", "Adoption play", "Executive alignment"],
            "success_metrics": ["Renewal risk movement", "Open blocker reduction", "Adoption lift", "Executive sentiment"],
            "agents_enabled": ["Planner", "Evidence lookup", "Risk analysis", "Adoption analysis", "Recommendation", "Memory update"],
        },
        "energy_field_service": {
            "source_types": ["Dispatch log", "Outage incident", "Safety checklist", "Technician roster", "Maintenance contract note"],
            "memory_types": ["Asset memory", "Safety rule", "Outage episode", "Technician coverage", "Customer commitment"],
            "business_rules": ["Safety-critical outages outrank routine maintenance", "Missing certified coverage triggers escalation", "Repeat SLA misses increase renewal risk"],
            "recommendation_categories": ["Dispatch escalation", "Safety approval", "Maintenance reschedule", "Renewal-risk mitigation"],
            "success_metrics": ["Outage recovery time", "Safety compliance", "Technician coverage", "SLA breach risk"],
            "agents_enabled": ["Planner", "Evidence lookup", "Field risk analysis", "Safety analysis", "Recommendation", "Memory update"],
        },
    }
    return options.get(domain, options["healthcare_staffing"]).get(category, [])


def _fallback_blueprint(account_text: str, domain: str, blueprint_title: str) -> dict[str, Any]:
    text = account_text.strip()
    first_line = text.splitlines()[0].strip() if text else ""
    name = first_line[:64] if first_line else f"New {blueprint_title} Account"
    return {
        "account": {
            "name": name,
            "segment": blueprint_title,
            "description": text[:280] or f"New account configured for {blueprint_title.lower()} workflows.",
            "primary_user": {
                "healthcare_staffing": "Staffing Account Manager",
                "saas_customer_success": "Customer Success Manager",
                "energy_field_service": "Field Operations Manager",
            }.get(domain, "Account Manager"),
            "supports_candidates": domain == "healthcare_staffing",
            "domain": domain,
        },
        "options": {
            key: _fallback_options_for(key, domain, account_text)
            for key in ["source_types", "memory_types", "business_rules", "recommendation_categories", "success_metrics", "agents_enabled"]
        },
    }


def _priority_from_health(health: str) -> str:
    lowered = health.lower()
    if lowered in {"red", "critical"}:
        return "critical"
    if lowered in {"amber", "watch", "high"}:
        return "high"
    return "medium"


def _generate_account_intelligence(account_id: str) -> dict[str, Any]:
    account = store.get_account(account_id)
    recommendations = store.list_recommendations(account_id)
    sources = {
        collection: store.list_source_entries(account_id, collection)
        for collection in ["crm", "interactions", "knowledge", "risks", "candidates"]
    }
    candidates = store.list_candidates(account_id)
    total_sources = sum(len(items) for items in sources.values())
    approved = sum(1 for item in recommendations if item.get("status") == "approved")
    rejected = sum(1 for item in recommendations if item.get("status") == "rejected")
    pending = sum(1 for item in recommendations if item.get("status") == "pending")
    blocked_candidates = sum(1 for item in candidates if item.missing_items or "pending" in item.credentialing_status.lower())
    evidence_coverage = "strong" if total_sources >= 10 else "moderate" if total_sources >= 5 else "thin"
    metrics = [
        {
            "label": "SLA breach risk movement",
            "before": "Elevated",
            "after": "Actionable" if recommendations else "Needs plan",
            "delta": f"{len(recommendations)} action paths",
            "rationale": "Recommendations convert account risk into owner-led next steps.",
        },
        {
            "label": "Approval time saved",
            "before": f"{pending} pending",
            "after": f"{approved} approved, {rejected} rejected",
            "delta": "reviewable queue",
            "rationale": "Human decisions are tracked so the same recommendation is not repeatedly reviewed.",
        },
        {
            "label": "Evidence coverage",
            "before": "Scattered context",
            "after": evidence_coverage,
            "delta": f"{total_sources} saved sources",
            "rationale": "CRM, meetings, knowledge, risks, and candidate records are counted as evidence inputs.",
        },
        {
            "label": "Memory freshness",
            "before": "Manual recall",
            "after": "Stored account memory",
            "delta": f"{len(store.get_memory('account', account_id))} cards",
            "rationale": "Saved sources and review decisions become reusable account memory.",
        },
    ]
    if account.supports_candidates:
        metrics.append(
            {
                "label": "Candidate clearance speed",
                "before": f"{blocked_candidates} blockers",
                "after": "BGV-ready queue" if candidates and not blocked_candidates else "Needs credentialing review",
                "delta": f"{len(candidates)} candidates tracked",
                "rationale": "Credentialing and BGV status prevents uncleared candidates from being treated as ready.",
            }
        )
    score = max(30, min(94, 52 + total_sources * 2 + approved * 5 - blocked_candidates * 4))
    escalation_items = []
    for item in recommendations[:5]:
        evidence = item.get("evidence") or []
        escalation_items.append(
            {
                "title": item.get("title", "Escalation required"),
                "owner": item.get("owner_role", "Account owner"),
                "role": item.get("owner_role", "Account owner"),
                "deadline": item.get("due_date", "Next business day"),
                "reason": item.get("rationale", "Recommendation needs human follow-through."),
                "evidence": [ev.get("source_title", "Linked account evidence") for ev in evidence[:3]],
                "channel": "Customer email" if item.get("priority") in {"critical", "high"} else "CRM task",
                "priority": item.get("priority", _priority_from_health(account.health)),
            }
        )
    if not escalation_items:
        escalation_items.append(
            {
                "title": f"Review {account.name} source coverage",
                "owner": account.primary_user,
                "role": account.primary_user,
                "deadline": "Today",
                "reason": "No active planner recommendation exists yet for this account.",
                "evidence": [f"{total_sources} saved sources", account.description],
                "channel": "Internal task",
                "priority": _priority_from_health(account.health),
            }
        )
    return {
        "account_id": account.id,
        "account_name": account.name,
        "outcomes": {
            "headline": f"{account.name} has {evidence_coverage} evidence coverage and {len(recommendations)} active decision paths.",
            "overall_score": score,
            "confidence": min(94, 62 + total_sources * 2),
            "projected_impact": "Clearer owners, faster approvals, and fewer missed follow-ups.",
            "metrics": metrics,
        },
        "escalations": escalation_items,
    }


def _guide_suggestions(current_view: str) -> list[str]:
    return {
        "today": ["Open the highest urgency account", "Check missing context", "Run Planner for a new objective"],
        "accounts": ["View workspace", "Review health", "Open Planner"],
        "dashboard": ["Review evidence", "Approve one action", "Open Execution"],
        "outcomes": ["Read impact", "Open Escalation Radar", "Check evidence coverage"],
        "escalations": ["Confirm owner", "Copy escalation note", "Open account"],
        "execution": ["Copy customer email", "Create CRM task", "Update risk register"],
        "memory": ["Check freshness", "Open source tabs", "Ask about missing context"],
    }.get(current_view, ["Add source data", "Run Planner", "Ask what changed"])


def _extract_text(filename: str, content: bytes) -> str:
    suffix = Path(filename).suffix.lower()
    if suffix == ".pdf":
        try:
            from pypdf import PdfReader

            reader = PdfReader(BytesIO(content))
            return "\n".join(page.extract_text() or "" for page in reader.pages)
        except Exception:
            return ""
    if suffix in {".docx", ".doc"}:
        try:
            import tempfile

            import docx2txt

            with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp:
                temp.write(content)
                temp_path = temp.name
            return docx2txt.process(temp_path) or ""
        except Exception:
            return ""
    return content.decode("utf-8", errors="ignore")
