from fastapi import FastAPI
from fastapi import HTTPException

from .config import DEFAULT_TIMEOUT_SEC, MAX_MATCHES, MAX_TEXT_LEN, MAX_PATTERN_LEN
from .errors import to_http_error, PayloadTooLargeError, InvalidPatternError, InvalidFlagsError
from .flags import parse_flags
from .engine import RegexEngine
from .models import RegexTestRequest, RegexTestResponse, MatchModel

app = FastAPI(title="Regex Tester API")


def get_engine() -> RegexEngine:
    # Simple DI; in tests we can inspect call_count
    return app.state.engine  # type: ignore[attr-defined]


# Ensure engine is available even before FastAPI startup events run (e.g., in tests)
# Tests may access app.state.engine directly prior to the first request.
try:
    app.state.engine
except Exception:
    app.state.engine = RegexEngine()


@app.on_event("startup")
def setup_state():
    app.state.engine = RegexEngine()


@app.post("/regex/test", response_model=RegexTestResponse)
def test_regex(req: RegexTestRequest):
    """
    Implements Feature A: early 413 checks and flags validation before touching the engine.
    Timeout handling is delegated to the engine (Feature B).
    """
    try:
        # Early 413 checks — must happen before any engine interaction
        if len(req.text) > MAX_TEXT_LEN or len(req.pattern) > MAX_PATTERN_LEN:
            raise PayloadTooLargeError()

        # Empty pattern → 400 (project requirement)
        if not req.pattern:
            raise InvalidPatternError('pattern must not be empty')

        # Flags parsing/validation
        flags_mask, invalid = parse_flags(req.flags)
        if invalid:
            raise InvalidFlagsError(invalid[0])

        engine = get_engine()
        compiled = engine.compile(req.pattern, flags_mask)

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
