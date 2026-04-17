# CALC_SPEC.md — Calculator Requirements

---

## Backend — `calculator/backend/app.py`

### Endpoint
```
POST /calculate
Content-Type: application/json
Body:     { "expression": "3 + 4 * 2" }
Response 200: { "result": 11 }
Response 400: { "error": "Division by zero" }
Response 400: { "error": "Invalid expression" }
```

### Rules
- **Never `eval()`** — use `ast.parse()` + whitelist `NodeVisitor`
- Allowed AST nodes: `Expression`, `BinOp`, `UnaryOp`, `Constant`, `Num`
- Allowed operators: `Add`, `Sub`, `Mult`, `Div`, `Pow`, `Mod`, `UAdd`, `USub`
- Any other node → `ValueError` → 400
- Division by zero → catch `ZeroDivisionError` → 400
- Malformed JSON or missing `expression` key → 400
- CORS via `flask-cors`

### `requirements.txt`
```
flask
flask-cors
pytest
```

### TDD test matrix
Write failing test first. If pyright is verified active, fix all diagnostics after
each function. If pyright is absent, review types manually before continuing.

| Expression | Expected |
|------------|----------|
| `"2+2"` | `4` |
| `"10/4"` | `2.5` |
| `"3**2"` | `9` |
| `"10%3"` | `1` |
| `"3+4*2"` | `11` |
| `"-5+3"` | `-2` |
| `"1.5*2"` | `3.0` |
| `"(2+3)*4"` | `20` |
| `"1/0"` | 400 error |
| `""` | 400 error |
| `"abc"` | 400 error |
| `"__import__('os')"` | 400 error |
| `"open('/etc/passwd')"` | 400 error |
| `"1+\n2"` | 400 error |

---

## Frontend — `calculator/frontend/`

### Before writing any frontend file

1. **Verify frontend-design availability:**
   ```bash
   claude plugin list | grep frontend-design
   ls /mnt/skills/public/frontend-design/SKILL.md 2>/dev/null
   ```
   - If local skill exists → read it fully
   - If plugin is active → it auto-applies
   - If neither → apply built-in design principles (see docs/PLUGINS.md fallback)

2. **Verify vtsls:**
   ```bash
   claude plugin list | grep vtsls && which vtsls && echo $ENABLE_LSP_TOOL
   ```
   - If active → vtsls will lint `main.js` automatically after each edit
   - If absent → review JS manually for type/reference issues

3. State chosen aesthetic in a comment at line 1 of `index.html`

### Buttons
```
7  8  9  ÷
4  5  6  ×
1  2  3  −
0  .  =  +
C  ⌫  xʸ  %
```

### Behavior
- Expression display (top) + result display (bottom)
- `=` / Enter → POST to `http://localhost:5000/calculate`
  - Success → show result
  - Backend unreachable → JS safe-eval fallback (no `eval()`)
  - 400 error → show error message in result display (distinct styling)
- `C` → clear both displays
- `⌫` → remove last character
- After `=`, pressing an operator chains from the result

### Keyboard map
| Key | Action |
|-----|--------|
| `0`–`9`, `.` | Append digit |
| `+` `-` `*` `/` `%` | Append operator |
| `^` | Append `**` |
| `Enter` or `=` | Calculate |
| `Backspace` | Delete last char |
| `Escape` | Clear |

### Design requirements
- ONE committed aesthetic — bold, distinctive, not generic
- Google Fonts web font (NOT Inter, Roboto, Arial, system fonts)
- CSS custom properties for full color/spacing/radius system
- At least one micro-interaction (button press, result pop, shimmer, etc.)
- Background with depth — not flat solid color
- Responsive at 320 px minimum
- `aria-label` on all buttons; visible focus rings; contrast ≥ 4.5:1 AA

### JS safe-eval fallback
Replace `×`→`*`, `÷`→`/`, `−`→`-`. Validate with:
`/^[\d\s\+\-\*\/\.\%\(\)\*\*]+$/` before passing to `Function` constructor.
Return `null` on any failure.

---

## E2E verification

### If Playwright is verified active:
```bash
claude plugin list | grep playwright && npx playwright --version
```
Run all five scenarios via Playwright. Save screenshot to `docs/screenshot.png`.

### If Playwright is absent — curl + manual steps:
```bash
# Start servers
cd calculator/backend && flask run --port 5000 &
python -m http.server 3000 --directory calculator/frontend &

# Scenario 1 + 2 (backend math correctness)
curl -s -X POST http://localhost:5000/calculate \
  -H "Content-Type: application/json" \
  -d '{"expression":"3+4*2"}' | python3 -c "import sys,json; r=json.load(sys.stdin); assert r['result']==11, r"
echo "Scenario 1+2: PASS"

# Scenario 3 (division by zero)
curl -s -X POST http://localhost:5000/calculate \
  -H "Content-Type: application/json" \
  -d '{"expression":"1/0"}' | python3 -c "import sys,json; r=json.load(sys.stdin); assert 'error' in r, r"
echo "Scenario 3: PASS"
```
Document scenarios 4 (chaining) and 5 (clear button) as requiring manual browser
verification and note what to visually confirm.

### Five E2E scenarios (either method)
1. Click `3` `+` `4` `*` `2` `=` → result shows `11`
2. Type `3+4*2`, press Enter → result shows `11`
3. Click `1` `/` `0` `=` → result shows error containing "zero"
4. Click `5` `+` `3` `=`, then `+` `2` `=` → result shows `10`
5. Click `C` → both displays clear

---

## Ralph Loop invocations (only if ralph-wiggum verified active AND stuck after 2 attempts)

```bash
# Verify first
claude plugin list | grep ralph
```

### Backend loop (only run if ralph is active)
```
/ralph-loop "
Implement calculator/backend/app.py and tests/test_calc.py per docs/CALC_SPEC.md.
TDD: write failing test before each implementation function.
After every file change: cd calculator/backend && pytest -v
If pyright is verified active: run pyright after each .py edit, fix all errors.
If pyright is absent: review types manually before moving on.
Use superpowers systematic-debugging skill if active; otherwise debug manually.
After 10 iterations without progress write blockers to docs/BLOCKED.md.
Output <promise>BACKEND_DONE</promise> only when pytest passes 0 failures.
" --max-iterations 20 --completion-promise "BACKEND_DONE"
```

### Frontend loop (only run if ralph is active)
```
/ralph-loop "
Build calculator/frontend/ per docs/CALC_SPEC.md.
Check frontend-design skill/plugin availability first; apply if present, else use
built-in design knowledge. State aesthetic at line 1 of index.html.
Check vtsls availability; use if active, else review main.js manually.
After build: check Playwright availability. If active, run 5 E2E scenarios and save
screenshot. If absent, run curl tests and document manual verification steps.
After 10 iterations without progress write blockers to docs/BLOCKED.md.
Output <promise>FRONTEND_DONE</promise> when all verifiable scenarios pass.
" --max-iterations 15 --completion-promise "FRONTEND_DONE"
```
