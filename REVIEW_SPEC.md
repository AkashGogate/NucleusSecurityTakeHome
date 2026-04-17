# REVIEW_SPEC.md — Code Review Checklist

Output file: `code-review/review.md`

Review **both** the PHP and Python webhook handler. PHP LSP activates automatically
on `.php` files if installed and verified active. Pyright activates on `.py` files if
installed and verified active. If either LSP is absent, apply the manual review
guidance from docs/PLUGINS.md fallback rules.

---

## Python source (`app.py`)

```python
import os, json, sqlite3, hashlib
from flask import Flask, request

app = Flask(__name__)
DB_PATH = os.getenv("DB_PATH", "/tmp/app.db")
WEBHOOK_SECRET = os.getenv("WEBHOOK_SECRET", "dev-secret")   # line 6

def get_db():
    return sqlite3.connect(DB_PATH)                           # line 9

def verify(sig, body: bytes) -> bool:
    expected = hashlib.sha256(
        (WEBHOOK_SECRET + body.decode("utf-8")).encode("utf-8")
    ).hexdigest()
    return expected == sig                                     # line 15

@app.post("/webhook")
def webhook():
    raw = request.data
    sig = request.headers.get("X-Signature", "")
    if not verify(sig, raw):
        return ("bad sig", 401)
    payload = json.loads(raw.decode("utf-8"))                 # line 24
    email = payload.get("email", "")
    role  = payload.get("role", "user")
    db = get_db()
    cur = db.cursor()
    cur.execute(                                               # line 29
        f"INSERT INTO webhook_audit(email, raw_json) VALUES ('{email}', '{raw.decode('utf-8')}')"
    )
    cur.execute(                                               # line 32
        f"INSERT INTO users(email, role) VALUES('{email}', '{role}')"
    )
    db.commit()
    return ("ok", 200)

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8080)                       # line 39
```

## PHP source (`webhook.php`)

```php
<?php
require_once "db.php";

$WEBHOOK_SECRET = getenv("WEBHOOK_SECRET") ?: "dev-secret";   // line 4
$DB_AUDIT_ENABLED = getenv("AUDIT_ENABLED") ?: "true";

function verify_signature($sig, $body, $secret) {
    $expected = hash("sha256", $secret . $body);              // line 8
    return $expected == $sig;                                  // line 9
}

$method = $_SERVER["REQUEST_METHOD"] ?? "GET";
$path = parse_url($_SERVER["REQUEST_URI"], PHP_URL_PATH);

if ($method !== "POST" || $path !== "/webhook") {
    http_response_code(404);
    echo "not found";
    exit;
}

$raw = file_get_contents("php://input");
$sig = $_SERVER["HTTP_X_SIGNATURE"] ?? "";

if (!verify_signature($sig, $raw, $WEBHOOK_SECRET)) {
    http_response_code(401);
    echo "bad sig";
    exit;
}

$payload = json_decode($raw, true);
$email = $payload["email"] ?? "";
$role  = $payload["role"] ?? "user";

if ($DB_AUDIT_ENABLED) {
    $pdo->exec("INSERT INTO webhook_audit(email, raw_json) VALUES ('$email', '$raw')");  // line 35
}

$pdo->exec("INSERT INTO users(email, role) VALUES('$email', '$role')");                  // line 38
echo "ok";
```

---

## Required issues — Python (9)

| # | Issue | Lines | Severity |
|---|-------|-------|----------|
| 1 | SQL injection — audit insert (f-string) | 29–30 | Critical |
| 2 | SQL injection — users upsert (f-string) | 32–33 | Critical |
| 3 | Non-constant-time comparison (`==`) | 15 | High |
| 4 | Weak sig scheme: SHA256(secret+body) → length-extension | 13–14 | High |
| 5 | Hardcoded `"dev-secret"` fallback | 6 | High |
| 6 | Unhandled `json.loads` → unintended 500 | 24 | Medium |
| 7 | No input validation (email format, role allowlist, lengths) | 25–26 | Medium |
| 8 | DB connection never closed | 9, 27 | Medium |
| 9 | `host="0.0.0.0"` exposes all interfaces | 39 | Low/Info |

## Required issues — PHP (9)

| # | Issue | Lines | Severity |
|---|-------|-------|----------|
| 1 | SQL injection — audit insert (string concat) | 35 | Critical |
| 2 | SQL injection — users upsert (string concat) | 38 | Critical |
| 3 | Non-constant-time comparison (`==`) | 9 | High |
| 4 | Weak sig scheme: SHA256(secret+body) | 8 | High |
| 5 | Hardcoded `"dev-secret"` fallback | 4 | High |
| 6 | `json_decode` returns null — not checked | — | Medium |
| 7 | No input validation on `$email` / `$role` | 29–30 | Medium |
| 8 | `$pdo` undefined / not in scope | 35, 38 | Medium |
| 9 | No replay protection (shared with Python) | — | Medium |

---

## Output format

```markdown
## Summary

## Python — Critical Issues
### [Title] (Line N)
**Problem:** ...
**Fix:**
\`\`\`python
# corrected snippet
\`\`\`

## Python — High / Medium / Low Issues
...

## PHP — Critical Issues
...

## Shared Issues (both versions)
...

## Positive Notes
...
```
