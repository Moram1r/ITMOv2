from fastapi import HTTPException


class PayloadTooLargeError(Exception):
    pass


class InvalidPatternError(Exception):
    def __init__(self, detail: str):
        self.detail = detail


class InvalidFlagsError(Exception):
    def __init__(self, flag: str):
        self.flag = flag


class EngineTimeoutError(Exception):
    def __init__(self, timeout_sec: float):
        self.timeout_sec = timeout_sec


def to_http_error(exc: Exception) -> HTTPException:
    if isinstance(exc, PayloadTooLargeError):
        return HTTPException(status_code=413, detail={"detail": "payload too large"})
    if isinstance(exc, InvalidFlagsError):
        return HTTPException(status_code=400, detail={"detail": f"invalid flag: {exc.flag}"})
    if isinstance(exc, InvalidPatternError):
        return HTTPException(status_code=400, detail={"detail": exc.detail})
    if isinstance(exc, EngineTimeoutError):
        return HTTPException(status_code=504, detail={"detail": "engine timeout", "timeout_sec": exc.timeout_sec})
    return HTTPException(status_code=500, detail={"detail": "internal error"})
