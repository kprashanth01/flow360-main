from __future__ import annotations

import json
import re
import uuid
from datetime import date, datetime, timedelta
from typing import Any, TypedDict

from app.config import Settings
from app.models import AgentRunRequest, AgentRunResult, AgentStep, Evidence, Recommendation
from app.services.groq_client import GroqRouter
from app.services.retrieval import EnterpriseRetriever
from app.services.store import PlatformStore


class FlowState(TypedDict, total=False):
    run_id: str
    account_id: str
    account_name: str
    objective: str
    interaction: str
    plan: list[str]
    retrieved_context: list[Evidence]
    analysis: dict[str, Any]
    recommendations: list[Recommendation]
    memory_updates: list[dict[str, Any]]
    agent_trace: list[AgentStep]
    strategy_profile: dict[str, Any]


class Flow360Workflow:
    def __init__(self, settings: Settings, store: PlatformStore, llm: GroqRouter):
        self.settings = settings
        self.store = store
        self.retriever = EnterpriseRetriever(store)
        self.llm = llm
        self.graph = self._build_graph()

    def run(self, request: AgentRunRequest) -> AgentRunResult:
        account = self.store.get_account(request.account_id)
        state: FlowState = {
            "run_id": f"run-{uuid.uuid4().hex[:10]}",
            "account_id": account.id,
            "account_name": account.name,
            "objective": request.objective,
            "interaction": request.interaction or request.objective,
            "strategy_profile": self.store.get_strategy_profile(account.id),
            "agent_trace": [],
        }

        if self.graph:
            final_state = self.graph.invoke(state)
        else:
            final_state = state
            for node in [
                self._planner_node,
                self._ingestion_node,
                self._retrieval_node,
                self._analysis_node,
                self._recommendation_node,
                self._memory_node,
            ]:
                final_state = node(final_state)

        result = AgentRunResult(
            run_id=final_state["run_id"],
            account_id=final_state["account_id"],
            account_name=final_state["account_name"],
            objective=request.objective,
            title=self._case_title(request.objective, request.interaction),
            status="completed",
            analysis=final_state.get("analysis", {}),
            recommendations=final_state.get("recommendations", []),
            agent_trace=final_state.get("agent_trace", []),
            retrieved_context=final_state.get("retrieved_context", []),
            memory_updates=final_state.get("memory_updates", []),
            mode="live" if self.llm.enabled and self.store.live_mode else "offline",
        )
        self.store.save_run(
            result.run_id,
            {
                "account_id": result.account_id,
                "objective": request.objective,
                "analysis": result.analysis,
                "agent_trace": [step.model_dump(mode="json") for step in result.agent_trace],
                "recommendation_ids": [item.id for item in result.recommendations],
                "metadata": {
                    "title": result.title,
                    "intake_text": request.interaction or "",
                    "intake_hash": self.store.intake_hash(request.objective, request.interaction or ""),
                    "retrieved_context": [item.model_dump(mode="json") for item in result.retrieved_context],
                    "memory_updates": result.memory_updates,
                    "strategy_profile": final_state.get("strategy_profile", {}),
                    "case_type": "manual",
                },
            },
        )
        self.store.save_recommendations(result.recommendations)
        self.store.ingest_text(
            result.account_id,
            f"Planner Run - {result.title}",
            self._run_memory_text(request, result),
            "planner_run",
        )
        return result

    @staticmethod
    def _case_title(objective: str, interaction: str | None) -> str:
        text = (interaction or objective).strip()
        first_line = text.splitlines()[0].strip() if text else objective.strip()
        if len(first_line) > 84:
            return f"{first_line[:81].rstrip()}..."
        return first_line or "Planner Run"

    @staticmethod
    def _run_memory_text(request: AgentRunRequest, result: AgentRunResult) -> str:
        recommendations = "\n".join(
            f"- {item.title}: {item.action} Owner: {item.owner_role}. Due: {item.due_date}. "
            f"Confidence: {item.confidence}%. Business impact: {item.business_metric}."
            for item in result.recommendations
        )
        evidence = "\n".join(
            f"- {item.source_title} [{item.source_type}]: {item.snippet}"
            for item in result.retrieved_context[:8]
        )
        trace = "\n".join(f"- {step.name}: {step.summary}" for step in result.agent_trace)
        analysis = json.dumps(result.analysis, indent=2, default=str)
        return f"""Planner Run ID: {result.run_id}
Status: {result.status}
Objective: {request.objective}
Intake:
{request.interaction or ""}

Retrieved evidence:
{evidence or "No evidence retrieved."}

Business analysis:
{analysis}

Generated recommendations:
{recommendations or "No recommendations generated."}

Execution trace:
{trace or "No trace captured."}

AI strategy profile:
{json.dumps(result.analysis.get("strategy_profile_applied", {}), indent=2, default=str)}

Learning rule: this planner run, its evidence, recommendations, review status, and later outcomes should inform future planner runs for this company."""

    def _build_graph(self):
        try:
            from langgraph.graph import END, StateGraph

            graph = StateGraph(FlowState)
            graph.add_node("planner", self._planner_node)
            graph.add_node("ingestion", self._ingestion_node)
            graph.add_node("retrieval", self._retrieval_node)
            graph.add_node("analysis", self._analysis_node)
            graph.add_node("recommendation", self._recommendation_node)
            graph.add_node("memory", self._memory_node)
            graph.set_entry_point("planner")
            graph.add_edge("planner", "ingestion")
            graph.add_edge("ingestion", "retrieval")
            graph.add_edge("retrieval", "analysis")
            graph.add_edge("analysis", "recommendation")
            graph.add_edge("recommendation", "memory")
            graph.add_edge("memory", END)
            return graph.compile()
        except Exception:
            return None

    def _append_trace(self, state: FlowState, name: str, summary: str, artifacts: list[str] | None = None) -> FlowState:
        trace = list(state.get("agent_trace", []))
        now = datetime.utcnow()
        trace.append(
            AgentStep(
                name=name,
                status="completed",
                summary=summary,
                artifacts=artifacts or [],
                started_at=now,
                completed_at=now,
            )
        )
        return {**state, "agent_trace": trace}

    def _planner_node(self, state: FlowState) -> FlowState:
        strategy = state.get("strategy_profile", {})
        plan = [
            "Extract operational signals from the customer interaction.",
            "Retrieve account history, playbooks, resources, rules, prior Planner Runs, and approved/rejected strategy memory.",
            "Analyze urgency, risk, missing information, business opportunity, and company-specific strategy preferences.",
            "Generate ranked next best actions with evidence, confidence, and personalization from approved plans.",
            "Prepare memory updates after human review.",
        ]
        level = strategy.get("personalization_level", "learning")
        return self._append_trace({**state, "plan": plan}, "Planner Agent", f"Selected a strategy-aware workflow with {level} personalization.", plan)

    def _ingestion_node(self, state: FlowState) -> FlowState:
        interaction = state["interaction"]
        self.store.ingest_text(
            account_id=state["account_id"],
            title=f"Interaction captured for {state['account_name']}",
            content=interaction,
            source_type="customer_interaction",
        )
        artifacts = ["customer_interaction", "deadline_signal", "stakeholder_signal", "compliance_signal"]
        return self._append_trace(state, "Ingestion Agent", "Parsed the interaction and stored it as raw and semantic memory.", artifacts)

    def _retrieval_node(self, state: FlowState) -> FlowState:
        strategy = state.get("strategy_profile", {})
        query = " ".join(
            [
                state["objective"],
                state["interaction"],
                " ".join(strategy.get("next_planner_guidance", [])),
                "approved rejected planner outcome strategy profile",
            ]
        )
        focus_terms = self._focus_terms(state)
        context = self._prioritize_evidence(
            self.retriever.search(query=query, account_id=state["account_id"], top_k=14),
            focus_terms,
        )[:8]
        source_names = [item.source_title for item in context[:5]]
        updated = {**state, "retrieved_context": context}
        return self._append_trace(updated, "Retrieval Agent", "Retrieved account, candidate, policy, and playbook evidence.", source_names)

    def _analysis_node(self, state: FlowState) -> FlowState:
        context_payload = [item.model_dump() for item in state.get("retrieved_context", [])]
        focus_terms = self._focus_terms(state)
        fallback = self._focused_analysis_fallback(state, focus_terms)
        analysis = self.llm.complete_json(
            system=(
                "You are a business operations analyst. Return only strict JSON with account_health, urgency_score, "
                "risks, opportunities, missing_information, and decision_points. Analyze only the provided objective "
                "and intake. Apply the strategy_profile as company-specific personalization: approved patterns increase confidence "
                "when evidence matches, rejected patterns should be avoided or reframed. Do not introduce another customer or "
                "business case unless the objective asks for a portfolio-wide review."
            ),
            user=json.dumps(
                {
                    "objective": state.get("objective", ""),
                    "intake": state["interaction"],
                    "focus_terms": focus_terms,
                    "strategy_profile": state.get("strategy_profile", {}),
                    "context": context_payload,
                },
                indent=2,
            ),
            fallback=fallback,
            model=self.settings.groq_reasoning_model,
            temperature=0.15,
        )
        if not isinstance(analysis, dict):
            analysis = fallback
        analysis = self._sanitize_analysis(analysis, fallback, focus_terms)
        analysis["strategy_profile_applied"] = self._strategy_application_summary(state.get("strategy_profile", {}))
        updated = {**state, "analysis": analysis}
        return self._append_trace(updated, "Business Analyst Agent", "Identified renewal risk, compliance blockers, and missing buying context.", ["risk_map", "opportunity_map"])

    def _recommendation_node(self, state: FlowState) -> FlowState:
        evidence = state.get("retrieved_context", [])
        evidence_payload = [item.model_dump() for item in evidence]
        focus_terms = self._focus_terms(state)
        fallback = {"recommendations": self._focused_fallback_items(state, focus_terms)}
        generated = self.llm.complete_json(
            system=(
                "You create objective-specific business next best actions. Return strict JSON: "
                "{\"recommendations\": [...]}. Each item needs title, action, category, priority, owner_role, "
                "due_date, confidence, rationale, evidence_indexes, business_metric. Do not recommend work for a "
                "different customer, account, or objective unless the intake explicitly asks for a portfolio-wide plan. "
                "Use strategy_profile as a personalization contract: prefer patterns, owners, and evidence types from approved "
                "plans; avoid repeating rejected plans unless new evidence changes the recommendation. Mention this learning in "
                "rationale when it materially affects the action. Confidence must be an integer from 60 to 95. Due dates must be "
                "realistic future dates or short relative terms."
            ),
            user=json.dumps(
                {
                    "objective": state.get("objective", ""),
                    "intake": state.get("interaction", ""),
                    "focus_terms": focus_terms,
                    "strategy_profile": state.get("strategy_profile", {}),
                    "analysis": state.get("analysis", {}),
                    "evidence": evidence_payload,
                },
                indent=2,
            ),
            fallback=fallback,
            model=self.settings.groq_reasoning_model,
            temperature=0.18,
        )
        raw_items = generated.get("recommendations", []) if isinstance(generated, dict) else []
        raw_items = [item for item in raw_items if self._matches_focus(item, evidence, focus_terms)]
        if len(raw_items) < 3:
            raw_items.extend(fallback["recommendations"])
        recommendations: list[Recommendation] = []
        for index, item in enumerate(raw_items[:5]):
            evidence_items = self._select_evidence(evidence, item.get("evidence_indexes", []), focus_terms)
            priority = str(item.get("priority", "medium")).strip().lower()
            if priority not in {"critical", "high", "medium", "low"}:
                priority = "medium"
            try:
                confidence = int(float(item.get("confidence", 75)))
            except (TypeError, ValueError):
                confidence = 75
            confidence = max(60, min(95, confidence))
            recommendations.append(
                Recommendation(
                    id=f"rec-{state['run_id']}-{index + 1}",
                    account_id=state["account_id"],
                    run_id=state["run_id"],
                    title=item.get("title", "Next best action"),
                    action=item.get("action", ""),
                    category=item.get("category", "Workflow"),
                    priority=priority,
                    owner_role=item.get("owner_role", "Account Manager"),
                    due_date=self._normalize_due_date(item.get("due_date")),
                    confidence=confidence,
                    rationale=item.get("rationale", ""),
                    evidence=evidence_items,
                    business_metric=item.get("business_metric", "Improve account outcome."),
                )
            )

        updated = {**state, "recommendations": recommendations}
        return self._append_trace(updated, "Recommendation Agent", "Produced ranked next best actions with owners, due dates, confidence, and evidence.", [item.title for item in recommendations])

    def _memory_node(self, state: FlowState) -> FlowState:
        strategy = state.get("strategy_profile", {})
        memory_updates = [
            {
                "memory_type": "episodic",
                "target": state["account_id"],
                "summary": "Pending human review for generated business next best actions.",
            },
            {
                "memory_type": "profile",
                "target": state["account_id"],
                "summary": "Account remains renewal-sensitive until reliability, security, and implementation blockers are resolved.",
            },
            {
                "memory_type": "rule",
                "target": state["account_id"],
                "summary": f"AI strategy profile applied at {strategy.get('personalization_level', 'learning')} personalization level.",
            },
        ]
        updated = {**state, "memory_updates": memory_updates}
        return self._append_trace(updated, "Memory Agent", "Prepared episodic and profile memory updates for human-in-the-loop feedback.", ["episodic_memory", "profile_memory"])

    @classmethod
    def _select_evidence(cls, evidence: list[Evidence], indexes: list[Any], focus_terms: list[str]) -> list[Evidence]:
        selected: list[Evidence] = []
        for raw_index in indexes:
            try:
                index = int(raw_index)
            except (TypeError, ValueError):
                continue
            if 0 <= index < len(evidence):
                selected.append(evidence[index])
        candidate_pool = selected + evidence
        ranked = cls._prioritize_evidence(candidate_pool, focus_terms)
        durable: list[Evidence] = []
        intake: list[Evidence] = []
        for item in ranked:
            if item.source_type == "customer_interaction":
                intake.append(item)
            else:
                durable.append(item)
        final = durable[:3]
        if len(final) < 3 and intake:
            final.append(intake[0])
        return final[:3]

    @staticmethod
    def _prioritize_evidence(evidence: list[Evidence], focus_terms: list[str]) -> list[Evidence]:
        seen: set[str] = set()
        scored: list[tuple[float, int, Evidence]] = []
        for index, item in enumerate(evidence):
            dedupe_key = f"{item.source_title}|{item.snippet[:120]}".lower()
            if dedupe_key in seen:
                continue
            seen.add(dedupe_key)
            text = f"{item.source_title} {item.source_type} {item.snippet}".lower()
            focus_score = sum(2 for term in focus_terms if term.lower() in text)
            source_bonus = 0.0
            if item.source_type in {"crm_opportunity", "crm_account_profile", "email_thread", "policy", "document", "note"}:
                source_bonus += 0.35
            if item.source_type in {"customer_interaction", "planner_run", "planner_outcome"}:
                source_bonus -= 0.45
            scored.append((focus_score + source_bonus + item.relevance, -index, item))
        scored.sort(key=lambda row: row[:2], reverse=True)
        return [item for _, _, item in scored]

    @staticmethod
    def _focus_terms(state: FlowState) -> list[str]:
        text = f"{state.get('objective', '')}\n{state.get('interaction', '')}"
        candidates = re.findall(r"\b[A-Z][A-Za-z0-9]*(?:[A-Z][A-Za-z0-9]*)?\b", text)
        stopwords = {
            "Flow360",
            "Prevent",
            "Decide",
            "Determine",
            "Approve",
            "Before",
            "After",
            "Finance",
            "Customer",
            "Executive",
            "Procurement",
            "Recommend",
            "Planner",
            "Business",
            "Objective",
            "Intake",
            "Context",
            "July",
            "June",
            "September",
            "USD",
            "ARR",
            "CTO",
            "SLA",
            "RCA",
        }
        terms = []
        for item in candidates:
            if item in stopwords or len(item) < 4:
                continue
            if item not in terms:
                terms.append(item)
        return terms[:5]

    @staticmethod
    def _matches_focus(item: dict[str, Any], evidence: list[Evidence], focus_terms: list[str]) -> bool:
        if not focus_terms:
            return True
        text = " ".join(
            str(item.get(key, ""))
            for key in ["title", "action", "category", "owner_role", "rationale", "business_metric"]
        )
        lowered = text.lower()
        return any(term.lower() in lowered for term in focus_terms)

    @staticmethod
    def _normalize_due_date(value: Any) -> str:
        raw = str(value or "").strip()
        today = datetime.utcnow().date()
        if not raw:
            return (today + timedelta(days=1)).isoformat()
        try:
            parsed = date.fromisoformat(raw[:10])
            if parsed < today:
                return (today + timedelta(days=2)).isoformat()
            return parsed.isoformat()
        except ValueError:
            return raw

    @staticmethod
    def _sanitize_analysis(analysis: dict[str, Any], fallback: dict[str, Any], focus_terms: list[str]) -> dict[str, Any]:
        other_customers = {"nimbuspay", "orioncrm", "helioworks", "metrobank", "bluepeak"}
        focus = {term.lower() for term in focus_terms}
        blocked = other_customers - focus
        cleaned = dict(analysis)
        for key in ["risks", "opportunities", "missing_information", "decision_points"]:
            value = cleaned.get(key)
            if not isinstance(value, list):
                cleaned[key] = fallback.get(key, [])
                continue
            next_items = []
            for item in value:
                text = str(item)
                lowered = text.lower()
                if any(customer in lowered for customer in blocked):
                    continue
                next_items.append(text)
            if not next_items:
                next_items = list(fallback.get(key, []))
            cleaned[key] = next_items[:5]
        cleaned.setdefault("account_health", fallback.get("account_health", "watch"))
        cleaned.setdefault("urgency_score", fallback.get("urgency_score", 80))
        return cleaned

    @staticmethod
    def _focused_analysis_fallback(state: FlowState, focus_terms: list[str]) -> dict[str, Any]:
        target = focus_terms[0] if focus_terms else state.get("account_name", "the account")
        text = f"{state.get('objective', '')}\n{state.get('interaction', '')}".lower()
        if any(term in text for term in ["pricing", "discount", "bridge discount", "bluepeak"]):
            return {
                "account_health": f"watch: {target} pricing approval is time-sensitive and policy-dependent",
                "urgency_score": 84,
                "risks": [
                    "Pricing response may miss the customer deadline if the approval packet is incomplete.",
                    "Discount approval could be confused with SLA credit handling unless the terms are separated.",
                    "Revenue Operations may reject the exception if business impact, expiration, and owner approval are missing.",
                ],
                "opportunities": [
                    f"Protect the USD 480K premium support expansion with a policy-compliant bridge discount decision for {target}.",
                    "Use a clear approval brief to reduce procurement back-and-forth and speed final pricing.",
                ],
                "missing_information": [
                    "Confirmed business reason for the 7 percent bridge discount.",
                    "Expiration date and owner approval for the two-quarter discount.",
                    "Explicit language preserving SLA credit rights for verified outages.",
                ],
                "decision_points": [
                    "Whether Revenue Operations can approve the exception or must escalate to VP Revenue.",
                    "Whether final pricing should include separate SLA credit language before being sent to procurement.",
                ],
            }
        return {
            "account_health": f"watch: {target} objective requires focused follow-through",
            "urgency_score": 82,
            "risks": [
                f"{target} outcome may slip if owners and dates are not assigned.",
                "The business decision may be delayed if supporting evidence remains incomplete.",
            ],
            "opportunities": [
                f"Resolve the {target} objective with evidence-backed actions and clear owner accountability.",
                "Update memory with the human review outcome so future planner runs improve.",
            ],
            "missing_information": [
                "Final approval owner.",
                "Customer-facing deadline and acceptance criteria.",
                "Expected business impact.",
            ],
            "decision_points": [
                "Which recommendation should be approved for execution.",
                "What evidence must be attached before communicating the decision externally.",
            ],
        }

    @staticmethod
    def _strategy_application_summary(strategy: dict[str, Any]) -> dict[str, Any]:
        return {
            "personalization_level": strategy.get("personalization_level", "learning"),
            "approved_count": strategy.get("approved_count", 0),
            "rejected_count": strategy.get("rejected_count", 0),
            "preferred_patterns": strategy.get("preferred_patterns", [])[:3],
            "avoid_patterns": strategy.get("avoid_patterns", [])[:3],
            "owner_preferences": strategy.get("owner_preferences", [])[:3],
            "evidence_preferences": strategy.get("evidence_preferences", [])[:3],
        }

    @staticmethod
    def _focused_fallback_items(state: FlowState, focus_terms: list[str]) -> list[dict[str, Any]]:
        target = focus_terms[0] if focus_terms else state.get("account_name", "the account")
        today = datetime.utcnow().date()
        text = f"{state.get('objective', '')}\n{state.get('interaction', '')}".lower()
        if any(term in text for term in ["pricing", "discount", "bridge discount", "bluepeak"]):
            return [
                {
                    "title": f"Prepare {target} pricing exception packet",
                    "action": f"Document the discount amount, business reason, two-quarter expiration, approval owner, expected impact, and customer deadline for {target}.",
                    "category": "Pricing Approval",
                    "priority": "high",
                    "owner_role": "Revenue Operations",
                    "due_date": (today + timedelta(days=1)).isoformat(),
                    "confidence": 88,
                    "rationale": "The objective is a pricing approval decision, and policy requires clear reason, expiration, owner approval, and business impact.",
                    "evidence_indexes": [0, 1, 2],
                    "business_metric": "Protect USD 480K premium support expansion while keeping approval policy intact.",
                },
                {
                    "title": f"Separate {target} discount from SLA credit rights",
                    "action": f"Confirm that the bridge discount does not waive or replace any contractual SLA credit rights for {target}.",
                    "category": "Policy Control",
                    "priority": "high",
                    "owner_role": "Finance Operations",
                    "due_date": (today + timedelta(days=1)).isoformat(),
                    "confidence": 85,
                    "rationale": "The intake explicitly asks whether discount terms affect SLA credit rights, and policy says discounts should not replace verified outage credits.",
                    "evidence_indexes": [1, 2, 3],
                    "business_metric": "Avoid approval confusion between discretionary pricing and contractual credits.",
                },
                {
                    "title": f"Route {target} approval to the right revenue owner",
                    "action": f"Send the completed pricing exception brief to Revenue Operations and escalate to VP Revenue if the requested discount exceeds the standard threshold.",
                    "category": "Approval Path",
                    "priority": "medium",
                    "owner_role": "Revenue Operations",
                    "due_date": (today + timedelta(days=2)).isoformat(),
                    "confidence": 82,
                    "rationale": "The business decision needs an approval path before final pricing is sent to procurement.",
                    "evidence_indexes": [0, 2, 4],
                    "business_metric": "Accelerate pricing decision before the customer deadline.",
                },
            ]
        return [
            {
                "title": f"Deliver {target} recovery plan before the executive checkpoint",
                "action": f"Assign Customer Success, Support, and SRE owners to deliver an evidence-backed recovery plan for {target}, including milestones, customer impact, and approval asks.",
                "category": "Renewal Risk",
                "priority": "critical",
                "owner_role": "Customer Success Manager",
                "due_date": (today + timedelta(days=1)).isoformat(),
                "confidence": 90,
                "rationale": f"The objective is specifically about {target}, so the next best action must focus on the customer-facing recovery plan.",
                "evidence_indexes": [0, 1, 2],
                "business_metric": "Protect renewal confidence and reduce downgrade risk.",
            },
            {
                "title": f"Name technical owners for {target} incident prevention",
                "action": f"Name the incident commander, SRE owner, and product owner responsible for the technical prevention plan for {target}.",
                "category": "Incident Recovery",
                "priority": "high",
                "owner_role": "Support Lead",
                "due_date": (today + timedelta(days=1)).isoformat(),
                "confidence": 86,
                "rationale": "The intake asks for named owners, queue saturation mitigation, retry controls, and progress checkpoints.",
                "evidence_indexes": [1, 2, 3],
                "business_metric": "Increase executive confidence with accountable recovery ownership.",
            },
            {
                "title": f"Prepare {target} SLA credit approval packet",
                "action": f"Prepare the SLA credit decision packet for {target} with incident dates, SLA target, actual performance, customer impact, and Finance approval owner.",
                "category": "SLA Approval",
                "priority": "high",
                "owner_role": "Finance Operations",
                "due_date": (today + timedelta(days=2)).isoformat(),
                "confidence": 84,
                "rationale": "The intake says Finance requires documented SLA evidence before approving any credit.",
                "evidence_indexes": [2, 3, 4],
                "business_metric": "Separate contractual credit decisions from discretionary pricing concessions.",
            },
        ]
