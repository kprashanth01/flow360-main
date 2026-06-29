from __future__ import annotations

import hashlib
import math

import httpx

from app.config import Settings


class EmbeddingService:
    def __init__(self, settings: Settings):
        self.settings = settings
        self._ollama_available: bool | None = None

    def embed(self, text: str) -> list[float]:
        if self._ollama_available is not False:
            try:
                response = httpx.post(
                    f"{self.settings.ollama_base_url.rstrip('/')}/api/embeddings",
                    json={"model": self.settings.ollama_embed_model, "prompt": text},
                    timeout=2.5,
                )
                response.raise_for_status()
                embedding = response.json().get("embedding")
                if isinstance(embedding, list) and embedding:
                    self._ollama_available = True
                    return self._fit_dimension([float(value) for value in embedding])
            except Exception:
                self._ollama_available = False
        return self._deterministic_embedding(text)

    def _fit_dimension(self, embedding: list[float]) -> list[float]:
        dim = self.settings.embedding_dim
        if len(embedding) == dim:
            return embedding
        if len(embedding) > dim:
            return embedding[:dim]
        return embedding + [0.0] * (dim - len(embedding))

    def _deterministic_embedding(self, text: str) -> list[float]:
        dim = self.settings.embedding_dim
        digest = hashlib.sha256(text.encode("utf-8")).digest()
        values = []
        for index in range(dim):
            byte = digest[index % len(digest)]
            values.append((byte / 255.0) - 0.5)
        norm = math.sqrt(sum(value * value for value in values)) or 1.0
        return [round(value / norm, 6) for value in values]
