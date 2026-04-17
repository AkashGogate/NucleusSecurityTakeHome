# Engineering Intern Interview Questions

## Introduction

Thank you for your interest in the Nucleus Security Engineering
internship program! This document contains 2 primary interview
challenges for you. The first is a code review question, and the second
is a coding challenge.

For both, we absolutely encourage the use of AI. If you do use AI, we
would like for you to share your prompts and then answer the follow-up
questions about how you thought through your prompts.

We know this time of the year is crazy for college students and that
your time is very valuable. Please try not to spend more than about 1
total hour collectively on this.

------------------------------------------------------------------------

## Contents

-   Introduction
-   Code Review (10 minutes)
    -   Task
    -   PHP
    -   Python
    -   Code comments
    -   Follow-up Questions
-   Coding Challenge (\~50 minutes)
    -   Exercise
    -   Follow-up questions
-   Delivery

------------------------------------------------------------------------

# Code Review (10 minutes)

You are welcome and encouraged to use AI for this section. If you do,
please provide your prompts and answer the questions in the follow-up
section.

## Task

Your colleague or team member was given the following task:

1.  Add a `/webhook` endpoint to receive vendor events about users who
    are vendors.

2.  Input data will look like:

    ``` json
    {"email":"a@b.com","role":"admin","metadata":{"source":"vendor"}}
    ```

3.  Verify signature header `X-Signature`.

4.  Parse JSON and upsert the user data.

5.  Store the raw payload for audit/debug.

They have opened a PR with the code below. Review the code and comment
on any issues you find.

**Note:** Both the PHP and Python do the same thing. You can choose to
review whichever one you want. It is not intended for you to review
both.

------------------------------------------------------------------------

## PHP

``` php
<?php
// webhook.php
require_once "db.php"; // provides $pdo (PDO instance)

// Config (dev defaults)
$WEBHOOK_SECRET = getenv("WEBHOOK_SECRET") ?: "dev-secret";
$DB_AUDIT_ENABLED = getenv("AUDIT_ENABLED") ?: "true";

function verify_signature($sig, $body, $secret) {
    // Vendor docs: SHA256(secret + body)
    $expected = hash("sha256", $secret . $body);
    return $expected == $sig; // simple compare
}

$method = $_SERVER["REQUEST_METHOD"] ?? "GET";
$path = parse_url($_SERVER["REQUEST_URI"], PHP_URL_PATH);

// Basic routing
if ($method !== "POST" || $path !== "/webhook") {
    http_response_code(404);
    echo "not found";
    exit;
}

$raw = file_get_contents("php://input"); // raw body string
$sig = $_SERVER["HTTP_X_SIGNATURE"] ?? "";

if (!verify_signature($sig, $raw, $WEBHOOK_SECRET)) {
    http_response_code(401);
    echo "bad sig";
    exit;
}

// Decode JSON
$payload = json_decode($raw, true);
$email = $payload["email"] ?? "";
$role = $payload["role"] ?? "user";

// Store raw payload for auditing / debugging
if ($DB_AUDIT_ENABLED) {
    $pdo->exec("INSERT INTO webhook_audit(email, raw_json) VALUES ('$email', '$raw')");
}

// Upsert user (simple)
$pdo->exec("INSERT INTO users(email, role) VALUES('$email', '$role')");

echo "ok";
```

------------------------------------------------------------------------

## Python

``` python
# app.py
import os
import json
import sqlite3
import hashlib
from flask import Flask, request

app = Flask(__name__)
DB_PATH = os.getenv("DB_PATH", "/tmp/app.db")
WEBHOOK_SECRET = os.getenv("WEBHOOK_SECRET", "dev-secret")  # default for dev

def get_db():
    return sqlite3.connect(DB_PATH)

def verify(sig, body: bytes) -> bool:
    # Vendor docs: SHA256(secret + body)
    expected = hashlib.sha256(
        (WEBHOOK_SECRET + body.decode("utf-8")).encode("utf-8")
    ).hexdigest()
    return expected == sig  # simple compare

@app.post("/webhook")
def webhook():
    raw = request.data  # bytes
    sig = request.headers.get("X-Signature", "")

    if not verify(sig, raw):
        return ("bad sig", 401)

    payload = json.loads(raw.decode("utf-8"))

    # Example payload:
    # {"email":"a@b.com","role":"admin","metadata":{"source":"vendor"}}
    email = payload.get("email", "")
    role = payload.get("role", "user")

    db = get_db()
    cur = db.cursor()

    # Store raw payload for auditing / debugging
    cur.execute(
        f"INSERT INTO webhook_audit(email, raw_json) VALUES ('{email}', '{raw.decode('utf-8')}')"
    )

    # Upsert user
    cur.execute(
        f"INSERT INTO users(email, role) VALUES('{email}', '{role}')"
    )

    db.commit()

    return ("ok", 200)

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8080)
```

------------------------------------------------------------------------

## Code comments

I reviewed the Python version.

**General:** The overall structure is sound — the signature check correctly happens before any database access, and storing the raw payload separately from the parsed fields is good practice for auditing. However the code has several serious security issues that would need to be resolved before this could ship.

**Line 10 — hardcoded fallback secret**

`WEBHOOK_SECRET = os.getenv("WEBHOOK_SECRET", "dev-secret")`

The string `"dev-secret"` as a default means any deployment that forgets to set the environment variable will silently accept signatures computed against a publicly known key. The application should raise an error at startup if the variable is unset:

```python
WEBHOOK_SECRET = os.environ["WEBHOOK_SECRET"]  # raises KeyError if missing
```

**Lines 13–14 — weak signature scheme (length-extension vulnerability)**

`hashlib.sha256((WEBHOOK_SECRET + body.decode("utf-8")).encode("utf-8")).hexdigest()`

Concatenating the secret and body before hashing is vulnerable to a length-extension attack. An attacker who knows one valid `(message, signature)` pair can append bytes to the message and produce a valid signature for the extended message without knowing the secret. The correct construction is HMAC:

```python
import hmac
expected = hmac.new(
    WEBHOOK_SECRET.encode("utf-8"), body, hashlib.sha256
).hexdigest()
```

**Line 15 — non-constant-time signature comparison**

`return expected == sig`

The `==` operator short-circuits as soon as it finds a differing byte, leaking timing information. An attacker can measure response latency to recover the correct signature byte-by-byte. Use `hmac.compare_digest`, which runs in constant time:

```python
return hmac.compare_digest(expected, sig)
```

**Line 24 — unhandled `json.loads` exception**

`payload = json.loads(raw.decode("utf-8"))`

If the request body is malformed JSON, this raises an unhandled `JSONDecodeError` and returns a 500. The endpoint should catch this and return 400:

```python
try:
    payload = json.loads(raw)
except (json.JSONDecodeError, UnicodeDecodeError):
    return ("invalid json", 400)
```

**Lines 25–26 — no input validation**

`email` and `role` are used verbatim with no format check, length cap, or allowlist. Nothing prevents a caller from submitting `role=superadmin` or a very long string. At minimum: validate email format, cap field lengths, and restrict `role` to a fixed set of known values (e.g. `["user", "admin", "vendor"]`).

**Lines 29–30 and 32–33 — SQL injection (critical)**

```python
cur.execute(
    f"INSERT INTO webhook_audit(email, raw_json) VALUES ('{email}', '{raw.decode('utf-8')}')"
)
cur.execute(
    f"INSERT INTO users(email, role) VALUES('{email}', '{role}')"
)
```

Both queries interpolate user-controlled values directly into the SQL string. Any payload containing a single quote terminates the string literal and allows arbitrary SQL execution. Both calls must use parameterised queries:

```python
cur.execute(
    "INSERT INTO webhook_audit(email, raw_json) VALUES (?, ?)",
    (email, raw.decode("utf-8"))
)
cur.execute(
    "INSERT OR REPLACE INTO users(email, role) VALUES (?, ?)",
    (email, role)
)
```

**Lines 9 and 27 — database connection never closed**

`get_db()` opens a new SQLite connection on every request and nothing closes it. Under any meaningful load this exhausts file descriptors. Use a context manager so the connection is always closed:

```python
with sqlite3.connect(DB_PATH) as db:
    cur = db.cursor()
    # ... queries ...
    db.commit()
```

**Line 39 — `host="0.0.0.0"` in the dev entry point**

`app.run(host="0.0.0.0", port=8080)`

Binding to all interfaces is fine behind a reverse proxy but dangerous if this file is ever run directly in an environment where port 8080 is publicly reachable. Worth documenting the intended deployment topology or defaulting to `127.0.0.1`.

------------------------------------------------------------------------

## Follow-up Questions

1. **Prompts and AI outputs**

---

**Prompt 1 — Project scaffolding and CLAUDE.md**

*What I was hoping for:* A concise root `CLAUDE.md` file that acts as a lightweight index into more detailed spec files in a `docs/` folder, keeping per-request token cost low while still giving the AI full context on structure, rules, and deliverables.

*Prompt text:*

> "Create a CLAUDE.md file for a Nucleus Security engineering internship interview project. It should be under 500 tokens, list the repo layout, state non-negotiable rules (plugin verification before use, TDD, pyright gating on Python, frontend-design skill check before any HTML/CSS/JS), and point to a docs/ folder for all detailed specs. Do not put spec detail directly in CLAUDE.md."

*AI output:*

```markdown
# CLAUDE.md

## Project
Nucleus Security Engineering Intern interview — two deliverables:
1. `code-review/review.md` — security review of Python and PHP webhook handler
2. `calculator/` — full-stack web calculator (Flask + HTML/CSS/JS)

## Repo layout
/
├── code-review/review.md
├── calculator/
│   ├── backend/{app.py,requirements.txt,tests/test_calc.py}
│   └── frontend/{index.html,style.css,main.js}
├── docs/
│   ├── PLUGINS.md       ← plugin verification commands + fallback rules
│   ├── REVIEW_SPEC.md   ← code-review checklist (9 issues × 2 languages)
│   ├── CALC_SPEC.md     ← calculator requirements + E2E scenarios
│   └── DONE.md          ← definition-of-done checklist
└── README.md

## Non-negotiable rules
- Read `docs/PLUGINS.md` at session start
- Verify before use: run `claude plugin list` before invoking any plugin feature;
  if absent or disabled, fall back to built-in Claude knowledge — never block
- TDD: write failing test before implementation (red → green → refactor)
- Frontend: check for frontend-design skill/plugin before any HTML/CSS/JS
- CLAUDE.md stays lean; all detail lives in `docs/`
```

*What it actually did:* Produced exactly the lean index file requested — tight word count, directory tree for layout, each rule expressed in one line with no redundant explanation.

*Did I re-prompt:* No.

---

**Prompt 2 — PLUGINS.md with verification and fallback matrix**

*What I was hoping for:* A plugin reference document covering every plugin with exact bash verification commands, explicit three-condition LSP checks (plugin enabled + binary in PATH + `ENABLE_LSP_TOOL=1`), install commands, and a concrete named fallback for each plugin describing what the AI should do if it is absent — so work never blocks on a missing plugin.

*Prompt text:*

> "Create docs/PLUGINS.md. For each plugin — Caveman, claude-code-setup, pyright, vtsls, php-lsp, frontend-design, Playwright, Superpowers, Ralph Loop — provide: the exact bash verify command using `claude plugin list | grep`, all three conditions required for LSP activation (plugin enabled + binary in PATH + ENABLE_LSP_TOOL=1), the install commands with correct marketplace and package names, and a specific concrete fallback describing what Claude should do if the plugin is absent. End with a single session-start verification block that checks all binaries at once."

*AI output (pyright section):*

```
### pyright — Python type checking (LSP)

Verify:
  claude plugin list | grep pyright
  which pyright
  echo $ENABLE_LSP_TOOL  # must be "1"

Install:
  claude plugin install pyright@claude-code-lsps
  pip install pyright
  export ENABLE_LSP_TOOL=1

Fallback: If pyright is absent or ENABLE_LSP_TOOL is unset, use built-in Python
knowledge to review types manually. Apply extra scrutiny to function signatures,
return types, and variable annotations. Still enforce zero obvious type errors
before moving to the next function — just without automated diagnostics.
```

*AI output (session-start verification block):*

```bash
echo "=== PLUGIN STATUS ==="
claude plugin list

echo "=== LSP PREREQUISITE ==="
echo "ENABLE_LSP_TOOL=${ENABLE_LSP_TOOL}"

which pyright       2>/dev/null && echo "pyright OK"       || echo "pyright MISSING"
which vtsls         2>/dev/null && echo "vtsls OK"         || echo "vtsls MISSING"
which intelephense  2>/dev/null && echo "intelephense OK"  || echo "intelephense MISSING"
npx playwright --version 2>/dev/null && echo "playwright OK" || echo "playwright MISSING"
```

*What it actually did:* Produced a complete matrix covering all 9 plugins. Each entry had exact grep commands, the three-condition LSP check, correct install commands, and specific fallback behaviour rather than a vague "proceed without the plugin."

*Did I re-prompt:* Yes, once. The first pass listed fallbacks as vague one-liners. I re-prompted asking each fallback to name the specific code patterns to scrutinise manually (e.g. "watch for string-concatenated SQL in php-lsp fallback"). The second pass was correct.

---

**Prompt 3 — REVIEW_SPEC.md**

*What I was hoping for:* A structured checklist of all required issues for both webhook handlers with line numbers and severity ratings, so the AI has a complete target list rather than discovering issues from scratch each run.

*Prompt text:*

> "Create docs/REVIEW_SPEC.md. Embed both the PHP and Python webhook source listings with line numbers annotated inline as comments. Then produce two issue tables — one per language — each listing 9 required issues with: issue name, affected line numbers, and severity (Critical / High / Medium / Low). Include the output format template for code-review/review.md at the bottom."

*AI output (Python issues table):*

```
## Required issues — Python (9)

| # | Issue                                       | Lines  | Severity |
|---|---------------------------------------------|--------|----------|
| 1 | SQL injection — audit insert (f-string)     | 29–30  | Critical |
| 2 | SQL injection — users upsert (f-string)     | 32–33  | Critical |
| 3 | Non-constant-time comparison (==)           | 15     | High     |
| 4 | Weak sig scheme: SHA256(secret+body)        | 13–14  | High     |
| 5 | Hardcoded "dev-secret" fallback             | 6      | High     |
| 6 | Unhandled json.loads → unintended 500       | 24     | Medium   |
| 7 | No input validation (email, role, lengths)  | 25–26  | Medium   |
| 8 | DB connection never closed                  | 9, 27  | Medium   |
| 9 | host="0.0.0.0" exposes all interfaces       | 39     | Low      |
```

*What it actually did:* Produced both source listings with inline line-number annotations, both 9-issue tables with severity classifications, and a clean output format template. Severity ratings matched my expectations.

*Did I re-prompt:* No.

---

**Prompt 4 — CALC_SPEC.md**

*What I was hoping for:* A complete calculator specification in one file covering the backend endpoint, TDD test matrix, frontend design requirements, keyboard support, JS safe-eval fallback, Playwright E2E scenarios with curl fallbacks, and Ralph Loop invocations — all with plugin verification gates.

*Prompt text:*

> "Create docs/CALC_SPEC.md covering: (1) Flask POST /calculate with ast-based safe eval, never eval(), CORS, and 400 error handling; (2) requirements.txt; (3) a 14-row TDD test matrix; (4) frontend requirements with verification steps for the frontend-design skill and vtsls before writing any file, button layout, keyboard map, and JS safe-eval fallback; (5) Playwright E2E scenarios with working curl fallbacks for when Playwright is absent; (6) Ralph Loop invocations for backend and frontend gated behind plugin verification."

*AI output (TDD test matrix, excerpt):*

```
| Expression              | Expected  |
|-------------------------|-----------|
| "2+2"                   | 4         |
| "10/4"                  | 2.5       |
| "3**2"                  | 9         |
| "3+4*2"                 | 11        |
| "-5+3"                  | -2        |
| "1/0"                   | 400 error |
| "__import__('os')"      | 400 error |
| "open('/etc/passwd')"   | 400 error |
```

*AI output (Playwright-absent curl fallback, excerpt):*

```bash
# Scenario 1+2 — backend math correctness
curl -s -X POST http://localhost:5000/calculate \
  -H "Content-Type: application/json" \
  -d '{"expression":"3+4*2"}' | python3 -c \
  "import sys,json; r=json.load(sys.stdin); assert r['result']==11"
echo "Scenarios 1+2: PASS"

# Scenario 3 — division by zero
curl -s -X POST http://localhost:5000/calculate \
  -H "Content-Type: application/json" \
  -d '{"expression":"1/0"}' | python3 -c \
  "import sys,json; r=json.load(sys.stdin); assert 'error' in r"
echo "Scenario 3: PASS"
```

*What it actually did:* Produced all six sections. The test matrix covered all 14 cases including the security-relevant malicious inputs. The curl fallback section provided working commands for automatable scenarios and clearly flagged that keyboard and chaining tests require manual browser verification when Playwright is absent.

*Did I re-prompt:* Yes, once. The first pass omitted the plugin verification steps at the top of the frontend section. I re-prompted to add explicit bash checks for `vtsls` and `frontend-design` before any frontend code is written.

---

**Prompt 5 — main Claude Code prompt (Phase 0–4)**

*What I was hoping for:* A single self-contained prompt to paste into Claude Code that orchestrates the full project in four phases — verification, code review, backend TDD, frontend build — with every plugin dependency expressed as a conditional branch (if verified active: use it; if absent: fall back silently) rather than a hard requirement.

*Prompt text:*

> "Create the main claude_code_prompt.md. Open by instructing Claude to read CLAUDE.md and docs/PLUGINS.md first. Define four phases: Phase 0 runs a bash verification block for all plugins and records results; Phase 1 does the code review with conditional pyright/php-lsp paths; Phase 2 builds the backend with TDD, conditional pyright gating, and an optional Ralph loop; Phase 3 builds the frontend with conditional frontend-design skill loading, conditional vtsls linting, and conditional Playwright E2E; Phase 4 walks DONE.md and writes README. Every plugin use must be preceded by an if-verified-active / else-fallback branch. The final status report must list active plugins, fallbacks applied, and test counts."

*AI output (Phase 0 verification block):*

```
PHASE 0 — SESSION VERIFICATION

Run this block first. Record the results — they govern which tool
paths apply in every phase that follows.

  echo "=== PLUGIN STATUS ==="
  claude plugin list

  echo "=== LSP PREREQUISITE ==="
  echo "ENABLE_LSP_TOOL=${ENABLE_LSP_TOOL}"

  which pyright       2>/dev/null && echo "pyright binary: OK"      || echo "pyright binary: MISSING"
  which vtsls         2>/dev/null && echo "vtsls binary: OK"        || echo "vtsls binary: MISSING"
  which intelephense  2>/dev/null && echo "intelephense binary: OK" || echo "intelephense binary: MISSING"

After running, note which plugins are confirmed active and which are absent.
For every absent plugin, apply the fallback from docs/PLUGINS.md silently.
Do not prompt the user to install anything. Do not block.
```

*AI output (Phase 1 conditional branch):*

```
PHASE 1 — CODE REVIEW

PHP review:
- If php-lsp verified active AND intelephense binary found AND ENABLE_LSP_TOOL=1:
  open webhook.php and use live Intelephense diagnostics to augment manual review
- Otherwise: review webhook.php using built-in PHP knowledge; pay extra attention
  to string-concatenated SQL ($pdo->exec), non-strict == comparisons,
  json_decode null returns, and $pdo scope.

Python review:
- If pyright verified active AND pyright binary found AND ENABLE_LSP_TOOL=1:
  open app.py and use live pyright diagnostics to augment manual review
- Otherwise: review app.py using built-in Python knowledge; pay extra attention
  to f-string SQL, hashlib.sha256 vs hmac, == compare, and connection lifecycle.
```

*What it actually did:* Produced all four phases with correct conditional branching at every plugin touch point. Each phase re-verified relevant plugins rather than relying solely on Phase 0 results. Ralph loop invocations were gated behind their own plugin check before the slash command.

*Did I re-prompt:* Yes, twice. The first pass used "if installed" rather than the full three-condition LSP check. I re-prompted to make all three conditions explicit. The second pass had Ralph loop invocations running unconditionally — I re-prompted to gate each one behind a verification check first.

---

**Prompt 6 — LSP binary re-check**

*What I was hoping for:* A short paste-ready plaintext prompt instructing Claude Code to verify all LSP binaries are present on the machine, activate live diagnostics for each language, re-run the test suite, and report results in a fixed format — without assuming any prior state.

*Prompt text:*

> "Give me a plaintext prompt to re-check the code and run tests with the language LSP plugins having their binaries actually on my computer."

*AI output:*

```
Step one — confirm the binaries exist locally. Run these checks and report
the result of each before doing anything else:

  which pyright
  which vtsls
  which intelephense
  echo $ENABLE_LSP_TOOL

If pyright is missing:       pip install pyright
If vtsls is missing:         npm install -g @vtsls/language-server typescript
If intelephense is missing:  npm install -g intelephense
If ENABLE_LSP_TOOL != 1:     export ENABLE_LSP_TOOL=1

Then confirm the corresponding plugins are installed and enabled:
  claude plugin list | grep -E "pyright|vtsls|php-lsp"

Step two — re-check the Python backend with live pyright diagnostics.
Open app.py and test_calc.py, run getDiagnostics on both files and fix every
error or warning reported. Then re-run the full test suite:
  cd calculator/backend && pytest -v

Step three — re-check the JS frontend with live vtsls diagnostics.
Open main.js, run getDiagnostics, fix all errors before finishing.

Step four — re-check the PHP webhook with live Intelephense diagnostics.
Open webhook.php, run getDiagnostics, and note any new issues not already
in code-review/review.md. If new issues are found, append them under a
section called "Additional issues found via live LSP diagnostics."

Step five — report:
  LSP binaries: pyright [OK/MISSING], vtsls [OK/MISSING], intelephense [OK/MISSING]
  ENABLE_LSP_TOOL: [value]
  Plugins active: pyright [Y/N], vtsls [Y/N], php-lsp [Y/N]
  pyright diagnostics on app.py: [N errors fixed / clean]
  pyright diagnostics on test_calc.py: [N errors fixed / clean]
  pytest result: [X/14 passed]
  vtsls diagnostics on main.js: [N errors fixed / clean]
  intelephense diagnostics on webhook.php: [N new issues found / clean]
  Blockers: [list or NONE]
```

*What it actually did:* Produced a step-by-step plaintext prompt with exact install commands for each missing binary, the correct grep command to verify plugin status, and a fixed-format summary report split cleanly across the three language contexts.

*Did I re-prompt:* No.

------------------------------------------------------------------------

# Coding Challenge (\~50 minutes)

For the below coding exercise, there is no expectation that you will
have a fully working solution. For anything you feel you didn't
accomplish, please let us know in the follow-up section after the
exercise.

## Exercise

Build a calculator web application. It should include a frontend piece
and any backend logic needed to perform the calculations.

You can use any language of your choosing for both the frontend and
backend code.

------------------------------------------------------------------------

## Follow-up questions

1. **How far were you able to get with the exercise?**

   The project was completed in full. The backend exposes a `POST /calculate` endpoint using Flask with an `ast`-based safe evaluator (no `eval()`), CORS headers, and 400 error handling for division by zero, invalid expressions, and malicious inputs such as `__import__`. The frontend includes all buttons, expression and result displays, keyboard input, operator chaining after equals, and a JS safe-eval fallback for when the backend is unreachable. Five Playwright end-to-end scenarios were written and pass against a running backend.

2. **What challenges did you encounter in the process?**

   **Safe expression evaluation.** Python's `ast` module requires building a `NodeVisitor` that explicitly allowlists every node type. Getting the allowlist right to support negative numbers (`UnaryOp` with `USub`) and float literals while still blocking attribute access and function calls required several test iterations before all 14 test cases passed.

   **Plugin verification overhead.** Structuring the Claude Code prompts so that every plugin use is gated behind an explicit verification check added significant complexity to the prompt authoring. The naive approach — just use the plugin — fails silently when a binary is missing even if the plugin appears installed. Working out the three-condition check (plugin list + binary in `PATH` + `ENABLE_LSP_TOOL=1`) for LSP plugins required iterating on the prompt structure.

   **JS safe-eval fallback.** The fallback needs to handle operator aliases (`×`, `÷`, `−`) and validate the expression before passing it to the `Function` constructor. Getting the regex allowlist to permit `**` for exponentiation while blocking everything else required careful character class construction.

3. **If you were given unlimited time, what additional functionality would you include?**

   - History panel showing the last N calculations, with the ability to click any prior result to reload it into the expression display
   - Scientific mode adding trigonometric functions, logarithms, and constants (π, e) — evaluated server-side so the sandbox stays consistent
   - Persistent calculation history via a lightweight SQLite table on the backend with a `GET /history` endpoint
   - Unit conversion built on top of the expression evaluator, so an expression like `5km + 3mi` computes the sum in a chosen unit
   - Dark/light theme toggle with the preference persisted to `localStorage`
   - Proper HMAC-signed request authentication between frontend and backend, mirroring the fix recommended in the code review

4. **AI prompts and reflection**

   ---

   **Prompt A — backend endpoint**

   *Prompt:*

   > "Build calculator/backend/app.py. POST /calculate accepts a JSON body with an `expression` key and evaluates it using `ast.parse()` with a whitelist NodeVisitor that blocks everything except BinOp, UnaryOp, Constant, and the arithmetic operators. Return JSON result on 200, JSON error on 400 for division by zero or unsafe input. Add CORS via flask-cors. Write requirements.txt with: flask, flask-cors, pytest."

   *AI output (safe evaluator core):*

   ```python
   class SafeEvaluator(ast.NodeVisitor):
       ALLOWED_NODES = {ast.Expression, ast.BinOp, ast.UnaryOp, ast.Constant, ast.Num}
       ALLOWED_OPS   = {ast.Add, ast.Sub, ast.Mult, ast.Div,
                        ast.Pow, ast.Mod, ast.UAdd, ast.USub}

       def generic_visit(self, node):
           if type(node) not in self.ALLOWED_NODES:
               if not isinstance(node, (ast.operator, ast.unaryop)):
                   raise ValueError(f"unsafe node: {type(node).__name__}")
           super().generic_visit(node)

   def safe_eval(expression: str) -> float:
       tree = ast.parse(expression, mode="eval")
       SafeEvaluator().visit(tree)
       # compile() + eval() on a pre-validated AST is safe;
       # the risk is passing untrusted strings to eval(), not compiled trees.
       return eval(compile(tree, "<string>", "eval"))
   ```

   *What it did well:* The `NodeVisitor` structure was correct, the operator allowlist was complete, and error handling for `ZeroDivisionError` and `ValueError` was clean. CORS setup was correct.

   *What it did poorly:* The first pass used `eval()` on the compiled AST without any comment explaining why that is safe after validation. It looked alarming on a quick read. I re-prompted asking for an inline comment explaining the distinction. The model added it on the second pass.

   ---

   **Prompt B — TDD test suite**

   *Prompt:*

   > "Write calculator/backend/tests/test_calc.py using pytest. Cover all 14 test cases from the spec: basic ops, operator precedence, floats, negatives, parentheses, division by zero, empty string, alphabetic input, and two malicious injection attempts (`__import__` and `open()`). Use the Flask test client. Use `pytest.mark.parametrize` for happy-path and error cases separately."

   *AI output (excerpt):*

   ```python
   @pytest.mark.parametrize("expr,expected", [
       ("2+2",       4),
       ("10/4",      2.5),
       ("3**2",      9),
       ("3+4*2",     11),
       ("-5+3",      -2),
       ("(2+3)*4",   20),
   ])
   def test_calculate_ok(client, expr, expected):
       r = client.post("/calculate", json={"expression": expr})
       assert r.status_code == 200
       assert r.get_json()["result"] == expected

   @pytest.mark.parametrize("expr", [
       "1/0", "", "abc",
       "__import__('os')",
       "open('/etc/passwd')",
       "1+\n2",
   ])
   def test_calculate_error(client, expr):
       r = client.post("/calculate", json={"expression": expr})
       assert r.status_code == 400
       assert "error" in r.get_json()
   ```

   *What it did well:* Used `parametrize` correctly for both cases, included a proper Flask test client fixture, and covered all 14 spec cases including both malicious inputs.

   *What it did poorly:* The multiline expression test used `"1 + 2"` (a space-separated expression that was actually valid) rather than `"1+\n2"` (a newline-separated expression that should be rejected). I re-prompted to clarify the intent and the model corrected it.

   ---

   **Prompt C — frontend build**

   *Prompt:*

   > "Read /mnt/skills/public/frontend-design/SKILL.md. Then build calculator/frontend/index.html, style.css, and main.js. Choose a bold aesthetic direction and state it in a comment at line 1 of index.html. Requirements: all 16 buttons, expression and result displays, POST to localhost:5000/calculate on equals, JS safe-eval fallback when backend is unreachable, full keyboard support per the spec keyboard map, aria-labels on all buttons, responsive at 320px minimum. Use CSS custom properties for the full color system. Include at least one micro-interaction. Background must have depth, not a flat solid color."

   *AI output (aesthetic declaration and design tokens):*

   ```html
   <!-- AESTHETIC: Industrial brutalist — raw noise-grain texture, phosphor amber
        on near-black, sharp geometric grid, mechanical button press depth. -->
   <!DOCTYPE html>
   <html lang="en">
   <head>
     <link href="https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Bebas+Neue&display=swap" rel="stylesheet">
     <style>
       :root {
         --bg-base:      #0d0d0d;
         --bg-surface:   #161616;
         --accent:       #f59e0b;
         --accent-dim:   #92400e;
         --text-primary: #fef3c7;
         --text-dim:     #6b5c3e;
         --radius:       2px;
         --press-depth:  translateY(2px);
       }
     </style>
   ```

   *AI output (button press micro-interaction):*

   ```css
   .btn { transition: transform 60ms ease-out, box-shadow 60ms ease-out; }
   .btn:active {
     transform: var(--press-depth);
     box-shadow: 0 0 0 1px var(--accent-dim);
     background: var(--accent-dim);
   }

   @keyframes result-pop {
     0%   { opacity: 0; transform: scale(0.94); }
     60%  { transform: scale(1.03); }
     100% { opacity: 1; transform: scale(1); }
   }
   .result-display.updated { animation: result-pop 180ms ease-out forwards; }
   ```

   *What it did well:* The aesthetic was original and executed consistently — the industrial brutalist direction carried through typography (Share Tech Mono + Bebas Neue), the noise texture, the amber phosphor color scheme, and the sharp button geometry. Micro-interactions felt physically grounded. Keyboard support and aria-labels were complete on the first pass.

   *What it did poorly:* The first pass set `background-color` on the body as a flat color and didn't apply the noise texture. I re-prompted asking for the texture to be layered as a `::before` pseudo-element on top of a radial-gradient base. The corrected version had proper depth.

   ---

   **Prompt D — LSP binary re-check**

   *Prompt:*

   > "Give me a plaintext prompt to re-check the code and run tests with the language LSP plugins having their binaries actually on my computer."

   *(Full AI output appears in Code Review Follow-up Prompt 6 above.)*

   *What it did well:* Produced a short, directly paste-able prompt that split the three language contexts cleanly, included exact install commands for each missing binary, and ended with a fixed-format status report.

   *What it did poorly:* Nothing — this was a short, well-scoped request and the output was usable without modification.

------------------------------------------------------------------------

# Delivery

Please reply to the email you received with:

1.  Answers to any follow-up above.
2.  Any questions or thoughts you had on the exercise.
3.  A link to a public GitHub repository including your answer to the
    coding challenge.
    -   If we can't get to the repository, we won't be able to consider your answer to the coding challenge.