from __future__ import annotations

import math
import re
import uuid
import hashlib
from datetime import datetime
from typing import Any

from app.config import Settings
from app.models import (
    AccountSummary,
    BGVResult,
    CandidateProfile,
    DashboardMetric,
    Evidence,
    IngestResponse,
    MemoryCard,
    Recommendation,
    RiskTrendPoint,
    SourceEntry,
)
from app.services.embeddings import EmbeddingService
from app.services.llamaindex_adapter import chunk_text


class PlatformStore:
    def __init__(self, settings: Settings, embeddings: EmbeddingService):
        self.settings = settings
        self.embeddings = embeddings
        self.client = None
        self.storage_mode = "memory"
        self._documents: list[dict[str, Any]] = []
        self._chunks: list[dict[str, Any]] = []
        self._recommendations: dict[str, dict[str, Any]] = {}
        self._runs: dict[str, dict[str, Any]] = {}
        self._feedback: list[dict[str, Any]] = []
        self._demo_sessions: dict[str, dict[str, Any]] = {}
        self._memory_cards: dict[str, dict[str, Any]] = {}
        self._accounts: dict[str, dict[str, Any]] = {}
        self._source_entries: dict[str, dict[str, Any]] = {}
        self._candidates: dict[str, dict[str, Any]] = {}
        self._connect_supabase()

    @property
    def live_mode(self) -> bool:
        return self.client is not None

    def _connect_supabase(self) -> None:
        if not self.settings.supabase_enabled:
            return
        try:
            from supabase import create_client

            key = self.settings.supabase_service_role_key or self.settings.supabase_anon_key
            self.client = create_client(self.settings.supabase_url, key)
            self.storage_mode = "supabase"
        except Exception:
            self.client = None
            self.storage_mode = "memory"

    @staticmethod
    def _account_id(company_name: str) -> str:
        slug = re.sub(r"[^a-z0-9]+", "-", company_name.lower()).strip("-") or "company"
        return f"acct-{slug}-{uuid.uuid4().hex[:6]}"

    def _auth_client(self):
        from supabase import create_client

        return create_client(self.settings.supabase_url, self.settings.supabase_anon_key)

    def create_company_account(self, company_name: str, industry: str, email: str, password: str) -> dict[str, Any]:
        if not company_name.strip():
            raise ValueError("Company name is required.")
        if not industry.strip():
            raise ValueError("Industry is required.")
        normalized_email = email.strip().lower()
        if "@" not in normalized_email:
            raise ValueError("A valid email is required.")
        if len(password) < 6:
            raise ValueError("Password must be at least 6 characters.")
        if not self.client or not self.settings.supabase_anon_key:
            raise ValueError("Supabase Auth is not configured.")
        if self.find_account_by_email(normalized_email):
            raise ValueError("A company account already exists for this email.")

        try:
            user_response = self.client.auth.admin.create_user(
                {
                    "email": normalized_email,
                    "password": password,
                    "email_confirm": True,
                    "user_metadata": {"company_name": company_name.strip(), "industry": industry.strip()},
                }
            )
        except Exception as exc:
            raise ValueError("Could not create Supabase Auth user.") from exc
        user = user_response.user
        if not user:
            raise ValueError("Could not create Supabase Auth user.")

        auth_response = self._auth_client().auth.sign_in_with_password(
            {"email": normalized_email, "password": password}
        )
        if not auth_response.session:
            raise ValueError("Supabase Auth did not return a session.")

        account = {
            "id": self._account_id(company_name),
            "name": company_name.strip(),
            "segment": industry.strip(),
            "health": "new",
            "metadata": {
                "auth_email": normalized_email,
                "auth_user_id": user.id,
                "created_via": "supabase_auth",
            },
            "created_at": datetime.utcnow().isoformat(),
            "updated_at": datetime.utcnow().isoformat(),
        }
        self.client.table("accounts").upsert(account).execute()
        return {
            "account": {"id": account["id"], "name": account["name"], "segment": account["segment"]},
            "email": normalized_email,
            "access_token": auth_response.session.access_token,
            "refresh_token": auth_response.session.refresh_token,
        }

    def find_account_by_email(self, email: str) -> dict[str, Any] | None:
        normalized_email = email.strip().lower()
        if self.client:
            try:
                response = self.client.table("accounts").select("id,name,segment,metadata").execute()
                for account in response.data or []:
                    if (account.get("metadata") or {}).get("auth_email") == normalized_email:
                        return account
            except Exception:
                return None
        return None

    def find_account_by_user_id(self, user_id: str) -> dict[str, Any] | None:
        if self.client:
            try:
                response = self.client.table("accounts").select("id,name,segment,metadata").execute()
                for account in response.data or []:
                    if (account.get("metadata") or {}).get("auth_user_id") == user_id:
                        return account
            except Exception:
                return None
        return None

    def authenticate_company_account(self, email: str, password: str) -> dict[str, Any] | None:
        normalized_email = email.strip().lower()
        if self.client and self.settings.supabase_anon_key:
            try:
                auth_response = self._auth_client().auth.sign_in_with_password(
                    {"email": normalized_email, "password": password}
                )
                if auth_response.user and auth_response.session:
                    account = self.find_account_by_user_id(auth_response.user.id)
                    if account:
                        return {
                            "account": {"id": account["id"], "name": account["name"], "segment": account["segment"]},
                            "email": normalized_email,
                            "access_token": auth_response.session.access_token,
                            "refresh_token": auth_response.session.refresh_token,
                        }
            except Exception:
                pass
        demo_session = self._demo_auth_session(normalized_email, password)
        if demo_session:
            return demo_session
        return None

    def _demo_auth_session(self, normalized_email: str, password: str) -> dict[str, Any] | None:
        if self.settings.environment.lower() == "production":
            return None
        if normalized_email != "admin@apexcloud.example" or not password.strip():
            return None
        account = next(
            (item for item in self.list_accounts() if item.name.strip().lower() == "apexcloud systems"),
            None,
        )
        if not account:
            return None
        token = f"demo-{uuid.uuid4().hex}"
        session = {
            "account": account.model_dump(mode="json"),
            "email": normalized_email,
            "access_token": token,
            "refresh_token": None,
        }
        self._demo_sessions[token] = session
        return session

    def session_from_access_token(self, access_token: str) -> dict[str, Any] | None:
        demo_session = self._demo_sessions.get(access_token)
        if demo_session:
            return demo_session
        if not self.client or not self.settings.supabase_anon_key:
            return None
        try:
            user_response = self._auth_client().auth.get_user(access_token)
        except Exception:
            return None
        if not user_response or not user_response.user:
            return None
        account = self.find_account_by_user_id(user_response.user.id)
        if not account:
            return None
        return {
            "account": {"id": account["id"], "name": account["name"], "segment": account["segment"]},
            "email": user_response.user.email or "",
            "access_token": access_token,
            "refresh_token": None,
        }

    def recommendation_account_id(self, recommendation_id: str) -> str | None:
        if self.client:
            try:
                response = self.client.table("recommendations").select("account_id").eq("id", recommendation_id).limit(1).execute()
                if response.data:
                    return response.data[0].get("account_id")
            except Exception:
                return None
        recommendation = self._recommendations.get(recommendation_id)
        return recommendation.get("account_id") if recommendation else None

    @staticmethod
    def intake_hash(objective: str, intake_text: str) -> str:
        normalized = " ".join(f"{objective}\n{intake_text}".lower().split())
        return hashlib.sha256(normalized.encode("utf-8")).hexdigest()

    @staticmethod
    def _strategy_profile_id(account_id: str) -> str:
        return f"mem-strategy-profile-{account_id}"

    @staticmethod
    def _top_counts(items: list[str], limit: int = 4) -> list[dict[str, Any]]:
        counts: dict[str, int] = {}
        for item in items:
            value = str(item or "").strip()
            if value:
                counts[value] = counts.get(value, 0) + 1
        return [
            {"value": value, "count": count}
            for value, count in sorted(counts.items(), key=lambda pair: (-pair[1], pair[0].lower()))[:limit]
        ]

    def _default_strategy_profile(self, account_id: str) -> dict[str, Any]:
        return {
            "account_id": account_id,
            "personalization_level": "learning",
            "approved_count": 0,
            "rejected_count": 0,
            "preferred_patterns": [],
            "avoid_patterns": [],
            "owner_preferences": [],
            "evidence_preferences": [],
            "operating_principles": [
                "Use source-backed recommendations with a named owner, due date, rationale, and business metric.",
                "Wait for human approval before treating generated recommendations as durable company strategy.",
            ],
            "next_planner_guidance": [
                "Ask for missing source data when confidence is limited.",
                "After review, learn from approvals and rejections before generating similar future plans.",
            ],
            "recent_approved_plans": [],
            "recent_rejected_plans": [],
            "updated_at": datetime.utcnow().isoformat(),
        }

    def get_strategy_profile(self, account_id: str) -> dict[str, Any]:
        profile = self._build_strategy_profile(account_id)
        if profile["approved_count"] or profile["rejected_count"]:
            return profile

        memory_id = self._strategy_profile_id(account_id)
        if memory_id in self._memory_cards:
            metadata = self._memory_cards[memory_id].get("metadata") or {}
            stored = metadata.get("profile")
            if isinstance(stored, dict):
                return stored

        if self.client:
            try:
                rows = (
                    self.client.table("memory_cards")
                    .select("metadata")
                    .eq("id", memory_id)
                    .limit(1)
                    .execute()
                    .data
                    or []
                )
                stored = (rows[0].get("metadata") or {}).get("profile") if rows else None
                if isinstance(stored, dict):
                    return stored
            except Exception:
                pass

        return profile

    def _build_strategy_profile(self, account_id: str) -> dict[str, Any]:
        recommendations = self.list_recommendations(account_id)
        feedback_by_recommendation = self._feedback_by_recommendation()
        approved: list[dict[str, Any]] = []
        rejected: list[dict[str, Any]] = []

        for recommendation in recommendations:
            reviews = feedback_by_recommendation.get(recommendation.get("id", ""), [])
            if not reviews:
                continue
            latest_review = sorted(reviews, key=lambda item: str(item.get("created_at", "")), reverse=True)[0]
            enriched = {**recommendation, "review": latest_review}
            if latest_review.get("decision") == "approved":
                approved.append(enriched)
            elif latest_review.get("decision") == "rejected":
                rejected.append(enriched)

        profile = self._default_strategy_profile(account_id)
        profile["approved_count"] = len(approved)
        profile["rejected_count"] = len(rejected)
        if approved or rejected:
            profile["personalization_level"] = "strong" if len(approved) + len(rejected) >= 3 else "active"

        approved_categories = self._top_counts([item.get("category", "") for item in approved])
        rejected_categories = self._top_counts([item.get("category", "") for item in rejected])
        owner_preferences = self._top_counts([item.get("owner_role", "") for item in approved])
        evidence_preferences = self._top_counts(
            [
                evidence.get("source_type", "")
                for item in approved
                for evidence in item.get("evidence", [])
                if isinstance(evidence, dict)
            ]
        )

        profile["preferred_patterns"] = [
            f"Prefer {item['value']} recommendations when similar objectives appear; approved {item['count']} time{'' if item['count'] == 1 else 's'}."
            for item in approved_categories
        ]
        profile["avoid_patterns"] = [
            f"Avoid repeating {item['value']} recommendations without new evidence; rejected {item['count']} time{'' if item['count'] == 1 else 's'}."
            for item in rejected_categories
        ] + [
            f"Do not duplicate rejected plan: {item.get('title', 'Untitled recommendation')}."
            for item in rejected[:3]
        ]
        profile["owner_preferences"] = [
            f"{item['value']} is a trusted owner for approved plans ({item['count']} approval{'' if item['count'] == 1 else 's'})."
            for item in owner_preferences
        ]
        profile["evidence_preferences"] = [
            f"Use {item['value']} evidence for similar decisions ({item['count']} approved evidence link{'' if item['count'] == 1 else 's'})."
            for item in evidence_preferences
        ]
        profile["operating_principles"] = [
            *profile["operating_principles"],
            "Approved plans should increase confidence for similar future objectives when evidence and constraints match.",
            "Rejected plans should lower confidence or be reframed unless new evidence materially changes the decision.",
        ]
        profile["next_planner_guidance"] = [
            *profile["preferred_patterns"],
            *profile["avoid_patterns"],
            *profile["owner_preferences"],
            *profile["evidence_preferences"],
        ] or profile["next_planner_guidance"]
        profile["recent_approved_plans"] = [
            {
                "title": item.get("title", ""),
                "category": item.get("category", ""),
                "owner_role": item.get("owner_role", ""),
                "business_metric": item.get("business_metric", ""),
                "reviewed_at": (item.get("review") or {}).get("created_at", ""),
            }
            for item in approved[:5]
        ]
        profile["recent_rejected_plans"] = [
            {
                "title": item.get("title", ""),
                "category": item.get("category", ""),
                "reason": (item.get("review") or {}).get("notes", ""),
                "reviewed_at": (item.get("review") or {}).get("created_at", ""),
            }
            for item in rejected[:5]
        ]
        profile["updated_at"] = datetime.utcnow().isoformat()
        return profile

    def _strategy_profile_text(self, profile: dict[str, Any]) -> str:
        sections = [
            "Flow360 AI Strategy Profile",
            f"Personalization level: {profile.get('personalization_level', 'learning')}",
            f"Approved plans: {profile.get('approved_count', 0)}",
            f"Rejected plans: {profile.get('rejected_count', 0)}",
            "Preferred patterns:",
            *[f"- {item}" for item in profile.get("preferred_patterns", [])],
            "Avoid patterns:",
            *[f"- {item}" for item in profile.get("avoid_patterns", [])],
            "Owner preferences:",
            *[f"- {item}" for item in profile.get("owner_preferences", [])],
            "Evidence preferences:",
            *[f"- {item}" for item in profile.get("evidence_preferences", [])],
            "Planner guidance:",
            *[f"- {item}" for item in profile.get("next_planner_guidance", [])],
        ]
        return "\n".join(sections)

    def _persist_strategy_profile(self, account_id: str) -> dict[str, Any]:
        profile = self._build_strategy_profile(account_id)
        summary = self._strategy_profile_text(profile)
        card = {
            "id": self._strategy_profile_id(account_id),
            "entity_type": "account",
            "entity_id": account_id,
            "title": "AI Strategy Profile",
            "memory_type": "rule",
            "summary": summary,
            "confidence": 95 if profile["approved_count"] or profile["rejected_count"] else 72,
            "metadata": {"category": "strategy_profile", "profile": profile},
            "updated_at": datetime.utcnow().isoformat(),
        }
        self._memory_cards[card["id"]] = card
        if self.client:
            try:
                self.client.table("memory_cards").upsert(card).execute()
            except Exception:
                pass
        self.ingest_text(account_id, "AI Strategy Profile", summary, "strategy_profile")
        return profile

    def ingest_text(self, account_id: str, title: str, content: str, source_type: str) -> IngestResponse:
        document_id = f"doc-{uuid.uuid4().hex[:12]}"
        chunks = chunk_text(content)
        document = {
            "id": document_id,
            "account_id": account_id,
            "title": title,
            "source_type": source_type,
            "content": content,
            "created_at": datetime.utcnow().isoformat(),
        }

        if self.client:
            try:
                self.client.table("documents").upsert(document).execute()
                rows = []
                for position, chunk in enumerate(chunks):
                    rows.append(
                        {
                            "id": f"{document_id}-chunk-{position + 1}",
                            "document_id": document_id,
                            "account_id": account_id,
                            "chunk_index": position,
                            "content": chunk,
                            "embedding": self.embeddings.embed(chunk),
                            "metadata": {"title": title, "source_type": source_type},
                        }
                    )
                if rows:
                    self.client.table("document_chunks").upsert(rows).execute()
                return IngestResponse(document_id=document_id, title=title, chunks_created=len(chunks), storage="supabase")
            except Exception:
                pass

        self._documents.append(document)
        for position, chunk in enumerate(chunks):
            self._chunks.append(
                {
                    "id": f"{document_id}-chunk-{position + 1}",
                    "document_id": document_id,
                    "account_id": account_id,
                    "title": title,
                    "source_type": source_type,
                    "content": chunk,
                    "embedding": self.embeddings.embed(chunk),
                }
            )
        return IngestResponse(document_id=document_id, title=title, chunks_created=len(chunks), storage="memory")

    @staticmethod
    def _as_list(value: Any) -> list[str]:
        if value is None:
            return []
        if isinstance(value, list):
            return [str(item).strip() for item in value if str(item).strip()]
        return [item.strip() for item in str(value).split(",") if item.strip()]

    @staticmethod
    def _account_from_row(row: dict[str, Any]) -> AccountSummary:
        metadata = row.get("metadata") or {}
        segment = row.get("segment") or metadata.get("segment") or row.get("industry") or "Account"
        domain = row.get("domain") or metadata.get("domain") or metadata.get("blueprint_id") or "healthcare_staffing"
        if domain not in {"healthcare_staffing", "saas_customer_success", "energy_field_service"}:
            lowered = f"{segment} {domain}".lower()
            if "saas" in lowered or "customer success" in lowered:
                domain = "saas_customer_success"
            elif "energy" in lowered or "field" in lowered or "utility" in lowered:
                domain = "energy_field_service"
            else:
                domain = "healthcare_staffing"
        supports_candidates = bool(
            row.get("supports_candidates")
            or metadata.get("supports_candidates")
            or metadata.get("needs_candidate_workflow")
            or domain == "healthcare_staffing"
        )
        return AccountSummary(
            id=row["id"],
            name=row.get("name") or row.get("company_name") or "Untitled account",
            segment=segment,
            domain=domain,
            health=row.get("health") or metadata.get("health") or "watch",
            renewal_date=str(row.get("renewal_date") or metadata.get("renewal_date") or "") or None,
            description=row.get("description") or metadata.get("description") or f"{segment} company workspace.",
            supports_candidates=supports_candidates,
            primary_user=row.get("primary_user") or metadata.get("primary_user") or "Account Manager",
            metrics=[DashboardMetric(**item) for item in metadata.get("metrics", row.get("metrics", []))],
            risk_trend=[RiskTrendPoint(**item) for item in metadata.get("risk_trend", row.get("risk_trend", []))],
            metadata=metadata,
        )

    def list_accounts(self) -> list[AccountSummary]:
        accounts_by_id = {account_id: dict(account) for account_id, account in self._accounts.items()}
        if self.client:
            try:
                response = self.client.table("accounts").select("*").order("name").execute()
                for row in response.data or []:
                    accounts_by_id[row["id"]] = row
            except Exception:
                pass
        return [
            self._account_from_row(row)
            for _, row in sorted(accounts_by_id.items(), key=lambda item: str(item[1].get("name", "")))
        ]

    def get_account(self, account_id: str) -> AccountSummary:
        if self.client:
            try:
                response = self.client.table("accounts").select("*").eq("id", account_id).limit(1).execute()
                if response.data:
                    return self._account_from_row(response.data[0])
            except Exception:
                pass
        if account_id in self._accounts:
            return self._account_from_row(self._accounts[account_id])
        accounts = self.list_accounts()
        if accounts:
            return accounts[0]
        raise LookupError("No accounts available.")

    def create_account_from_blueprint(
        self,
        *,
        name: str,
        segment: str,
        domain: str,
        description: str,
        primary_user: str,
        supports_candidates: bool,
        account_text: str,
        selections: dict[str, list[str]],
    ) -> dict[str, Any]:
        slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:38] or "custom-account"
        account_id = f"acct-{slug}-{uuid.uuid4().hex[:6]}"
        source_count = sum(len(values) for values in selections.values())
        row = {
            "id": account_id,
            "name": name,
            "segment": segment,
            "domain": domain,
            "health": "new",
            "renewal_date": None,
            "description": description,
            "supports_candidates": supports_candidates,
            "primary_user": primary_user,
            "metadata": {
                "created_by": "domain_blueprint_studio",
                "source_types": selections.get("source_types", []),
                "memory_types": selections.get("memory_types", []),
                "business_rules": selections.get("business_rules", []),
                "recommendation_categories": selections.get("recommendation_categories", []),
                "success_metrics": selections.get("success_metrics", []),
                "agents_enabled": selections.get("agents_enabled", []),
                "metrics": [
                    {"label": "Blueprint coverage", "value": str(source_count), "delta": "selected configuration items"},
                    {"label": "Memory readiness", "value": "New", "delta": "initial operating brief stored"},
                    {"label": "Decision status", "value": "Setup", "delta": "run planner after sources are added"},
                    {"label": "Reusable workflow", "value": "On", "delta": "domain-specific account"},
                ],
                "risk_trend": [
                    {"day": "Setup", "risk": 42, "confidence": 58},
                    {"day": "Sources", "risk": 48, "confidence": 64},
                    {"day": "Planner", "risk": 54, "confidence": 70},
                ],
            },
            "created_at": datetime.utcnow().isoformat(),
            "updated_at": datetime.utcnow().isoformat(),
        }
        self._accounts[account_id] = row
        if self.client:
            try:
                self.client.table("accounts").upsert(row).execute()
            except Exception:
                pass
        brief = (
            f"Account setup context: {account_text}\n\n"
            f"Selected source types: {', '.join(selections.get('source_types', [])) or 'Not selected'}\n"
            f"Selected memory types: {', '.join(selections.get('memory_types', [])) or 'Not selected'}\n"
            f"Selected business rules: {', '.join(selections.get('business_rules', [])) or 'Not selected'}\n"
            f"Recommendation categories: {', '.join(selections.get('recommendation_categories', [])) or 'Not selected'}\n"
            f"Success metrics: {', '.join(selections.get('success_metrics', [])) or 'Not selected'}\n"
            f"Enabled workstreams: {', '.join(selections.get('agents_enabled', [])) or 'Not selected'}"
        )
        source = self.ingest_source_entry(
            account_id=account_id,
            collection="crm",
            source_type="blueprint_account_brief",
            title=f"Blueprint Operating Brief - {name}",
            content=brief,
            fields={"origin": "domain_blueprint_studio", "primary_user": primary_user, "segment": segment},
        )
        return {"account": self._account_from_row(row).model_dump(mode="json"), "source": source}

    def _source_memory(self, entry: dict[str, Any]) -> dict[str, Any]:
        memory_type = {
            "crm": "profile",
            "interactions": "episodic",
            "knowledge": "rule",
            "risks": "episodic",
            "candidates": "profile",
        }.get(entry.get("collection"), "raw")
        card = {
            "id": f"mem-source-{entry['id']}",
            "entity_type": "account",
            "entity_id": entry["account_id"],
            "title": entry["title"],
            "memory_type": memory_type,
            "summary": str(entry.get("content", ""))[:900],
            "confidence": 88,
            "metadata": {"source_entry_id": entry["id"], "collection": entry.get("collection")},
            "updated_at": datetime.utcnow().isoformat(),
        }
        self._memory_cards[card["id"]] = card
        if self.client:
            try:
                self.client.table("memory_cards").upsert(card).execute()
            except Exception:
                pass
        return card

    @staticmethod
    def _is_internal_source_entry(entry: dict[str, Any]) -> bool:
        return str(entry.get("source_type") or "").strip().lower() in {
            "strategy_profile",
            "planner_outcome",
            "planner_run",
            "business_profile",
        }

    @staticmethod
    def _is_low_signal_policy_entry(entry: dict[str, Any]) -> bool:
        if str(entry.get("source_type") or "").strip().lower() != "policy":
            return False
        placeholder_values = {"adf", "asdf", "asfd", "asdfsd", "asdfsdafa", "asdfsdfa"}
        title = str(entry.get("title") or "").strip().lower()
        content = str(entry.get("content") or "").strip().lower()
        fields = entry.get("fields") or {}
        field_values = [str(value or "").strip().lower() for value in fields.values()]
        has_placeholder_title = title in placeholder_values
        has_placeholder_content = content in placeholder_values or len(content) < 18
        has_placeholder_fields = bool(field_values) and all(value in placeholder_values for value in field_values)
        return has_placeholder_title and (has_placeholder_content or has_placeholder_fields)

    def list_source_entries(self, account_id: str, collection: str | None = None) -> list[SourceEntry]:
        entries = {
            entry_id: dict(entry)
            for entry_id, entry in self._source_entries.items()
            if entry.get("account_id") == account_id
        }
        if self.client:
            try:
                workspace = self.list_workspace_data(account_id)
                for item in workspace.get("contacts", []):
                    entries[f"src-contact-{item.get('id')}"] = {
                        "id": f"src-contact-{item.get('id')}",
                        "account_id": account_id,
                        "collection": "crm",
                        "source_type": "crm_contact",
                        "title": item.get("name", "CRM Contact"),
                        "content": item.get("metadata", {}).get("notes") or item.get("role", ""),
                        "fields": item,
                        "created_at": item.get("created_at") or datetime.utcnow().isoformat(),
                    }
                for item in workspace.get("interactions", []):
                    source_type = item.get("source_type") or "interaction"
                    mapped_collection = "risks" if any(word in source_type for word in ["risk", "incident", "breach", "rca"]) else "interactions"
                    entries[f"src-interaction-{item.get('id')}"] = {
                        "id": f"src-interaction-{item.get('id')}",
                        "account_id": account_id,
                        "collection": mapped_collection,
                        "source_type": source_type,
                        "title": item.get("title", "Interaction"),
                        "content": item.get("content", ""),
                        "fields": item.get("metadata") or {},
                        "created_at": item.get("created_at") or datetime.utcnow().isoformat(),
                    }
                for item in workspace.get("documents", []):
                    source_type = item.get("source_type") or "document"
                    metadata = item.get("metadata") or {}
                    mapped_collection = metadata.get("collection")
                    if mapped_collection not in {"crm", "interactions", "knowledge", "risks", "candidates"}:
                        mapped_collection = "risks" if any(word in source_type for word in ["risk", "incident", "breach", "rca"]) else "knowledge"
                    entries[f"src-document-{item.get('id')}"] = {
                        "id": f"src-document-{item.get('id')}",
                        "account_id": account_id,
                        "collection": mapped_collection,
                        "source_type": source_type,
                        "title": item.get("title", "Knowledge"),
                        "content": item.get("content", ""),
                        "fields": metadata,
                        "created_at": item.get("created_at") or datetime.utcnow().isoformat(),
                    }
                for item in workspace.get("candidates", []):
                    entries[f"src-candidate-{item.get('id')}"] = {
                        "id": f"src-candidate-{item.get('id')}",
                        "account_id": account_id,
                        "collection": "candidates",
                        "source_type": "candidate_profile",
                        "title": f"Candidate Profile - {item.get('name', 'Candidate')}",
                        "content": item.get("metadata", {}).get("notes") or item.get("compliance_status", ""),
                        "fields": item,
                        "created_at": item.get("created_at") or datetime.utcnow().isoformat(),
                    }
            except Exception:
                pass
        filtered = [
            entry
            for entry in entries.values()
            if entry.get("account_id") == account_id
            and (collection is None or entry.get("collection") == collection)
            and not self._is_internal_source_entry(entry)
            and not self._is_low_signal_policy_entry(entry)
        ]
        return [SourceEntry(**entry) for entry in sorted(filtered, key=lambda item: item.get("created_at", ""), reverse=True)]

    def ingest_source_entry(
        self,
        account_id: str,
        collection: str,
        source_type: str,
        title: str,
        content: str,
        fields: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        fields = fields or {}
        entry_id = f"src-{uuid.uuid4().hex[:12]}"
        entry = {
            "id": entry_id,
            "account_id": account_id,
            "collection": collection,
            "source_type": source_type,
            "title": title,
            "content": content,
            "fields": fields,
            "created_at": datetime.utcnow().isoformat(),
        }
        self._source_entries[entry_id] = entry
        if collection == "candidates":
            candidate_id = str(fields.get("candidate_id") or f"cand-{uuid.uuid4().hex[:10]}")
            self._candidates[candidate_id] = {
                "id": candidate_id,
                "account_id": account_id,
                "name": fields.get("name") or title.replace("Candidate Profile - ", ""),
                "role": fields.get("role", "Candidate"),
                "availability_date": fields.get("availability_date"),
                "credentialing_status": fields.get("credentialing_status", "unknown"),
                "bgv_status": fields.get("bgv_status", "not_started"),
                "fit_score": int(fields.get("fit_score", 70) or 70),
                "rate_variance_percent": float(fields.get("rate_variance_percent", 0) or 0),
                "missing_items": self._as_list(fields.get("missing_items")),
                "risk_flags": self._as_list(fields.get("risk_flags")),
                "metadata": fields,
            }
        if self.client:
            try:
                if collection == "candidates":
                    self.create_workspace_item(account_id, "candidates", {**fields, "id": fields.get("candidate_id") or entry_id})
                elif collection == "knowledge":
                    self.create_workspace_item(account_id, "documents", {"title": title, "source_type": source_type, "content": content})
                else:
                    self.create_workspace_item(account_id, "interactions", {"title": title, "source_type": source_type, "content": content, "notes": fields})
            except Exception:
                pass
        ingest = self.ingest_text(account_id, title, content, source_type)
        memory = self._source_memory(entry)
        return {"entry": SourceEntry(**entry).model_dump(mode="json"), "ingest": ingest.model_dump(), "memory": memory}

    def _candidate_from_row(self, row: dict[str, Any], account_id: str | None = None) -> CandidateProfile:
        metadata = row.get("metadata") or {}
        return CandidateProfile(
            id=row.get("id", f"cand-{uuid.uuid4().hex[:8]}"),
            account_id=row.get("account_id") or metadata.get("account_id") or account_id or "",
            name=row.get("name", "Unnamed candidate"),
            role=row.get("role", "Candidate"),
            availability_date=row.get("availability_date"),
            credentialing_status=row.get("credentialing_status") or row.get("compliance_status") or metadata.get("credentialing_status", "unknown"),
            bgv_status=row.get("bgv_status") or metadata.get("bgv_status", "not_started"),
            fit_score=int(row.get("fit_score") or metadata.get("fit_score") or 70),
            rate_variance_percent=float(row.get("rate_variance_percent") or metadata.get("rate_variance_percent") or 0),
            missing_items=self._as_list(row.get("missing_items") or metadata.get("missing_items")),
            risk_flags=self._as_list(row.get("risk_flags") or metadata.get("risk_flags")),
            metadata=metadata,
        )

    def list_candidates(self, account_id: str) -> list[CandidateProfile]:
        candidates = [
            self._candidate_from_row(candidate, account_id)
            for candidate in self._candidates.values()
            if candidate.get("account_id") == account_id
        ]
        if self.client:
            try:
                rows = self.list_workspace_data(account_id).get("candidates", [])
                candidates_by_id = {candidate.id: candidate for candidate in candidates}
                for row in rows:
                    candidate = self._candidate_from_row(row, account_id)
                    candidates_by_id[candidate.id] = candidate
                candidates = list(candidates_by_id.values())
            except Exception:
                pass
        return sorted(candidates, key=lambda item: item.name)

    def run_bgv_check(self, account_id: str, candidate_id: str) -> BGVResult:
        candidate = next((item for item in self.list_candidates(account_id) if item.id == candidate_id), None)
        if not candidate:
            candidate = CandidateProfile(id=candidate_id, account_id=account_id, name=candidate_id, role="Candidate")
        evidence = self.retrieve_context(
            f"credentialing BGV checklist {candidate.name} {candidate.role} {candidate.credentialing_status} {candidate.bgv_status}",
            account_id=account_id,
            top_k=4,
        )
        missing = list(candidate.missing_items)
        score = candidate.fit_score
        if candidate.credentialing_status.lower() == "fully verified" and candidate.bgv_status.lower() == "verified" and not missing:
            status = "verified"
            summary = f"{candidate.name} is ready for shortlist. Credentialing and BGV are verified."
            score = max(score, 92)
        elif any("license" in item.lower() for item in missing) or "pending" in candidate.credentialing_status.lower():
            status = "blocked"
            summary = f"{candidate.name} should not be shortlisted as fully cleared yet. Credentialing blocker: {', '.join(missing) or candidate.credentialing_status}."
            score = min(score, 68)
        else:
            status = "needs_review"
            summary = f"{candidate.name} can be considered conditionally, but the account team must resolve: {', '.join(missing) or candidate.credentialing_status}."
            score = min(score, 82)
        card = {
            "id": f"mem-bgv-{candidate_id}",
            "entity_type": "account",
            "entity_id": account_id,
            "title": f"BGV Check - {candidate.name}",
            "memory_type": "profile",
            "summary": summary,
            "confidence": score,
            "updated_at": datetime.utcnow().isoformat(),
        }
        self._memory_cards[card["id"]] = card
        if self.client:
            try:
                self.client.table("memory_cards").upsert(card).execute()
            except Exception:
                pass
        return BGVResult(candidate_id=candidate_id, status=status, score=score, summary=summary, missing_items=missing, evidence=evidence)

    def list_workspace_data(self, account_id: str) -> dict[str, list[dict[str, Any]]]:
        if not self.client:
            return {
                "roles": [],
                "metrics": [],
                "contacts": [],
                "job_reqs": [],
                "candidates": [],
                "interactions": [],
                "business_rules": [],
                "documents": [],
                "memory_cards": [],
            }

        contacts = self.client.table("contacts").select("*").eq("account_id", account_id).order("created_at", desc=True).execute().data or []
        job_reqs = self.client.table("job_reqs").select("*").eq("account_id", account_id).order("created_at", desc=True).execute().data or []
        interactions = self.client.table("interactions").select("*").eq("account_id", account_id).order("created_at", desc=True).execute().data or []
        documents = self.client.table("documents").select("id,account_id,title,source_type,content,metadata,created_at").eq("account_id", account_id).order("created_at", desc=True).execute().data or []
        memory = self.client.table("memory_cards").select("*").eq("entity_type", "account").eq("entity_id", account_id).order("updated_at", desc=True).execute().data or []

        all_candidates = self.client.table("candidates").select("*").order("created_at", desc=True).execute().data or []
        candidates = [item for item in all_candidates if (item.get("metadata") or {}).get("account_id") == account_id]

        all_rules = self.client.table("business_rules").select("*").order("created_at", desc=True).execute().data or []
        rules = [item for item in all_rules if (item.get("metadata") or {}).get("account_id") == account_id]

        roles = [item for item in memory if (item.get("metadata") or {}).get("category") == "role"]
        metrics = [item for item in memory if (item.get("metadata") or {}).get("category") == "metric"]
        memory_cards = [
            item
            for item in memory
            if (item.get("metadata") or {}).get("category") not in {"role", "metric"}
        ]

        return {
            "roles": roles,
            "metrics": metrics,
            "contacts": contacts,
            "job_reqs": job_reqs,
            "candidates": candidates,
            "interactions": interactions,
            "business_rules": rules,
            "documents": documents,
            "memory_cards": memory_cards,
        }

    def dashboard_metrics(self, account_id: str) -> list[dict[str, str]]:
        metrics = self.list_workspace_data(account_id).get("metrics", [])
        rows = []
        for metric in metrics:
            metadata = metric.get("metadata") or {}
            rows.append(
                {
                    "label": str(metric.get("title", "Metric")),
                    "value": str(metadata.get("value", "")),
                    "delta": str(metadata.get("delta", "")),
                }
            )
        return rows

    def apply_blueprint_configuration(self, account_id: str, data: dict[str, Any]) -> dict[str, Any]:
        if not self.client:
            raise ValueError("Supabase is required for blueprint configuration.")

        now = datetime.utcnow().isoformat()
        account_name = str(data.get("account_name") or "").strip()
        segment = str(data.get("segment") or "").strip()
        if not account_name:
            raise ValueError("Account name is required.")
        if not segment:
            raise ValueError("Segment is required.")

        existing_metadata: dict[str, Any] = {}
        try:
            existing = self.client.table("accounts").select("metadata").eq("id", account_id).limit(1).execute().data or []
            if existing:
                existing_metadata = existing[0].get("metadata") or {}
        except Exception:
            existing_metadata = {}

        self.client.table("accounts").update(
            {
                "name": account_name,
                "segment": segment,
                "metadata": {
                    **existing_metadata,
                    "blueprint_id": data.get("blueprint_id", ""),
                    "primary_user": data.get("primary_user", ""),
                    "needs_candidate_workflow": bool(data.get("needs_candidate_workflow", False)),
                    "configured_via": "blueprint_builder",
                    "configured_at": now,
                },
                "updated_at": now,
            }
        ).eq("id", account_id).execute()

        slug = re.sub(r"[^a-z0-9]+", "-", str(data.get("blueprint_id") or "blueprint").lower()).strip("-")
        rows: dict[str, int] = {
            "roles": 0,
            "business_rules": 0,
            "metrics": 0,
            "memory_cards": 0,
            "documents": 0,
        }

        for index, role in enumerate(data.get("roles") or [], start=1):
            name = str(role.get("name") or "").strip()
            if not name:
                continue
            self.create_workspace_item(
                account_id,
                "roles",
                {
                    "id": f"blueprint-{account_id}-{slug}-role-{index}",
                    "name": name,
                    "responsibilities": role.get("responsibilities", ""),
                    "can_approve": bool(role.get("can_approve", False)),
                    "escalation_authority": bool(role.get("escalation_authority", False)),
                    "confidence": 92,
                },
            )
            rows["roles"] += 1

        for index, rule in enumerate(data.get("business_rules") or [], start=1):
            name = str(rule.get("name") or "").strip()
            if not name:
                continue
            self.create_workspace_item(
                account_id,
                "business_rules",
                {
                    "id": f"blueprint-{account_id}-{slug}-rule-{index}",
                    "name": name,
                    "domain": rule.get("domain", segment),
                    "rule_type": rule.get("rule_type", "operating_rule"),
                    "condition": rule.get("condition", ""),
                    "action": rule.get("action", ""),
                    "severity": rule.get("severity", "medium"),
                },
            )
            rows["business_rules"] += 1

        for index, metric in enumerate(data.get("success_metrics") or [], start=1):
            label = str(metric.get("label") or "").strip()
            if not label:
                continue
            self.create_workspace_item(
                account_id,
                "metrics",
                {
                    "id": f"blueprint-{account_id}-{slug}-metric-{index}",
                    "label": label,
                    "value": metric.get("value", "Not measured yet"),
                    "delta": metric.get("delta", "Baseline needed"),
                    "why_it_matters": metric.get("why_it_matters", ""),
                },
            )
            rows["metrics"] += 1

        memory_groups = [
            ("Approved Source Types", "semantic", data.get("source_types") or []),
            ("Approved Memory Types", "semantic", data.get("memory_types") or []),
            ("Recommendation Categories", "rule", data.get("recommendation_categories") or []),
            ("Agents Enabled", "rule", data.get("agents_enabled") or []),
        ]
        for index, (title, memory_type, values) in enumerate(memory_groups, start=1):
            if not values:
                continue
            self.create_workspace_item(
                account_id,
                "memory_cards",
                {
                    "id": f"blueprint-{account_id}-{slug}-config-{index}",
                    "title": title,
                    "memory_type": memory_type,
                    "summary": "; ".join(str(value) for value in values),
                    "confidence": 94,
                },
            )
            rows["memory_cards"] += 1

        operating_brief = self._blueprint_operating_brief(data)
        brief_document_id = f"blueprint-{account_id}-{slug}-brief"
        brief_document = {
            "id": brief_document_id,
            "account_id": account_id,
            "title": f"{account_name} - Approved Blueprint Operating Brief",
            "source_type": "blueprint_operating_brief",
            "content": operating_brief,
            "metadata": {"blueprint_id": data.get("blueprint_id", "")},
            "created_at": now,
        }
        self.client.table("documents").upsert(brief_document).execute()
        self.client.table("document_chunks").delete().eq("document_id", brief_document_id).eq("account_id", account_id).execute()
        chunk_rows = []
        for position, chunk in enumerate(chunk_text(operating_brief)):
            chunk_rows.append(
                {
                    "id": f"{brief_document_id}-chunk-{position + 1}",
                    "document_id": brief_document_id,
                    "account_id": account_id,
                    "chunk_index": position,
                    "content": chunk,
                    "embedding": self.embeddings.embed(chunk),
                    "metadata": {"title": brief_document["title"], "source_type": "blueprint_operating_brief"},
                }
            )
        if chunk_rows:
            self.client.table("document_chunks").upsert(chunk_rows).execute()
        rows["documents"] += 1

        profile_memory = {
            "id": f"blueprint-{account_id}-{slug}-profile",
            "entity_type": "account",
            "entity_id": account_id,
            "title": "Approved Account Blueprint",
            "memory_type": "profile",
            "summary": operating_brief[:900],
            "confidence": 96,
            "metadata": {"category": "memory", "blueprint_id": data.get("blueprint_id", "")},
            "updated_at": now,
        }
        self.client.table("memory_cards").upsert(profile_memory).execute()
        rows["memory_cards"] += 1

        return {"account_id": account_id, "account_name": account_name, "rows": rows}

    @staticmethod
    def _blueprint_operating_brief(data: dict[str, Any]) -> str:
        def lines(values: list[Any], formatter) -> str:
            rendered = [formatter(value) for value in values if value]
            return "\n".join(f"- {item}" for item in rendered if item)

        return f"""Approved account blueprint configuration

Account: {data.get("account_name", "")}
Segment: {data.get("segment", "")}
Primary user: {data.get("primary_user", "")}
Blueprint: {data.get("blueprint_id", "")}
Description: {data.get("description", "")}
Candidate/BGV workflow required: {"yes" if data.get("needs_candidate_workflow") else "no"}

Source types:
{lines(data.get("source_types") or [], lambda value: str(value))}

Memory types:
{lines(data.get("memory_types") or [], lambda value: str(value))}

Company-specific responsibilities:
{lines(data.get("roles") or [], lambda role: f"{role.get('name', '')}: {role.get('responsibilities', '')}")}

Business rules:
{lines(data.get("business_rules") or [], lambda rule: f"{rule.get('name', '')}: when {rule.get('condition', '')}, then {rule.get('action', '')}")}

Recommendation categories:
{lines(data.get("recommendation_categories") or [], lambda value: str(value))}

Success metrics:
{lines(data.get("success_metrics") or [], lambda metric: f"{metric.get('label', '')}: {metric.get('why_it_matters', '')}")}

Agents enabled:
{lines(data.get("agents_enabled") or [], lambda value: str(value))}
"""

    def create_workspace_item(self, account_id: str, kind: str, data: dict[str, Any]) -> dict[str, Any]:
        if not self.client:
            raise ValueError("Supabase is required for workspace data.")
        item_id = data.get("id") or f"{kind}-{uuid.uuid4().hex[:10]}"
        now = datetime.utcnow().isoformat()

        if kind == "roles":
            row = {
                "id": item_id,
                "entity_type": "account",
                "entity_id": account_id,
                "title": data.get("name", "Untitled role"),
                "memory_type": "profile",
                "summary": data.get("responsibilities", ""),
                "confidence": int(data.get("confidence", 90) or 90),
                "metadata": {
                    "category": "role",
                    "can_approve": bool(data.get("can_approve", False)),
                    "escalation_authority": bool(data.get("escalation_authority", False)),
                },
                "updated_at": now,
            }
            self.client.table("memory_cards").upsert(row).execute()
            return row

        if kind == "metrics":
            row = {
                "id": item_id,
                "entity_type": "account",
                "entity_id": account_id,
                "title": data.get("label", "Untitled metric"),
                "memory_type": "semantic",
                "summary": data.get("why_it_matters", ""),
                "confidence": int(data.get("confidence", 85) or 85),
                "metadata": {
                    "category": "metric",
                    "value": data.get("value", ""),
                    "delta": data.get("delta", ""),
                },
                "updated_at": now,
            }
            self.client.table("memory_cards").upsert(row).execute()
            return row

        if kind == "contacts":
            row = {
                "id": item_id,
                "account_id": account_id,
                "name": data.get("name", "Unnamed contact"),
                "role": data.get("role", ""),
                "influence": data.get("influence", ""),
                "sentiment": data.get("sentiment", ""),
                "metadata": {"notes": data.get("notes", "")},
            }
            self.client.table("contacts").upsert(row).execute()
            return row

        if kind == "job_reqs":
            row = {
                "id": item_id,
                "account_id": account_id,
                "title": data.get("title", "Untitled work item"),
                "openings": int(data.get("openings", 1) or 1),
                "start_date": data.get("start_date") or None,
                "urgency": data.get("urgency", ""),
                "status": data.get("status", "open"),
                "metadata": {"notes": data.get("notes", "")},
            }
            self.client.table("job_reqs").upsert(row).execute()
            return row

        if kind == "candidates":
            row = {
                "id": item_id,
                "name": data.get("name", "Unnamed resource"),
                "role": data.get("role", ""),
                "availability_date": data.get("availability_date") or None,
                "compliance_status": data.get("compliance_status", ""),
                "rate_variance_percent": data.get("rate_variance_percent") or None,
                "metadata": {"account_id": account_id, "notes": data.get("notes", "")},
            }
            self.client.table("candidates").upsert(row).execute()
            return row

        if kind == "interactions":
            row = {
                "id": item_id,
                "account_id": account_id,
                "title": data.get("title", "Untitled interaction"),
                "source_type": data.get("source_type", "interaction"),
                "content": data.get("content", ""),
                "metadata": {"notes": data.get("notes", "")},
            }
            self.client.table("interactions").upsert(row).execute()
            if row["content"]:
                self.ingest_text(account_id, row["title"], row["content"], row["source_type"])
            return row

        if kind == "business_rules":
            row = {
                "id": item_id,
                "name": data.get("name", "Untitled rule"),
                "domain": data.get("domain", ""),
                "rule_type": data.get("rule_type", "operating_rule"),
                "condition": data.get("condition", ""),
                "action": data.get("action", ""),
                "severity": data.get("severity", "medium"),
                "metadata": {"account_id": account_id},
            }
            self.client.table("business_rules").upsert(row).execute()
            return row

        if kind == "documents":
            title = data.get("title", "Untitled document")
            content = data.get("content", "")
            source_type = data.get("source_type", "document")
            response = self.ingest_text(account_id, title, content, source_type)
            return response.model_dump()

        if kind == "memory_cards":
            row = {
                "id": item_id,
                "entity_type": "account",
                "entity_id": account_id,
                "title": data.get("title", "Untitled memory"),
                "memory_type": data.get("memory_type", "semantic"),
                "summary": data.get("summary", ""),
                "confidence": int(data.get("confidence", 80) or 80),
                "metadata": {"category": "memory"},
                "updated_at": now,
            }
            self.client.table("memory_cards").upsert(row).execute()
            return row

        raise ValueError(f"Unsupported workspace item type: {kind}")

    def update_workspace_item(self, account_id: str, kind: str, item_id: str, data: dict[str, Any]) -> dict[str, Any]:
        if kind == "documents":
            title = data.get("title", "Untitled document")
            content = data.get("content", "")
            source_type = data.get("source_type", "document")
            document = {
                "title": title,
                "source_type": source_type,
                "content": content,
                "metadata": data.get("metadata", {}),
            }
            self.client.table("documents").update(document).eq("id", item_id).eq("account_id", account_id).execute()
            self.client.table("document_chunks").delete().eq("document_id", item_id).eq("account_id", account_id).execute()
            rows = []
            for position, chunk in enumerate(chunk_text(content)):
                rows.append(
                    {
                        "id": f"{item_id}-chunk-{position + 1}",
                        "document_id": item_id,
                        "account_id": account_id,
                        "chunk_index": position,
                        "content": chunk,
                        "embedding": self.embeddings.embed(chunk),
                        "metadata": {"title": title, "source_type": source_type},
                    }
                )
            if rows:
                self.client.table("document_chunks").upsert(rows).execute()
            return {"id": item_id, "account_id": account_id, **document}

        return self.create_workspace_item(account_id, kind, {**data, "id": item_id})

    def delete_workspace_item(self, account_id: str, kind: str, item_id: str) -> None:
        if not self.client:
            return
        if kind in {"roles", "metrics", "memory_cards"}:
            self.client.table("memory_cards").delete().eq("id", item_id).eq("entity_id", account_id).execute()
            return
        if kind == "documents":
            self.client.table("documents").delete().eq("id", item_id).eq("account_id", account_id).execute()
            return
        if kind == "interactions":
            self.client.table("interactions").delete().eq("id", item_id).eq("account_id", account_id).execute()
            return
        if kind == "contacts":
            self.client.table("contacts").delete().eq("id", item_id).eq("account_id", account_id).execute()
            return
        if kind == "job_reqs":
            self.client.table("job_reqs").delete().eq("id", item_id).eq("account_id", account_id).execute()
            return
        if kind == "candidates":
            self.client.table("candidates").delete().eq("id", item_id).execute()
            return
        if kind == "business_rules":
            self.client.table("business_rules").delete().eq("id", item_id).execute()
            return

    @staticmethod
    def _workspace_table(kind: str) -> str | None:
        return {
            "contacts": "contacts",
            "job_reqs": "job_reqs",
            "candidates": "candidates",
            "interactions": "interactions",
            "business_rules": "business_rules",
            "roles": "memory_cards",
            "metrics": "memory_cards",
            "memory_cards": "memory_cards",
        }.get(kind)

    def retrieve_context(self, query: str, account_id: str, top_k: int = 8) -> list[Evidence]:
        if self.client:
            try:
                query_embedding = self.embeddings.embed(query)
                response = self.client.rpc(
                    "match_document_chunks",
                    {
                        "query_embedding": query_embedding,
                        "match_count": top_k,
                        "filter_account_id": account_id,
                    },
                ).execute()
                data = response.data or []
                if data:
                    return [
                        Evidence(
                            source_id=row.get("document_id", row.get("id", "")),
                            source_title=row.get("title") or row.get("metadata", {}).get("title", "Enterprise context"),
                            source_type=row.get("source_type") or row.get("metadata", {}).get("source_type", "knowledge"),
                            snippet=row.get("content", "")[:500],
                            relevance=float(row.get("similarity", 0.0)),
                        )
                        for row in data
                    ]
            except Exception:
                pass

        return self._keyword_search(query, account_id, top_k)

    def _keyword_search(self, query: str, account_id: str, top_k: int) -> list[Evidence]:
        query_terms = set(re.findall(r"[a-zA-Z0-9]+", query.lower()))
        scored = []
        for chunk in self._chunks:
            if chunk["account_id"] not in {account_id, "global"}:
                continue
            chunk_terms = set(re.findall(r"[a-zA-Z0-9]+", chunk["content"].lower()))
            overlap = len(query_terms & chunk_terms)
            if overlap == 0:
                overlap = 1 if any(term in chunk["content"].lower() for term in ["credential", "renewal", "sla"]) else 0
            score = overlap / math.sqrt(max(len(chunk_terms), 1))
            scored.append((score, chunk))
        scored.sort(key=lambda item: item[0], reverse=True)
        return [
            Evidence(
                source_id=chunk["document_id"],
                source_title=chunk["title"],
                source_type=chunk["source_type"],
                snippet=chunk["content"][:500],
                relevance=round(score, 3),
            )
            for score, chunk in scored[:top_k]
        ]

    def save_run(self, run_id: str, result: dict[str, Any]) -> None:
        result = {
            "id": run_id,
            "status": "completed",
            "created_at": result.get("created_at", datetime.utcnow().isoformat()),
            **result,
        }
        self._runs[run_id] = result
        if self.client:
            try:
                self.client.table("agent_runs").upsert(
                    {
                        "id": run_id,
                        "account_id": result.get("account_id") or "",
                        "objective": result.get("objective", ""),
                        "status": "completed",
                        "analysis": result.get("analysis", {}),
                        "agent_trace": result.get("agent_trace", []),
                        "metadata": result.get("metadata", {}),
                    }
                ).execute()
            except Exception:
                pass

    def get_run(self, run_id: str, account_id: str | None = None) -> dict[str, Any] | None:
        if run_id in self._runs:
            run = self._runs[run_id]
            if account_id and run.get("account_id") != account_id:
                return None
            return run
        if self.client:
            try:
                query = self.client.table("agent_runs").select("*").eq("id", run_id)
                if account_id:
                    query = query.eq("account_id", account_id)
                response = query.single().execute()
                return response.data
            except Exception:
                return None
        return None

    def find_duplicate_run(self, account_id: str, objective: str, intake_text: str) -> dict[str, Any] | None:
        target_hash = self.intake_hash(objective, intake_text)
        if self.client:
            try:
                response = (
                    self.client.table("agent_runs")
                    .select("*")
                    .eq("account_id", account_id)
                    .order("created_at", desc=True)
                    .execute()
                )
                for run in response.data or []:
                    if (run.get("metadata") or {}).get("intake_hash") == target_hash:
                        return run
            except Exception:
                return None
        for run in sorted(self._runs.values(), key=lambda item: item.get("created_at", ""), reverse=True):
            if run.get("account_id") == account_id and (run.get("metadata") or {}).get("intake_hash") == target_hash:
                return run
        return None

    def planner_run_result(self, run_id: str, account_id: str) -> dict[str, Any] | None:
        run = self.get_run(run_id, account_id)
        if not run:
            return None
        metadata = run.get("metadata") or {}
        recommendations = [item for item in self.list_recommendations(account_id) if item.get("run_id") == run_id]
        return {
            "run_id": run["id"],
            "account_id": account_id,
            "account_name": account_id,
            "objective": run.get("objective", ""),
            "title": metadata.get("title") or run.get("objective") or "Planner Run",
            "status": run.get("status", "completed"),
            "created_at": run.get("created_at"),
            "analysis": run.get("analysis") or {},
            "recommendations": recommendations,
            "agent_trace": run.get("agent_trace") or [],
            "retrieved_context": metadata.get("retrieved_context") or [],
            "memory_updates": metadata.get("memory_updates") or [],
            "mode": "live" if self.live_mode else "offline",
        }

    def list_planner_runs(self, account_id: str) -> list[dict[str, Any]]:
        if self.client:
            try:
                runs = (
                    self.client.table("agent_runs")
                    .select("*")
                    .eq("account_id", account_id)
                    .order("created_at", desc=True)
                    .execute()
                    .data
                    or []
                )
            except Exception:
                runs = []
        else:
            runs = [run for run in self._runs.values() if run.get("account_id") == account_id]
            runs.sort(key=lambda item: item.get("created_at", ""), reverse=True)

        recommendations = self.list_recommendations(account_id)
        recs_by_run: dict[str, list[dict[str, Any]]] = {}
        for recommendation in recommendations:
            run_id = recommendation.get("run_id")
            if run_id:
                recs_by_run.setdefault(run_id, []).append(recommendation)

        feedback_by_recommendation = self._feedback_by_recommendation()
        cases = []
        for run in runs:
            metadata = run.get("metadata") or {}
            run_recommendations = recs_by_run.get(run.get("id"), [])
            approvals = [
                feedback
                for recommendation in run_recommendations
                for feedback in feedback_by_recommendation.get(recommendation.get("id", ""), [])
            ]
            cases.append(
                {
                    "id": run.get("id"),
                    "account_id": account_id,
                    "objective": run.get("objective", ""),
                    "title": metadata.get("title") or run.get("objective") or "Planner Run",
                    "intake_text": metadata.get("intake_text", ""),
                    "intake_hash": metadata.get("intake_hash", ""),
                    "case_type": metadata.get("case_type", "manual"),
                    "status": run.get("status", "completed"),
                    "created_at": run.get("created_at"),
                    "analysis": run.get("analysis") or {},
                    "agent_trace": run.get("agent_trace") or [],
                    "retrieved_context": metadata.get("retrieved_context") or [],
                    "recommendations": run_recommendations,
                    "approval_history": approvals,
                }
            )
        return cases

    def _feedback_by_recommendation(self) -> dict[str, list[dict[str, Any]]]:
        if not self.client:
            grouped: dict[str, list[dict[str, Any]]] = {}
            for row in self._feedback:
                grouped.setdefault(row.get("recommendation_id", ""), []).append(row)
            return grouped
        try:
            rows = self.client.table("recommendation_feedback").select("*").order("created_at", desc=True).execute().data or []
        except Exception:
            return {}
        grouped: dict[str, list[dict[str, Any]]] = {}
        for row in rows:
            grouped.setdefault(row.get("recommendation_id", ""), []).append(row)
        return grouped

    def save_recommendations(self, recommendations: list[Recommendation]) -> None:
        for recommendation in recommendations:
            self._recommendations[recommendation.id] = recommendation.model_dump(mode="json")
        if self.client and recommendations:
            try:
                rows = [recommendation.model_dump(mode="json") for recommendation in recommendations]
                self.client.table("recommendations").upsert(rows).execute()
            except Exception:
                pass

    def list_recommendations(self, account_id: str | None = None) -> list[dict[str, Any]]:
        if self.client:
            try:
                query = self.client.table("recommendations").select("*").order("created_at", desc=True)
                if account_id:
                    query = query.eq("account_id", account_id)
                response = query.execute()
                return response.data or []
            except Exception:
                pass
        values = list(self._recommendations.values())
        if account_id:
            values = [item for item in values if item.get("account_id") == account_id]
        return sorted(values, key=lambda item: item.get("created_at", ""), reverse=True)

    def get_recommendation(self, recommendation_id: str) -> dict[str, Any] | None:
        if self.client:
            try:
                response = self.client.table("recommendations").select("*").eq("id", recommendation_id).limit(1).execute()
                if response.data:
                    return response.data[0]
            except Exception:
                return None
        return self._recommendations.get(recommendation_id)

    def review_recommendation(self, recommendation_id: str, decision: str, reviewer: str, notes: str) -> dict[str, Any]:
        recommendation = self.get_recommendation(recommendation_id)
        if not recommendation:
            raise ValueError("Recommendation not found.")
        if recommendation.get("status") != "pending":
            raise ValueError("This recommendation has already been reviewed.")
        if not recommendation.get("run_id"):
            raise ValueError("Recommendation is not attached to a planner run.")

        review = {
            "id": f"review-{uuid.uuid4().hex[:10]}",
            "recommendation_id": recommendation_id,
            "decision": decision,
            "reviewer": reviewer,
            "notes": notes,
            "created_at": datetime.utcnow().isoformat(),
        }

        if recommendation_id in self._recommendations:
            self._recommendations[recommendation_id]["status"] = decision
            self._feedback.append(review)

        if self.client:
            try:
                self.client.table("recommendations").update({"status": decision}).eq("id", recommendation_id).execute()
                self.client.table("recommendation_feedback").insert(review).execute()
            except Exception as exc:
                raise ValueError("Could not persist recommendation review.") from exc

        self._write_feedback_memory(recommendation_id, decision, notes)
        self._write_review_outcome_document(recommendation_id, decision, notes)
        review["strategy_profile"] = self._persist_strategy_profile(recommendation.get("account_id") or "")
        return review

    def _write_feedback_memory(self, recommendation_id: str, decision: str, notes: str) -> None:
        rec = self.get_recommendation(recommendation_id) or {}
        run = self.get_run(rec.get("run_id", ""), rec.get("account_id")) if rec.get("run_id") else None
        memory_id = f"mem-feedback-{recommendation_id}"
        summary = f"{decision.title()} recommendation '{rec.get('title', recommendation_id)}'."
        if run:
            summary += f" Planner objective: {run.get('objective', 'Unknown objective')}."
        if rec.get("business_metric"):
            summary += f" Expected business impact: {rec.get('business_metric')}."
        if notes:
            summary += f" Reviewer notes: {notes}"
        card = {
            "id": memory_id,
            "entity_type": "account",
            "entity_id": rec.get("account_id") or "",
            "title": "Planner Review Outcome",
            "memory_type": "episodic",
            "summary": summary,
            "confidence": 93,
            "metadata": {
                "category": "planner_outcome",
                "run_id": rec.get("run_id"),
                "recommendation_id": recommendation_id,
                "decision": decision,
                "business_impact": rec.get("business_metric", ""),
            },
            "updated_at": datetime.utcnow().isoformat(),
        }
        self._memory_cards[memory_id] = card
        if self.client:
            try:
                self.client.table("memory_cards").upsert(card).execute()
            except Exception:
                pass

    def _write_review_outcome_document(self, recommendation_id: str, decision: str, notes: str) -> None:
        rec = self.get_recommendation(recommendation_id) or {}
        account_id = rec.get("account_id") or ""
        run = self.get_run(rec.get("run_id", ""), account_id) if rec.get("run_id") else None
        title = f"Planner Outcome - {rec.get('title', recommendation_id)}"
        evidence_titles = [
            item.get("source_title", "")
            for item in rec.get("evidence", [])
            if isinstance(item, dict) and item.get("source_title")
        ]
        content = "\n".join(
            [
                f"Planner run: {rec.get('run_id', '')}",
                f"Objective: {run.get('objective', '') if run else ''}",
                f"Recommendation: {rec.get('title', '')}",
                f"Decision: {decision}",
                f"Owner: {rec.get('owner_role', '')}",
                f"Due date: {rec.get('due_date', '')}",
                f"Business impact: {rec.get('business_metric', '')}",
                f"Rationale: {rec.get('rationale', '')}",
                f"Supporting evidence: {', '.join(evidence_titles) if evidence_titles else 'No linked evidence titles'}",
                f"Reviewer notes: {notes}",
                "Learning rule: future planner runs should retrieve this previous decision and avoid repeating rejected actions or duplicate approvals.",
            ]
        )
        self.ingest_text(account_id, title, content, "planner_outcome")

    def get_memory(self, entity_type: str, entity_id: str) -> list[MemoryCard]:
        if self.client:
            try:
                response = (
                    self.client.table("memory_cards")
                    .select("*")
                    .eq("entity_type", entity_type)
                    .eq("entity_id", entity_id)
                    .order("updated_at", desc=True)
                    .execute()
                )
                return [MemoryCard(**item) for item in response.data or []]
            except Exception:
                pass
        return [
            MemoryCard(**card)
            for card in self._memory_cards.values()
            if card["entity_type"] == entity_type and card["entity_id"] == entity_id
        ]

    def dashboard_state(self, account_id: str | None = None) -> dict[str, Any]:
        if not account_id:
            accounts = self.list_accounts()
            if not accounts:
                raise LookupError("No company workspace is available.")
            account_id = accounts[0].id
        account = self.get_account(account_id)
        account_id = account.id
        metrics = [item.model_dump(mode="json") for item in account.metrics] or self.dashboard_metrics(account_id)
        risk_trend = [item.model_dump(mode="json") for item in account.risk_trend]
        return {
            "accounts": [item.model_dump(mode="json") for item in self.list_accounts()],
            "account": account.model_dump(mode="json"),
            "recommendations": self.list_recommendations(account_id) if account_id else [],
            "memory": [card.model_dump(mode="json") for card in self.get_memory("account", account_id)] if account_id else [],
            "sources": {
                collection: [entry.model_dump(mode="json") for entry in self.list_source_entries(account_id, collection)]
                for collection in ["crm", "interactions", "knowledge", "risks", "candidates"]
            },
            "candidates": [candidate.model_dump(mode="json") for candidate in self.list_candidates(account_id)],
            "metrics": metrics,
            "riskTrend": risk_trend,
            "initialInteraction": "",
            "mode": "live" if self.live_mode else "offline",
        }
