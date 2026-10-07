from fastapi import FastAPI
from fastapi import HTTPException

from .config import DEFAULT_TIMEOUT_SEC, MAX_MATCHES
from .errors import to_http_error
from .engine import RegexEngine
from .models import RegexTestRequest, RegexTestResponse, MatchModel

app = FastAPI(title="Regex Tester API")


def get_engine() -> RegexEngine:
    # Simple DI; in tests we can inspect call_count
    return app.state.engine  # type: ignore[attr-defined]


@app.on_event("startup")
def setup_state():
    app.state.engine = RegexEngine()


@app.post("/regex/test", response_model=RegexTestResponse)
def test_regex(req: RegexTestRequest):
    """
    Minimal starter implementation intentionally missing A-logic (413 checks and flags parsing)
    so tests for A start RED. B timeout behavior is provided by the engine itself.
    """
    try:
        engine = get_engine()
        # Ignore flags for now (A will add validation and parsing)
        compiled = engine.compile(req.pattern, 0)

        limit = req.limit or MAX_MATCHES
        timeout_sec = req.timeout_sec or DEFAULT_TIMEOUT_SEC

        matches, time_ms, timed_out = engine.finditer(compiled, req.text, limit, timeout_sec)
        return RegexTestResponse(
            matches=[MatchModel(span=m.span, groups=m.groups) for m in matches],
            count=len(matches),
            meta={"timed_out": timed_out, "time_ms": round(time_ms, 3)},
        )
    except Exception as e:  # Map to HTTP errors
        raise to_http_error(e)
