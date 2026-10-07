from fastapi.testclient import TestClient
from app.main import app


client = TestClient(app)


def test_oversize_text_returns_413_and_skips_engine():
    app.state.engine.call_count = 0
    payload = {
        "pattern": "a+",
        "text": "a" * 20001,
    }
    resp = client.post("/regex/test", json=payload)
    assert resp.status_code == 413, resp.text
    assert app.state.engine.call_count == 0


def test_oversize_pattern_returns_413_and_skips_engine():
    app.state.engine.call_count = 0
    payload = {
        "pattern": "a" * 2001,
        "text": "a" * 10,
    }
    resp = client.post("/regex/test", json=payload)
    assert resp.status_code == 413, resp.text
    assert app.state.engine.call_count == 0


def test_invalid_flags_returns_400():
    payload = {
        "pattern": "a+",
        "text": "aaaa",
        "flags": "z",
    }
    resp = client.post("/regex/test", json=payload)
    assert resp.status_code == 400, resp.text


def test_empty_pattern_returns_400():
    payload = {
        "pattern": "",
        "text": "aaaa",
    }
    resp = client.post("/regex/test", json=payload)
    assert resp.status_code == 400, resp.text
