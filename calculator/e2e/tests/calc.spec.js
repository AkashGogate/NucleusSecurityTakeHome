// @ts-check
const { test, expect } = require('@playwright/test');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Click sequence of buttons by data-value or data-action.
 * @param {import('@playwright/test').Page} page
 * @param {string[]} labels
 */
async function clickButtons(page, ...labels) {
  for (const label of labels) {
    const btn = page.locator(
      `[data-value="${label}"], [data-action="${label}"]`
    ).first();
    await btn.click();
  }
}

/**
 * Read the result display text.
 * @param {import('@playwright/test').Page} page
 */
async function getResult(page) {
  return page.locator('#result').textContent();
}

/**
 * Read the expression display text.
 * @param {import('@playwright/test').Page} page
 */
async function getExpr(page) {
  return page.locator('#expression').textContent();
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  // Wait for backend ping to settle — backendLive is a let (not on window),
  // so poll the status element instead: it starts as '···' then flips to ONLINE/OFFLINE.
  await page.waitForFunction(
    () => {
      const el = document.getElementById('backend-status');
      return el && el.textContent !== '···';
    },
    null,
    { timeout: 5000 }
  ).catch(() => {});
  // Ensure clean state
  await page.locator('[data-action="clear"]').click();
});

// ---------------------------------------------------------------------------
// Page load
// ---------------------------------------------------------------------------

test.describe('Page load', () => {
  test('title contains NEON CALC or Nucleus', async ({ page }) => {
    const title = await page.title();
    expect(title.toLowerCase()).toMatch(/neon|nucleus|calc/i);
  });

  test('expression display shows 0 initially', async ({ page }) => {
    await expect(page.locator('#expression')).toHaveText('0');
  });

  test('result display is empty initially', async ({ page }) => {
    const text = await getResult(page);
    expect(text?.trim()).toBe('');
  });

  test('all 20 buttons present (5 rows × 4)', async ({ page }) => {
    const buttons = page.locator('.btn');
    await expect(buttons).toHaveCount(20);
  });

  test('backend-status element exists', async ({ page }) => {
    await expect(page.locator('#backend-status')).toBeVisible();
  });

  test('status element shows READY', async ({ page }) => {
    await expect(page.locator('#status')).toHaveText('READY');
  });
});

// ---------------------------------------------------------------------------
// Basic arithmetic
// ---------------------------------------------------------------------------

test.describe('Arithmetic', () => {
  test('2 + 2 = 4', async ({ page }) => {
    await clickButtons(page, '2', '+', '2');
    await page.locator('[data-action="equals"]').click();
    await expect(page.locator('#result')).toHaveText('4');
  });

  test('3 + 4 * 2 = 11 (precedence)', async ({ page }) => {
    await clickButtons(page, '3', '+', '4', '*', '2');
    await page.locator('[data-action="equals"]').click();
    await expect(page.locator('#result')).toHaveText('11');
  });

  test('10 / 4 = 2.5', async ({ page }) => {
    await clickButtons(page, '1', '0', '/', '4');
    await page.locator('[data-action="equals"]').click();
    await expect(page.locator('#result')).toHaveText('2.5');
  });

  test('10 - 3 = 7', async ({ page }) => {
    await clickButtons(page, '1', '0', '-', '3');
    await page.locator('[data-action="equals"]').click();
    await expect(page.locator('#result')).toHaveText('7');
  });

  test('6 * 7 = 42', async ({ page }) => {
    await clickButtons(page, '6', '*', '7');
    await page.locator('[data-action="equals"]').click();
    await expect(page.locator('#result')).toHaveText('42');
  });

  test('10 % 3 = 1', async ({ page }) => {
    await clickButtons(page, '1', '0', '%', '3');
    await page.locator('[data-action="equals"]').click();
    await expect(page.locator('#result')).toHaveText('1');
  });

  test('3 ** 2 = 9 via xʸ button', async ({ page }) => {
    await clickButtons(page, '3');
    await page.locator('[data-value="**"]').click();
    await clickButtons(page, '2');
    await page.locator('[data-action="equals"]').click();
    await expect(page.locator('#result')).toHaveText('9');
  });

  test('negative result: 3 - 7 = -4', async ({ page }) => {
    await clickButtons(page, '3', '-', '7');
    await page.locator('[data-action="equals"]').click();
    await expect(page.locator('#result')).toHaveText('-4');
  });

  test('float result: 1.5 * 2 = 3', async ({ page }) => {
    await page.locator('[data-value="1"]').click();
    await page.locator('[data-value="."]').click();
    await page.locator('[data-value="5"]').click();
    await page.locator('[data-value="*"]').click();
    await page.locator('[data-value="2"]').click();
    await page.locator('[data-action="equals"]').click();
    await expect(page.locator('#result')).toHaveText('3');
  });
});

// ---------------------------------------------------------------------------
// Clear and backspace
// ---------------------------------------------------------------------------

test.describe('Clear / Backspace', () => {
  test('C clears expression and result', async ({ page }) => {
    await clickButtons(page, '5', '+', '3');
    await page.locator('[data-action="clear"]').click();
    await expect(page.locator('#expression')).toHaveText('0');
    const result = await getResult(page);
    expect(result?.trim()).toBe('');
  });

  test('⌫ removes last character', async ({ page }) => {
    await clickButtons(page, '1', '2', '3');
    await expect(page.locator('#expression')).toHaveText('123');
    await page.locator('[data-action="backspace"]').click();
    await expect(page.locator('#expression')).toHaveText('12');
  });

  test('⌫ on empty expression stays empty', async ({ page }) => {
    await page.locator('[data-action="backspace"]').click();
    await expect(page.locator('#expression')).toHaveText('0');
  });

  test('⌫ treats ** as single unit', async ({ page }) => {
    await clickButtons(page, '2');
    await page.locator('[data-value="**"]').click();
    // expression is "2**"
    await page.locator('[data-action="backspace"]').click();
    // should remove both * → "2"
    await expect(page.locator('#expression')).toHaveText('2');
  });

  test('C after = resets state', async ({ page }) => {
    await clickButtons(page, '4', '+', '4');
    await page.locator('[data-action="equals"]').click();
    await expect(page.locator('#result')).toHaveText('8');
    await page.locator('[data-action="clear"]').click();
    await expect(page.locator('#expression')).toHaveText('0');
    const result = await getResult(page);
    expect(result?.trim()).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Error display
// ---------------------------------------------------------------------------

test.describe('Error cases', () => {
  test('division by zero shows error in result', async ({ page }) => {
    await clickButtons(page, '1', '/');
    await page.locator('[data-value="0"]').click();
    await page.locator('[data-action="equals"]').click();
    await expect(page.locator('#result')).toContainText(/error|zero|Error/i);
    await expect(page.locator('#status')).toHaveText('ERROR');
  });

  test('result div has error class on division by zero', async ({ page }) => {
    await clickButtons(page, '5', '/');
    await page.locator('[data-value="0"]').click();
    await page.locator('[data-action="equals"]').click();
    await expect(page.locator('#result')).toHaveClass(/error/);
  });

  test('status returns to READY after clear following error', async ({ page }) => {
    await clickButtons(page, '1', '/');
    await page.locator('[data-value="0"]').click();
    await page.locator('[data-action="equals"]').click();
    await page.locator('[data-action="clear"]').click();
    await expect(page.locator('#status')).toHaveText('READY');
    await expect(page.locator('#result')).not.toHaveClass(/error/);
  });
});

// ---------------------------------------------------------------------------
// Decimal input
// ---------------------------------------------------------------------------

test.describe('Decimal guard', () => {
  test('entering second dot in same number is ignored', async ({ page }) => {
    await page.locator('[data-value="1"]').click();
    await page.locator('[data-value="."]').click();
    await page.locator('[data-value="5"]').click();
    await page.locator('[data-value="."]').click(); // second dot — should be ignored
    await page.locator('[data-value="5"]').click();
    await expect(page.locator('#expression')).toHaveText('1.55');
  });

  test('dot allowed in second number segment after operator', async ({ page }) => {
    await page.locator('[data-value="1"]').click();
    await page.locator('[data-value="."]').click();
    await page.locator('[data-value="5"]').click();
    await page.locator('[data-value="+"]').click();
    await page.locator('[data-value="2"]').click();
    await page.locator('[data-value="."]').click(); // new segment — allowed
    await page.locator('[data-value="5"]').click();
    await expect(page.locator('#expression')).toHaveText('1.5+2.5');
  });
});

// ---------------------------------------------------------------------------
// Operator chaining
// ---------------------------------------------------------------------------

test.describe('Operator chaining', () => {
  test('trailing operator replaced by new one', async ({ page }) => {
    await clickButtons(page, '5', '+');
    await page.locator('[data-value="-"]').click(); // replace + with -
    await expect(page.locator('#expression')).toHaveText('5-');
  });

  test('result chains into next expression after =', async ({ page }) => {
    await clickButtons(page, '4', '+', '4');
    await page.locator('[data-action="equals"]').click();
    await expect(page.locator('#result')).toHaveText('8');
    // pressing operator after = chains from result
    await page.locator('[data-value="+"]').click();
    await expect(page.locator('#expression')).toHaveText('8+');
  });

  test('digit after = starts fresh expression', async ({ page }) => {
    await clickButtons(page, '4', '+', '4');
    await page.locator('[data-action="equals"]').click();
    await page.locator('[data-value="9"]').click();
    await expect(page.locator('#expression')).toHaveText('9');
  });
});

// ---------------------------------------------------------------------------
// Keyboard input
// ---------------------------------------------------------------------------

test.describe('Keyboard', () => {
  test('digits via keyboard', async ({ page }) => {
    await page.keyboard.press('4');
    await page.keyboard.press('2');
    await expect(page.locator('#expression')).toHaveText('42');
  });

  test('Enter triggers equals', async ({ page }) => {
    await page.keyboard.press('3');
    await page.keyboard.press('+');
    await page.keyboard.press('3');
    await page.keyboard.press('Enter');
    await expect(page.locator('#result')).toHaveText('6');
  });

  test('= key triggers equals', async ({ page }) => {
    await page.keyboard.press('5');
    await page.keyboard.press('-');
    await page.keyboard.press('2');
    await page.keyboard.press('=');
    await expect(page.locator('#result')).toHaveText('3');
  });

  test('Escape clears', async ({ page }) => {
    await page.keyboard.press('7');
    await page.keyboard.press('Escape');
    await expect(page.locator('#expression')).toHaveText('0');
  });

  test('c key clears', async ({ page }) => {
    await page.keyboard.press('7');
    await page.keyboard.press('c');
    await expect(page.locator('#expression')).toHaveText('0');
  });

  test('Backspace removes last char', async ({ page }) => {
    await page.keyboard.press('1');
    await page.keyboard.press('2');
    await page.keyboard.press('Backspace');
    await expect(page.locator('#expression')).toHaveText('1');
  });

  test('Delete clears', async ({ page }) => {
    await page.keyboard.press('9');
    await page.keyboard.press('Delete');
    await expect(page.locator('#expression')).toHaveText('0');
  });

  test('^ key maps to ** (power)', async ({ page }) => {
    await page.keyboard.press('2');
    await page.keyboard.press('^');
    await page.keyboard.press('3');
    await page.keyboard.press('Enter');
    await expect(page.locator('#result')).toHaveText('8');
  });

  test(', (comma) key maps to decimal point', async ({ page }) => {
    await page.keyboard.press('1');
    await page.keyboard.press(',');
    await page.keyboard.press('5');
    await expect(page.locator('#expression')).toHaveText('1.5');
  });

  test('% key adds modulo operator', async ({ page }) => {
    await page.keyboard.press('1');
    await page.keyboard.press('0');
    await page.keyboard.press('%');
    await page.keyboard.press('3');
    await page.keyboard.press('Enter');
    await expect(page.locator('#result')).toHaveText('1');
  });
});

// ---------------------------------------------------------------------------
// Accessibility
// ---------------------------------------------------------------------------

test.describe('Accessibility', () => {
  test('all operator buttons have aria-label', async ({ page }) => {
    const ops = page.locator('.btn-op');
    const count = await ops.count();
    for (let i = 0; i < count; i++) {
      const label = await ops.nth(i).getAttribute('aria-label');
      expect(label).toBeTruthy();
    }
  });

  test('equals button has aria-label', async ({ page }) => {
    const label = await page.locator('.btn-eq').getAttribute('aria-label');
    expect(label).toBeTruthy();
  });

  test('expression display is visible', async ({ page }) => {
    await expect(page.locator('#expression')).toBeVisible();
  });

  test('result display is visible', async ({ page }) => {
    await expect(page.locator('#result')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Backend status indicator
// ---------------------------------------------------------------------------

test.describe('Backend status', () => {
  test('backend-status element shows ONLINE or OFFLINE', async ({ page }) => {
    // Wait for initial ping to settle (up to 4s)
    await page.waitForFunction(
      () => {
        const el = document.getElementById('backend-status');
        return el && (el.textContent === 'ONLINE' || el.textContent === 'OFFLINE');
      },
      null,
      { timeout: 4000 }
    );
    const text = await page.locator('#backend-status').textContent();
    expect(['ONLINE', 'OFFLINE']).toContain(text);
  });
});

// ---------------------------------------------------------------------------
// Complex expressions
// ---------------------------------------------------------------------------

test.describe('Complex expressions', () => {
  test('2 + 3 * 4 = 14 (precedence via keyboard)', async ({ page }) => {
    // Parens not in button layout or KEY_MAP — test precedence without them
    await page.keyboard.type('2');
    await page.keyboard.press('+');
    await page.keyboard.type('3');
    await page.keyboard.press('*');
    await page.keyboard.type('4');
    await page.keyboard.press('Enter');
    await expect(page.locator('#result')).toHaveText('14');
  });

  test('chained calculation: 6/2 then +3 = 6', async ({ page }) => {
    await page.keyboard.type('6');
    await page.keyboard.press('/');
    await page.keyboard.press('2');
    await page.keyboard.press('Enter');
    await expect(page.locator('#result')).toHaveText('3');
    await page.keyboard.press('+');
    await page.keyboard.press('3');
    await page.keyboard.press('Enter');
    await expect(page.locator('#result')).toHaveText('6');
  });
});
