# PLUGINS.md — Plugin Verification, Install Commands & Fallback Rules

## Core principle

**Verify before use. Never assume. Never block.**

Before invoking any plugin feature, Claude must check whether that plugin is actually
installed and enabled. If it is — use it. If it is not — fall back to built-in Claude
knowledge and proceed without interruption.

```bash
# Check what is currently installed and enabled
claude plugin list

# JSON output for scripting / precise status checking
claude plugin list --json
```

The output lists every plugin with its enabled/disabled state. Use this before any
phase that depends on a plugin.

---

## Verification + Fallback Matrix

For each plugin below: check status first, then follow the appropriate path.

---

### Caveman — token compression

**Verify:**
```bash
claude plugin list | grep caveman
# If present and enabled → Caveman mode is active (auto via SessionStart hook)
# If absent or disabled  → proceed with normal prose output
```

**Install (optional — only if you want token compression):**
```bash
claude plugin marketplace add JuliusBrussee/caveman
claude plugin install caveman@caveman
# Restart Claude Code
```

**Fallback:** If not installed, Claude writes in normal prose. No functionality is
lost — only token efficiency is reduced. Do not block any task on this.

---

### claude-code-setup — automated plugin audit

**Verify:**
```bash
claude plugin list | grep claude-code-setup
```

**Install:**
```bash
claude plugin install claude-code-setup@claude-plugins-official
```

**Use:** `/setup` — scans codebase and recommends tailored automations.

**Fallback:** If not installed, manually follow the Language → Plugin Matrix below
and apply built-in knowledge to fill any gaps.

---

### pyright — Python type checking (LSP)

**Verify:**
```bash
claude plugin list | grep pyright
which pyright          # confirm system binary is in PATH
echo $ENABLE_LSP_TOOL  # must be "1" for LSP tools to activate
```

**Install:**
```bash
claude plugin install pyright@claude-code-lsps
pip install pyright
export ENABLE_LSP_TOOL=1   # add to shell profile for persistence
```

**Use:** Activates automatically on every `.py` file edit when all three conditions
above are true (plugin enabled + binary present + ENABLE_LSP_TOOL=1).

**Fallback:** If pyright is absent or ENABLE_LSP_TOOL is unset, Claude uses its
built-in Python knowledge to review types manually. Apply extra scrutiny to function
signatures, return types, and variable annotations by eye. Still enforce zero obvious
type errors before moving on — just without automated diagnostics.

---

### vtsls — JavaScript/TypeScript type checking (LSP)

**Verify:**
```bash
claude plugin list | grep vtsls
which vtsls            # confirm binary in PATH
echo $ENABLE_LSP_TOOL  # must be "1"
```

**Install:**
```bash
claude plugin install vtsls@claude-code-lsps
npm install -g @vtsls/language-server typescript
export ENABLE_LSP_TOOL=1
```

**Use:** Activates automatically on `.js`, `.ts`, `.jsx`, `.tsx` file edits.

**Fallback:** If absent, Claude manually reviews JS for type coercion bugs, undefined
references, and module issues using built-in knowledge. Apply extra care to any
dynamic property access or implicit any patterns in `main.js`.

---

### php-lsp — PHP intelligence (LSP, via Intelephense)

**Verify:**
```bash
claude plugin list | grep php-lsp
which intelephense     # confirm binary in PATH
echo $ENABLE_LSP_TOOL  # must be "1"
```

**Install:**
```bash
claude plugin install php-lsp@claude-plugins-official
npm install -g intelephense
export ENABLE_LSP_TOOL=1
```

**Use:** Activates automatically on `.php` file edits — go-to-definition, type info,
and real-time diagnostics for the PHP webhook review.

**Fallback:** If absent, Claude reviews the PHP webhook manually using built-in PHP
knowledge. Pay extra attention to: string concatenation in SQL calls (`$pdo->exec`),
non-strict equality (`==`), `json_decode` null returns, and `$pdo` scope issues.
The code review is fully achievable without LSP — diagnostics just make it faster.

---

### frontend-design — UI design skill

**Verify:**
```bash
# Check for plugin version
claude plugin list | grep frontend-design

# Or check for local skill file
ls /mnt/skills/public/frontend-design/SKILL.md 2>/dev/null && echo "LOCAL SKILL FOUND"
```

**Install (if neither is present):**
```bash
claude plugin marketplace add anthropics/claude-code
claude plugin install frontend-design@claude-code-plugins
```

**Use:** If local skill file exists → read it. If plugin installed → it auto-applies
on frontend tasks. Either form is equivalent.

**Fallback:** If neither is available, apply these principles from built-in knowledge:
- Commit to ONE bold aesthetic direction before writing any code
- Use a distinctive Google Fonts web font (not Inter, Roboto, Arial, or system fonts)
- Build a full CSS custom-property color system (`--color-*`, `--space-*`, etc.)
- Include at least one meaningful micro-interaction
- Design for 320 px minimum width
- All buttons need `aria-label`; ensure visible focus rings; contrast ≥ 4.5:1

---

### Playwright — browser E2E testing

**Verify:**
```bash
claude plugin list | grep playwright
npx playwright --version 2>/dev/null && echo "PLAYWRIGHT AVAILABLE"
```

**Install:**
```bash
claude plugin install playwright@claude-plugins-official
npx playwright install chromium
```

**Use:** On-demand — invoked when browser verification of the frontend is needed.

**Fallback:** If absent, describe manual verification steps for each E2E scenario
in plain bash:
```bash
# Start servers
cd calculator/backend && flask run --port 5000 &
python -m http.server 3000 --directory calculator/frontend &
# Then test with curl for backend scenarios
curl -X POST http://localhost:5000/calculate \
     -H "Content-Type: application/json" \
     -d '{"expression":"3+4*2"}' \
     | grep '"result":11'
```
For visual/keyboard E2E, document which scenarios need manual browser verification
and what to look for.

---

### Superpowers — structured TDD, debugging, planning

**Verify:**
```bash
claude plugin list | grep superpowers
```

**Install:**
```bash
claude plugin marketplace add obra/superpowers-marketplace
claude plugin install superpowers@superpowers-marketplace
# Restart Claude Code
```

**Use:** `/superpowers:brainstorm`, `/superpowers:write-plan`, `/superpowers:execute-plan`.
TDD and debugging skills auto-trigger based on context when installed.

**Fallback:** If absent, apply the same discipline manually:
- Brainstorm: review both specs in `docs/` before writing code, note any ambiguities
- Plan: write a numbered task list in `docs/PLAN.md` before touching files
- TDD: strictly write the test file entry first, run it to confirm failure, then implement
- Debugging: for any failure, identify the exact error, form a hypothesis, test it,
  then fix — never make random changes

---

### Ralph Loop — autonomous iterative completion

**Verify:**
```bash
claude plugin list | grep ralph
```

**Install:**
```bash
claude plugin install ralph-wiggum@claude-plugins-official
```

**Use:** On-demand via `/ralph-loop "..." --max-iterations N --completion-promise "X"`.
Only invoke when stuck after 2 manual attempts.

**Fallback:** If absent, apply the Ralph philosophy manually — re-read the failing
output, identify the specific gap, adjust the approach, and retry. Document each
attempt in `docs/ATTEMPTS.md` so progress is preserved between manual iterations.

---

## Language → Plugin Matrix (for plugin discovery)

| File type / task | Plugin to check | Fallback if absent |
|---|---|---|
| `.py` files | `pyright@claude-code-lsps` | Manual type review |
| `.js`/`.ts` files | `vtsls@claude-code-lsps` | Manual JS review |
| `.php` files | `php-lsp@claude-plugins-official` | Manual PHP review |
| Frontend UI | `frontend-design` skill or plugin | Built-in design principles |
| Browser E2E | `playwright@claude-plugins-official` | curl + manual browser steps |
| TDD/debug/plan | `superpowers@superpowers-marketplace` | Manual TDD discipline |
| Iterative loops | `ralph-wiggum@claude-plugins-official` | Manual retry with logging |
| Token compression | `caveman@caveman` | Normal prose output |
| Project audit | `claude-code-setup@claude-plugins-official` | Follow matrix manually |

---

## Session-start verification checklist

Run this block at the start of every session before touching any project file:

```bash
# 1. See what is installed and enabled
claude plugin list

# 2. Check LSP prerequisite
echo "ENABLE_LSP_TOOL=${ENABLE_LSP_TOOL}"

# 3. Check individual binaries only for plugins shown as enabled above
# (skip checks for plugins that aren't installed)
which pyright 2>/dev/null    && echo "pyright OK"    || echo "pyright MISSING — LSP fallback"
which vtsls 2>/dev/null      && echo "vtsls OK"      || echo "vtsls MISSING — LSP fallback"
which intelephense 2>/dev/null && echo "intelephense OK" || echo "intelephense MISSING — LSP fallback"
npx playwright --version 2>/dev/null && echo "playwright OK" || echo "playwright MISSING — curl fallback"
```

After running, note which plugins are active. For every absent plugin, the
corresponding fallback from the matrix above applies automatically. Do not
prompt the user to install missing plugins — just proceed with fallbacks.
