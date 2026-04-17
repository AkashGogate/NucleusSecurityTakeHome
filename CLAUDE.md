# CLAUDE.md

## Project
Nucleus Security Engineering Intern interview — two deliverables:
1. `code-review/review.md` — security review of a Python and PHP webhook handler
2. `calculator/` — full-stack web calculator (Flask + HTML/CSS/JS)

## Repo layout
```
/
├── code-review/review.md
├── calculator/
│   ├── backend/{app.py,requirements.txt,tests/test_calc.py}
│   └── frontend/{index.html,style.css,main.js}
├── docs/
│   ├── PLUGINS.md       ← verification commands + graceful fallback rules
│   ├── REVIEW_SPEC.md   ← code-review checklist (9 issues × 2 languages)
│   ├── CALC_SPEC.md     ← calculator requirements + E2E scenarios
│   └── DONE.md          ← definition-of-done checklist
└── README.md
```

## Non-negotiable rules
- Read `docs/PLUGINS.md` at session start
- **Verify before use**: run `claude plugin list` before invoking any plugin feature;
  if the plugin is absent or disabled, fall back to built-in Claude knowledge — never
  assume a plugin is active, never error out, never block progress
- Caveman mode ON if installed and active; if not, proceed normally
- TDD: write failing test before implementation (red → green → refactor)
- Frontend: check for `frontend-design` skill/plugin before any HTML/CSS/JS;
  if absent, apply design principles from built-in knowledge
- CLAUDE.md stays lean; all detail lives in `docs/`
