import { expect, test, type Page } from '@playwright/test';

// Fails the test on any console error or uncaught exception.
function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

// The "Start here" panel opens on a first visit; these tests start inside the pulse view.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.setItem('atlas-v3-welcome-seen', '1'); } catch { /* storage blocked: the panel may show, the test will say so */ }
  });
});

test('#view-pulse opens the World pulse; a severity bar filters, shows a chip and writes the link', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/#view-pulse');
  await expect(page.locator('#viewpanel .pulse .pl-read')).toBeVisible();
  await expect(page.locator('.pl-tile[data-k="wars"]')).toBeVisible();
  await expect(page.locator('#pl-matrix .pl-cell').first()).toBeVisible();
  await page.locator('#pl-sev [data-sev="war"]').click();
  await expect(page.locator('.pl-chip')).toHaveCount(1);
  await expect(page).toHaveURL(/[?&]sev=war\b/);
  await page.locator('.pl-chip-x').click();
  await expect(page.locator('.pl-chip')).toHaveCount(0);
  await expect(page).not.toHaveURL(/sev=/);
  expect(errors).toEqual([]);
});

test('a filtered share link restores chips and the region strip at phone width, with no sideways scroll', async ({ page }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?region=africa&sev=war#view-pulse');
  await expect(page.locator('.pl-chip')).toHaveCount(2);
  await expect(page.locator('.pl-strip')).toBeVisible();
  const widths = await page.evaluate(() => [document.documentElement.scrollWidth, document.querySelector('.vp-body')?.scrollWidth ?? 0]);
  for (const w of widths) expect(w).toBeLessThanOrEqual(390);
  expect(errors).toEqual([]);
});

test('"figures follow the map" turns on and states its scope', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/#view-pulse');
  await page.locator('.pl-follow').click();
  await expect(page.locator('.pl-follow')).toHaveAttribute('aria-pressed', 'true');
  await expect(page).toHaveURL(/inview=1/);
  await expect(page.locator('.pl-follow-note')).toBeVisible();
  expect(errors).toEqual([]);
});
