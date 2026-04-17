# DONE.md — Definition of Done

Work through every section in order. For plugin-dependent items: verify the plugin
is active first. If absent, the fallback condition applies instead.

---

## Plugin verification (session start)
- [ ] `claude plugin list` run — active plugins noted
- [ ] `ENABLE_LSP_TOOL` status checked
- [ ] All absent plugins have their fallback noted

---

## Code review
- [ ] `code-review/review.md` exists
- [ ] All 9 Python issues identified with line numbers and fix snippets
  - [ ] pyright diagnostics used (if active) OR manual review applied (if absent)
- [ ] All 9 PHP issues identified with line numbers and fix snippets
  - [ ] php-lsp diagnostics used (if active) OR manual PHP review applied (if absent)
- [ ] Shared issues cross-referenced between both versions
- [ ] Bonus issues noted (replay protection, role allowlist, PII retention)

---

## Backend
- [ ] `calculator/backend/app.py` exists
- [ ] `eval()` is NOT used anywhere — verified by grep
- [ ] `pytest -v` passes 0 failures, all 14 test cases covered
- [ ] Type quality verified:
  - [ ] pyright 0 errors (if pyright active) OR manual type review passed (if absent)
- [ ] CORS headers present

---

## Frontend
- [ ] `index.html`, `style.css`, `main.js` all exist
- [ ] Aesthetic direction declared in comment at line 1 of `index.html`
- [ ] Google Fonts web font loaded (NOT Inter / Roboto / Arial)
- [ ] CSS custom properties cover full color/spacing system
- [ ] Micro-interaction present
- [ ] Background has depth (not flat solid)
- [ ] Responsive at 320 px
- [ ] aria-label on all buttons; focus rings visible
- [ ] JS quality verified:
  - [ ] vtsls 0 errors on main.js (if vtsls active) OR manual JS review passed (if absent)
- [ ] Keyboard input works (all keys in spec)
- [ ] Backend integration works end-to-end
- [ ] JS fallback works when backend is down

---

## E2E
- [ ] Scenario 1: correct result (Playwright if active, curl if absent)
- [ ] Scenario 2: keyboard input correct (Playwright if active, manual note if absent)
- [ ] Scenario 3: divide by zero shows error (Playwright or curl)
- [ ] Scenario 4: chaining correct (Playwright if active, manual note if absent)
- [ ] Scenario 5: clear works (Playwright if active, manual note if absent)
- [ ] Screenshot saved to docs/screenshot.png (if Playwright active) OR
      manual verification documented in docs/MANUAL_VERIFY.md (if absent)

---

## Repo
- [ ] README.md with run instructions
- [ ] Repo is public on GitHub with working link
- [ ] Clean clone passes: pip install -r requirements.txt && pytest
