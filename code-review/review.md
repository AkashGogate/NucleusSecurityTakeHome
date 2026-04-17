# Code Review: Webhook Handler — Python

## Summary

Two critical SQL injections from f-string interpolation — whoever controls the webhook body controls the query. On top of that: the signature scheme is length-extension-vulnerable, there's no constant-time comparison (timing side-channel), and a hardcoded fallback secret kicks in silently if the env var isn't set. The medium issues are real but secondary; fix the SQL and the signature scheme first.

---

## Critical Issues

### 1. SQL Injection — Audit Insert (Lines 29–30)

`email` and the raw request body go directly into the SQL string via f-string. Whoever controls the webhook body controls the query.

```python
# VULNERABLE
cur.execute(
    f"INSERT INTO webhook_audit(email, raw_json) VALUES ('{email}', '{raw.decode('utf-8')}')"
)
```

`email` as `'); DROP TABLE users; --` runs arbitrary SQL. The `raw_json` field is worse — it's the full request body, so multi-statement injections of any length go right through.

**Fix — parameterized query:**
```python
cur.execute(
    "INSERT INTO webhook_audit(email, raw_json) VALUES (?, ?)",
    (email, raw.decode("utf-8")),
)
```

---

### 2. SQL Injection — Users Upsert (Lines 32–33)

Same f-string interpolation for `email` and `role`.

```python
# VULNERABLE
cur.execute(
    f"INSERT INTO users(email, role) VALUES('{email}', '{role}')"
)
```

**Fix:**
```python
cur.execute(
    "INSERT INTO users(email, role) VALUES (?, ?)",
    (email, role),
)
```

---

## High Issues

### 3. Non-Constant-Time Signature Comparison (Line 15)

`expected == sig` short-circuits on the first differing byte. An attacker can infer the correct HMAC byte-by-byte by measuring response latency.

```python
# VULNERABLE
return expected == sig
```

**Fix:**
```python
import hmac
return hmac.compare_digest(expected, sig)
```

---

### 4. Length-Extension Vulnerable Signature Scheme (Lines 13–14)

`SHA256(secret + body)` is a Merkle–Damgård construction. If an attacker knows `len(secret)`, they can compute `SHA256(secret + body + padding + extra)` without knowing the secret — valid signature, forged payload.

```python
# VULNERABLE
expected = hashlib.sha256(
    (WEBHOOK_SECRET + body.decode("utf-8")).encode("utf-8")
).hexdigest()
```

**Fix — use HMAC:**
```python
import hmac as hmac_mod
expected = hmac_mod.new(
    WEBHOOK_SECRET.encode("utf-8"), body, "sha256"
).hexdigest()
```

---

### 5. Hardcoded Fallback Secret (Line 6)

`os.getenv("WEBHOOK_SECRET", "dev-secret")` silently falls back to `"dev-secret"` in a misconfigured deployment. Anyone who reads the source can sign arbitrary payloads.

```python
# VULNERABLE
WEBHOOK_SECRET = os.getenv("WEBHOOK_SECRET", "dev-secret")
```

**Fix — crash at startup if unset:**
```python
WEBHOOK_SECRET = os.environ.get("WEBHOOK_SECRET")
if not WEBHOOK_SECRET:
    raise RuntimeError(
        "WEBHOOK_SECRET environment variable is required — refusing to start."
    )
```

---

## Medium Issues

### 6. Unhandled `json.loads` Exception → 500 (Line 24)

Malformed JSON raises `json.JSONDecodeError`, which Flask turns into an unhandled 500. In debug mode, the stack trace leaks implementation details.

```python
# VULNERABLE — no try/except
payload = json.loads(raw.decode("utf-8"))
```

**Fix:**
```python
try:
    payload = json.loads(raw.decode("utf-8"))
except (json.JSONDecodeError, UnicodeDecodeError):
    return {"error": "Invalid JSON payload"}, 400
```

---

### 7. No Input Validation on `email` / `role` (Lines 25–26)

`email` has no format or length check. `role` has no allowlist — any string gets through, including `"superadmin"`, `"'; DROP TABLE"`, or a 10 MB payload.

```python
import re

ALLOWED_ROLES = {"user", "admin", "viewer"}
MAX_EMAIL_LEN = 254  # RFC 5321

email = payload.get("email", "")
role  = payload.get("role", "user")

if not isinstance(email, str) or len(email) > MAX_EMAIL_LEN:
    return {"error": "Invalid email"}, 400
if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
    return {"error": "Invalid email format"}, 400
if role not in ALLOWED_ROLES:
    return {"error": f"role must be one of: {sorted(ALLOWED_ROLES)}"}, 400
```

---

### 8. DB Connection Never Closed (Lines 9, 27)

`get_db()` opens a new SQLite connection per request with no `finally` block or context manager. An exception between `get_db()` and `db.commit()` leaks the connection.

```python
# VULNERABLE — no close on exception path
db = get_db()
cur = db.cursor()
...
db.commit()
```

**Fix — use context manager:**
```python
with sqlite3.connect(DB_PATH) as db:
    cur = db.cursor()
    cur.execute("INSERT INTO webhook_audit ...", (email, raw_body))
    cur.execute("INSERT INTO users ...", (email, role))
    # commits on __exit__, rolls back on exception
```

---

## Low / Info Issues

### 9. `host="0.0.0.0"` Binds All Interfaces (Line 39)

Binds the dev server to every interface. This is fine behind a reverse proxy but not something to ship directly. Flask's dev server is also single-threaded.

```python
if __name__ == "__main__":
    # Dev only — use gunicorn/uWSGI in production
    app.run(host="127.0.0.1", port=8080, debug=False)
```

---

## What Works

- Raw body is read before JSON parsing — required for signature verification over exact wire bytes.
- Secrets come from environment variables. Right pattern, just needs the missing-value guard.
- `@app.post` is correct Flask 2.x idiom.

---

## Corrected Handler (Full)

```python
import os
import re
import json
import hmac as hmac_mod
import time
import sqlite3
from flask import Flask, request

app = Flask(__name__)
DB_PATH = os.environ.get("DB_PATH", "/tmp/app.db")
WEBHOOK_SECRET = os.environ.get("WEBHOOK_SECRET")
if not WEBHOOK_SECRET:
    raise RuntimeError("WEBHOOK_SECRET environment variable is required.")

ALLOWED_ROLES = {"user", "admin", "viewer"}
MAX_EMAIL_LEN = 254
MAX_SKEW_SECS = 300


def verify(sig: str, body: bytes, timestamp: str) -> bool:
    msg = f"{timestamp}:".encode() + body
    expected = hmac_mod.new(WEBHOOK_SECRET.encode(), msg, "sha256").hexdigest()
    return hmac_mod.compare_digest(expected, sig)


@app.post("/webhook")
def webhook():
    raw       = request.data
    sig       = request.headers.get("X-Signature", "")
    timestamp = request.headers.get("X-Timestamp", "")

    try:
        if abs(time.time() - int(timestamp)) > MAX_SKEW_SECS:
            return {"error": "Request expired"}, 401
    except ValueError:
        return {"error": "Missing or invalid X-Timestamp"}, 401

    if not verify(sig, raw, timestamp):
        return {"error": "Invalid signature"}, 401

    try:
        payload = json.loads(raw.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError):
        return {"error": "Invalid JSON payload"}, 400

    email = payload.get("email", "")
    role  = payload.get("role", "user")

    if not isinstance(email, str) or len(email) > MAX_EMAIL_LEN:
        return {"error": "Invalid email"}, 400
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        return {"error": "Invalid email format"}, 400
    if role not in ALLOWED_ROLES:
        return {"error": f"role must be one of {sorted(ALLOWED_ROLES)}"}, 400

    with sqlite3.connect(DB_PATH) as db:
        cur = db.cursor()
        cur.execute(
            "INSERT INTO webhook_audit(email, raw_json) VALUES (?, ?)",
            (email, raw.decode("utf-8")),
        )
        cur.execute(
            "INSERT INTO users(email, role) VALUES (?, ?)",
            (email, role),
        )

    return {"ok": True}, 200


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=8080, debug=False)
```