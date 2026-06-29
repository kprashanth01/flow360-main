from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv


ROOT_DIR = Path(__file__).resolve().parents[2]
BACKEND_DIR = Path(__file__).resolve().parents[1]
load_dotenv(ROOT_DIR / ".env")
load_dotenv(BACKEND_DIR / ".env", override=True)


def _split_csv(value: str | None) -> list[str]:
    if not value:
        return []
    return [item.strip() for item in value.split(",") if item.strip()]


def _first_env(*names: str) -> str:
    for name in names:
        value = os.getenv(name)
        if value:
            return value.strip()
    return ""


def _groq_keys() -> list[str]:
    csv_keys = _split_csv(os.getenv("GROQ_API_KEYS"))
    if csv_keys:
        return csv_keys
    return [key for key in (_first_env(f"GROQ_API_KEY{index}") for index in range(1, 11)) if key]


def _supabase_project_url() -> str:
    url = _first_env("SUPABASE_URL", "API_URL")
    if not url:
        return ""
    url = url.rstrip("/")
    if url.endswith("/rest/v1"):
        url = url[: -len("/rest/v1")]
    return url


@dataclass(frozen=True)
class Settings:
    environment: str
    cors_origins: list[str]
    groq_api_keys: list[str]
    groq_reasoning_model: str
    groq_fast_model: str
    supabase_url: str
    supabase_anon_key: str
    supabase_service_role_key: str
    supabase_storage_bucket: str
    ollama_base_url: str
    ollama_embed_model: str
    embedding_dim: int

    @property
    def supabase_enabled(self) -> bool:
        return bool(self.supabase_url and (self.supabase_service_role_key or self.supabase_anon_key))


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings(
        environment=os.getenv("ENVIRONMENT", "local"),
        cors_origins=_split_csv(os.getenv("BACKEND_CORS_ORIGINS")) or ["http://localhost:3000"],
        groq_api_keys=_groq_keys(),
        groq_reasoning_model=os.getenv("GROQ_REASONING_MODEL", "llama-3.3-70b-versatile"),
        groq_fast_model=os.getenv("GROQ_FAST_MODEL", "llama-3.1-8b-instant"),
        supabase_url=_supabase_project_url(),
        supabase_anon_key=_first_env("SUPABASE_ANON_KEY", "anon_public", "publishable_key"),
        supabase_service_role_key=_first_env("SUPABASE_SERVICE_ROLE_KEY", "service_role", "secret_key"),
        supabase_storage_bucket=os.getenv("SUPABASE_STORAGE_BUCKET", "documents"),
        ollama_base_url=os.getenv("OLLAMA_BASE_URL", "http://localhost:11434"),
        ollama_embed_model=os.getenv("OLLAMA_EMBED_MODEL", "nomic-embed-text:latest"),
        embedding_dim=int(os.getenv("EMBEDDING_DIM", "768")),
    )
