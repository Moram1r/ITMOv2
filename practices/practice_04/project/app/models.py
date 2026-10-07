from pydantic import BaseModel, field_validator
from typing import List, Tuple

from .config import MAX_PATTERN_LEN, MAX_TEXT_LEN, MAX_MATCHES, DEFAULT_TIMEOUT_SEC, ABS_TIMEOUT_CEILING


class RegexTestRequest(BaseModel):
    pattern: str
    text: str
    flags: str | None = None
    limit: int | None = None
    timeout_sec: float | None = None

    # Do not raise here for empty/oversize to avoid 422; handle in endpoint for 400/413
    # This keeps control of status codes per project requirements

    @field_validator('text')
    @classmethod
    def non_empty_text(cls, v: str) -> str:
        if v is None:
            raise ValueError('text is required')
        return v

    @field_validator('limit')
    @classmethod
    def validate_limit(cls, v: int | None) -> int | None:
        if v is None:
            return v
        if v <= 0:
            raise ValueError('limit must be positive')
        return min(v, MAX_MATCHES)

    @field_validator('timeout_sec')
    @classmethod
    def validate_timeout(cls, v: float | None) -> float | None:
        if v is None:
            return v
        if v <= 0:
            raise ValueError('timeout_sec must be positive')
        if v > ABS_TIMEOUT_CEILING:
            return ABS_TIMEOUT_CEILING
        return v


class MatchModel(BaseModel):
    span: Tuple[int, int]
    groups: List[str]


class RegexTestResponse(BaseModel):
    matches: List[MatchModel]
    count: int
    meta: dict
