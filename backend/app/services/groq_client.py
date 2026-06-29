from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any

from app.config import Settings


@dataclass
class LLMResult:
    content: str
    model: str
    used_key_index: int | None


class GroqRouter:
    def __init__(self, settings: Settings):
        self.settings = settings
        self._next_key_index = 0

    @property
    def enabled(self) -> bool:
        return bool(self.settings.groq_api_keys)

    def complete(
        self,
        system: str,
        user: str,
        model: str | None = None,
        temperature: float = 0.2,
        max_tokens: int = 1800,
    ) -> LLMResult | None:
        if not self.enabled:
            return None

        from groq import Groq

        keys = self.settings.groq_api_keys
        errors: list[str] = []
        selected_model = model or self.settings.groq_reasoning_model

        for offset in range(len(keys)):
            index = (self._next_key_index + offset) % len(keys)
            try:
                client = Groq(api_key=keys[index])
                response = client.chat.completions.create(
                    model=selected_model,
                    messages=[
                        {"role": "system", "content": system},
                        {"role": "user", "content": user},
                    ],
                    temperature=temperature,
                    max_tokens=max_tokens,
                )
                self._next_key_index = (index + 1) % len(keys)
                content = response.choices[0].message.content or ""
                return LLMResult(content=content, model=selected_model, used_key_index=index)
            except Exception as exc:
                errors.append(f"key {index}: {exc}")

        return None

    def complete_json(
        self,
        system: str,
        user: str,
        fallback: dict[str, Any] | list[Any],
        model: str | None = None,
        temperature: float = 0.2,
    ) -> dict[str, Any] | list[Any]:
        result = self.complete(system=system, user=user, model=model, temperature=temperature)
        if not result:
            return fallback
        parsed = self._parse_json(result.content)
        return parsed if parsed is not None else fallback

    @staticmethod
    def _parse_json(content: str) -> dict[str, Any] | list[Any] | None:
        try:
            return json.loads(content)
        except json.JSONDecodeError:
            pass

        match = re.search(r"```(?:json)?\s*(.*?)```", content, flags=re.DOTALL)
        if match:
            try:
                return json.loads(match.group(1))
            except json.JSONDecodeError:
                pass

        start_candidates = [index for index in [content.find("{"), content.find("[")] if index != -1]
        if not start_candidates:
            return None
        start = min(start_candidates)
        end = max(content.rfind("}"), content.rfind("]"))
        if end <= start:
            return None
        try:
            return json.loads(content[start : end + 1])
        except json.JSONDecodeError:
            return None

