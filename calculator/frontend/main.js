/* ============================================================
   NEON NOIR Calculator — main.js
   vtsls absent → manual JS type/reference review applied.
   No eval() anywhere. JS fallback uses Function constructor
   guarded by strict whitelist regex per CALC_SPEC.md.
   ============================================================ */

'use strict';

// macOS AirPlay Receiver (ControlCenter) occupies port 5000 on all interfaces.
// Using port 5001 as the backend port for this machine.
// On a fresh machine (AirPlay disabled), change this to http://localhost:5000/calculate
// and run: flask run --port 5000
const BACKEND_URL = 'http://127.0.0.1:5001/calculate';

// ── DOM refs ──────────────────────────────────────────────────
const $expr   = /** @type {HTMLElement} */ (document.getElementById('expression'));
const $result = /** @type {HTMLElement} */ (document.getElementById('result'));
const $status = /** @type {HTMLElement} */ (document.getElementById('status'));
const $bkStat = /** @type {HTMLElement} */ (document.getElementById('backend-status'));
const bgCanvas = /** @type {HTMLCanvasElement} */ (document.getElementById('bg-canvas'));

// ── State ─────────────────────────────────────────────────────
let expression  = '';   // current expression string
let justEvaled  = false; // true after = pressed; next digit starts fresh
let backendLive = false;

// ============================================================
// Background canvas — animated noise grain + floating particles
// ============================================================
(function initBackground() {
  const ctx = bgCanvas.getContext('2d');
  if (!ctx) return;

  const PARTICLE_COUNT = 50;
  /** @type {{x:number,y:number,r:number,dx:number,dy:number,life:number}[]} */
  const particles = [];

  function resize() {
    bgCanvas.width  = window.innerWidth;
    bgCanvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    particles.push({
      x:    Math.random() * window.innerWidth,
      y:    Math.random() * window.innerHeight,
      r:    Math.random() * 1.4 + 0.3,
      dx:   (Math.random() - 0.5) * 0.22,
      dy:   -(Math.random() * 0.35 + 0.08),
      life: Math.random(),
    });
  }

  function drawRadialGrad() {
    const cx = bgCanvas.width * 0.5;
    const cy = bgCanvas.height * 0.65;
    const r  = Math.max(bgCanvas.width, bgCanvas.height) * 0.9;
    const g  = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0,   '#0d1624');
    g.addColorStop(0.5, '#08101a');
    g.addColorStop(1,   '#060810');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, bgCanvas.width, bgCanvas.height);
  }

  function tick() {
    ctx.clearRect(0, 0, bgCanvas.width, bgCanvas.height);
    drawRadialGrad();

    // Film grain
    const imgd = ctx.createImageData(bgCanvas.width, bgCanvas.height);
    for (let i = 0; i < imgd.data.length; i += 4) {
      const v = Math.random() * 14 | 0;
      imgd.data[i]     = v;
      imgd.data[i + 1] = v;
      imgd.data[i + 2] = v;
      imgd.data[i + 3] = 16;
    }
    ctx.putImageData(imgd, 0, 0);

    // Particles
    for (const p of particles) {
      p.x    += p.dx;
      p.y    += p.dy;
      p.life += 0.0028;
      if (p.life > 1) {
        p.life = 0;
        p.x = Math.random() * bgCanvas.width;
        p.y = bgCanvas.height + 10;
      }
      const alpha = Math.sin(p.life * Math.PI) * 0.45;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(0, 255, 136, ${alpha.toFixed(3)})`;
      ctx.fill();
    }

    requestAnimationFrame(tick);
  }
  tick();
})();

// ============================================================
// JS safe-eval fallback (backend down)
// Spec: replace display operators, validate with whitelist regex,
// then use Function constructor. Returns null on any failure.
// ============================================================

/** @param {string} expr @returns {number|null} */
function jsFallbackEval(expr) {
  // Normalise display characters → ASCII operators
  const normalised = expr
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/−/g, '-');

  // Strict whitelist — only digits, operators, dot, parens, space
  // ** is two * which the regex already allows
  if (!/^[\d\s+\-*/.%()\^]+$/.test(normalised)) return null;

  // Guard: reject if longer than 256 chars
  if (normalised.length > 256) return null;

  try {
    // Function constructor (not eval) with whitelist guard applied above
    // eslint-disable-next-line no-new-func
    const fn = new Function(`"use strict"; return (${normalised});`);
    const result = fn();
    if (typeof result !== 'number' || !isFinite(result)) return null;
    return result;
  } catch {
    return null;
  }
}

// ============================================================
// Display helpers
// ============================================================

/** @param {string} val @param {boolean} isError */
function setResult(val, isError) {
  // Remove classes first, force reflow to restart CSS animation
  $result.className = 'display-result';
  void $result.offsetWidth;

  $result.textContent = val;

  if (isError) {
    $result.classList.add('error', 'glitch');
    $status.textContent = 'ERROR';
    $status.classList.add('error');
  } else {
    $result.classList.add('pop');
    $status.textContent = 'READY';
    $status.classList.remove('error');
  }
}

function updateExprDisplay() {
  $expr.textContent = expression || '0';
}

/** @param {number} n @returns {string} */
function formatNumber(n) {
  // Limit to 12 significant digits to avoid float noise
  return parseFloat(n.toPrecision(12)).toString();
}

// ============================================================
// Backend health check
// ============================================================

async function pingBackend() {
  try {
    const r = await fetch(BACKEND_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expression: '1+1' }),
      signal: AbortSignal.timeout(2500),
    });
    backendLive = r.ok;
  } catch {
    backendLive = false;
  }
  $bkStat.textContent = backendLive ? 'ONLINE'  : 'OFFLINE';
  $bkStat.className   = backendLive ? 'online'  : 'offline';
}

pingBackend();
setInterval(pingBackend, 15_000);

// ============================================================
// Calculate — try backend, fall back to jsFallbackEval
// ============================================================

async function calculate() {
  const expr = expression.trim();
  if (!expr) return;

  // Normalise display operators for backend
  const normalised = expr
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/−/g, '-');

  if (backendLive) {
    try {
      const r = await fetch(BACKEND_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ expression: normalised }),
      });
      const data = await r.json();
      if (!r.ok) {
        setResult(data.error || 'Error', true);
        justEvaled = true;
        return;
      }
      setResult(formatNumber(data.result), false);
    } catch {
      // Network error — fall through to JS fallback
      const fallback = jsFallbackEval(expr);
      if (fallback === null) {
        setResult('Error (offline)', true);
      } else {
        setResult(formatNumber(fallback), false);
      }
    }
  } else {
    const fallback = jsFallbackEval(expr);
    if (fallback === null) {
      setResult('Invalid expression', true);
    } else {
      setResult(formatNumber(fallback), false);
    }
  }

  justEvaled = true;
}

// ============================================================
// Input logic
// ============================================================

/** @param {string} action @param {string} value */
function handleAction(action, value) {
  switch (action) {

    case 'digit': {
      if (justEvaled) {
        // After =, next digit starts fresh expression
        expression = '';
        justEvaled = false;
        $result.textContent = '';
        $result.className = 'display-result';
      }
      // Prevent multiple decimals in the same number segment
      if (value === '.') {
        const lastSegment = expression.split(/[+\-*/%()]/).pop() ?? '';
        if (lastSegment.includes('.')) return;
      }
      expression += value;
      updateExprDisplay();
      break;
    }

    case 'operator': {
      if (justEvaled) {
        // Chain: start next expression from current result
        const prevResult = $result.textContent;
        if (prevResult && prevResult !== '' && !$result.classList.contains('error')) {
          expression = prevResult;
        }
        justEvaled = false;
      }
      // Replace trailing operator instead of stacking
      if (expression && /[+\-*/%]$/.test(expression)) {
        // Handle ** — don't strip both stars when replacing
        if (expression.endsWith('**') && value !== '**') {
          expression = expression.slice(0, -2);
        } else if (!expression.endsWith('**')) {
          expression = expression.slice(0, -1);
        }
      }
      expression += value;
      updateExprDisplay();
      break;
    }

    case 'clear': {
      expression = '';
      justEvaled = false;
      updateExprDisplay();
      $result.textContent = '';
      $result.className = 'display-result';
      $status.textContent = 'READY';
      $status.classList.remove('error');
      break;
    }

    case 'backspace': {
      if (justEvaled) {
        // Backspace after = starts fresh
        expression = '';
        justEvaled = false;
        $result.textContent = '';
        $result.className = 'display-result';
      } else {
        // Remove last char — handle ** (2-char operator) as one unit
        if (expression.endsWith('**')) {
          expression = expression.slice(0, -2);
        } else {
          expression = expression.slice(0, -1);
        }
      }
      updateExprDisplay();
      break;
    }

    case 'equals': {
      calculate();
      break;
    }
  }
}

// ============================================================
// Button press visual feedback
// ============================================================

/** @param {Element} el */
function flashBtn(el) {
  el.classList.add('pressed');
  setTimeout(() => el.classList.remove('pressed'), 130);
}

// ============================================================
// Button click events
// ============================================================

document.querySelectorAll('.btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    flashBtn(btn);
    const action = btn.dataset.action ?? '';
    const value  = btn.dataset.value  ?? '';
    handleAction(action, value);
  });
});

// ============================================================
// Keyboard support — all keys per CALC_SPEC.md
// ============================================================

/** @type {Record<string,[string,string]>} */
const KEY_MAP = {
  'Enter':     ['equals',    ''],
  '=':         ['equals',    ''],
  'Escape':    ['clear',     ''],
  'Backspace': ['backspace', ''],
  'Delete':    ['clear',     ''],
  'c':         ['clear',     ''],
  'C':         ['clear',     ''],
  '+':         ['operator',  '+'],
  '-':         ['operator',  '-'],
  '*':         ['operator',  '*'],
  '/':         ['operator',  '/'],
  '%':         ['operator',  '%'],
  '^':         ['operator',  '**'],   // ^ → power
  '.':         ['digit',     '.'],
  ',':         ['digit',     '.'],
};

document.addEventListener('keydown', (e) => {
  // Ignore modified key combos
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  const key = e.key;

  if (/^[0-9]$/.test(key)) {
    e.preventDefault();
    const numBtn = document.querySelector(`.btn-num[data-value="${key}"]`);
    if (numBtn) flashBtn(numBtn);
    handleAction('digit', key);
    return;
  }

  if (Object.prototype.hasOwnProperty.call(KEY_MAP, key)) {
    e.preventDefault();
    const [action, value] = KEY_MAP[key];

    // Flash matching button
    let sel = '';
    if (action === 'equals')    sel = '.btn-eq';
    if (action === 'clear')     sel = '.btn-fn[data-action="clear"]';
    if (action === 'backspace') sel = '.btn-fn[data-action="backspace"]';
    if (action === 'operator')  sel = `.btn-op[data-value="${value}"]`;
    if (sel) {
      const matched = document.querySelector(sel);
      if (matched) flashBtn(matched);
    }

    handleAction(action, value);
  }
});
