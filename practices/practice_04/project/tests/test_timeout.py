from fastapi.testclient import TestClient
from app.main import app


client = TestClient(app)


def test_catastrophic_backtracking_timeout_returns_504():
    # Regex engine with timeout should raise 504 for pathological pattern
    payload = {
        "pattern": "(a+)+",
        "text": "a" * 15000,
        "timeout_sec": 0.1,
    }
    resp = client.post("/regex/test", json=payload)
    assert resp.status_code == 504, resp.text
    body = resp.json()
    assert body.get("detail", {}).get("detail") == "engine timeout"


def test_ok_under_timeout_returns_200():
    payload = {
        "pattern": "a+",
        "text": "a" * 1000,
        "timeout_sec": 1.5,
        "limit": 5,
    }
    resp = client.post("/regex/test", json=payload)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["count"] >= 1
    assert "meta" in body
