from __future__ import annotations

import re


def chunk_text(text: str, chunk_size: int = 850, chunk_overlap: int = 120) -> list[str]:
    """Chunk text with LlamaIndex when available, then fall back to a small local splitter."""
    cleaned = re.sub(r"\s+", " ", text).strip()
    if not cleaned:
        return []

    try:
        from llama_index.core.node_parser import SentenceSplitter

        splitter = SentenceSplitter(chunk_size=chunk_size, chunk_overlap=chunk_overlap)
        return [chunk.strip() for chunk in splitter.split_text(cleaned) if chunk.strip()]
    except Exception:
        chunks: list[str] = []
        start = 0
        while start < len(cleaned):
            end = min(start + chunk_size, len(cleaned))
            chunks.append(cleaned[start:end].strip())
            if end == len(cleaned):
                break
            start = max(0, end - chunk_overlap)
        return chunks

