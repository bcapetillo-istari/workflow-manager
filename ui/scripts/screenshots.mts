/**
 * Visual check of the Workflow Manager UI against the mock gateway.
 *
 *   npx vite --port 5173          (in another terminal, or already running)
 *   node scripts/screenshots.mts  (Node >= 23.6 strips types natively)
 *
 * Writes 1440x900 full-page screenshots to /tmp/wm-shots (override with WM_SHOTS_DIR).
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright';

const BASE = process.env.WM_BASE_URL ?? 'http://localhost:5173/apps/workflows/';
const OUT = process.env.WM_SHOTS_DIR ?? '/tmp/wm-shots';
mkdirSync(OUT, { recursive: true });

const saved: string[] = [];
async function shot(page: Page, name: string) {
  const path = join(OUT, `${name}.png`);
  await page.waitForTimeout(250); // let transitions settle
  await page.screenshot({ path, fullPage: true });
  saved.push(path);
  console.log(`saved ${path}`);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
page.on('pageerror', (err) => console.error('page error:', err.message));
// Full-page captures repeat a sticky header at the scroll offset; pin it for screenshots only.
await page.addInitScript(() => {
  document.addEventListener('DOMContentLoaded', () => {
    const style = document.createElement('style');
    style.textContent = 'header.sticky { position: static !important; }';
    document.head.appendChild(style);
  });
});

try {
  // 01: sign-in (dev token box)
  await page.goto(`${BASE}?mock=1`);
  await page.getByLabel(/bearer token/i).waitFor();
  await shot(page, '01-signin');

  // 02: catalog
  await page.getByLabel(/bearer token/i).fill('mock');
  await page.getByRole('button', { name: 'Use token' }).click();
  await page.getByText('Smart Diff').first().waitFor();
  await shot(page, '02-catalog');

  // 03: start-run page for Smart Diff
  const smartDiff = page.getByTestId('workflow-card').filter({ hasText: 'Smart Diff' });
  await smartDiff.getByRole('button', { name: 'Start' }).click();
  await page.getByRole('heading', { name: 'Smart Diff' }).waitFor();
  await page.getByText('Stages (').waitFor();
  await shot(page, '03-start-run');

  // 04: run detail. Drive the first stage's form: first search result for each resource picker,
  // first credential, first real option of each select, some text for the prompt.
  await page.getByRole('button', { name: 'Start' }).click();
  await page.getByText(/^Step 1:/).waitFor({ timeout: 10_000 });
  await shot(page, '04a-run-detail-empty-form');

  const form = page.locator('form');
  try {
    // Resource pickers appear one at a time: once file1 is picked its list collapses into a summary.
    for (let i = 0; i < 2; i++) {
      const results = form.locator('ul li button');
      await results.first().waitFor({ timeout: 5000 });
      await results.nth(Math.min(i, (await results.count()) - 1)).click();
      await page.waitForTimeout(400);
    }
    const radios = form.getByRole('radio');
    if ((await radios.count()) > 0) await radios.first().check();
    for (const select of await form.locator('select:not([disabled])').all()) {
      const id = await select.getAttribute('id');
      if (id?.endsWith('-revision')) continue;
      const options = await select.locator('option').all();
      if (options.length > 1) {
        const value = await options[1]!.getAttribute('value');
        if (value) await select.selectOption(value);
      }
    }
    for (const select of await form.locator('select:not([disabled])').all()) {
      // second pass: selects that were waiting on a dependent value
      const id = await select.getAttribute('id');
      if (id?.endsWith('-revision')) continue;
      if ((await select.inputValue()) !== '') continue;
      const options = await select.locator('option').all();
      if (options.length > 1) {
        const value = await options[1]!.getAttribute('value');
        if (value) await select.selectOption(value);
      }
    }
    for (const text of await form.locator('input[type="text"], textarea').all()) {
      if ((await text.inputValue()) === '') await text.fill('Signal timing and fault handling');
    }
    await shot(page, '04b-run-detail-filled-form');

    const submit = form.getByRole('button', { name: /Start job|Continue|Submit/ });
    await submit.waitFor();
    if (await submit.isEnabled()) {
      await submit.click();
      await page.getByText(/job job-/).waitFor({ timeout: 10_000 });
      await page.waitForTimeout(1200);
      await shot(page, '04-run-detail');
      try {
        await page.getByText('succeeded').first().waitFor({ timeout: 15_000 });
        await page.waitForTimeout(400);
        await shot(page, '04c-run-detail-complete');
      } catch {
        console.warn('run did not finish within 15s; skipping 04c');
      }
    } else {
      console.warn('submit still disabled; saving the filled form as 04-run-detail');
      await shot(page, '04-run-detail');
    }
  } catch (err) {
    console.warn('could not drive the form:', err instanceof Error ? err.message : err);
    await shot(page, '04-run-detail');
  }

  // 05: run history
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Runs' }).click();
  await page.getByRole('heading', { name: 'Runs' }).waitFor();
  await page.locator('table, [class*="border-dashed"]').first().waitFor({ timeout: 10_000 });
  await page.waitForTimeout(400);
  await shot(page, '05-runs');
} finally {
  await browser.close();
}

console.log('\nSaved screenshots:');
for (const p of saved) console.log(`  ${p}`);
