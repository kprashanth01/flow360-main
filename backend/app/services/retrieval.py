from __future__ import annotations

from app.models import Evidence
from app.services.store import PlatformStore


class EnterpriseRetriever:
    """LlamaIndex parsing plus Supabase pgvector retrieval facade.

    The store owns the concrete RPC call while this adapter keeps the platform
    boundary explicit: agent code asks for enterprise context, not database rows.
    """

    def __init__(self, store: PlatformStore):
        self.store = store

    def search(self, query: str, account_id: str, top_k: int = 8) -> list[Evidence]:
        return self.store.retrieve_context(query=query, account_id=account_id, top_k=top_k)
