// SPEC TEST 11: axe-core reports zero WCAG 2.2 AA violations in BOTH themes on
// the Dojo, the Library (Buy state and checkout-failed state), the lesson
// player, the assessment result (pass and partial-credit fail) and public
// verify. Runs the real built app against embedded Postgres, a fake Redis and
// a scripted Core (test/helpers/e2e.mjs). The same run walks the learner loop
// end to end: lessons -> assessment -> per-element result -> credential -> /verify.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { startStack, signUp, grantCourse, contextWithSession } from './helpers/e2e.mjs';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
// best-practice rules that are layout opinions, not WCAG 2.2 AA criteria
const DISABLED = ['region', 'landmark-one-main', 'page-has-heading-one'];

let stack, browser, buyer, learner, ctx, page;
const urls = {}; // name -> path, filled as the loop progresses

before(async () => {
  stack = await startStack();
  browser = await chromium.launch();
  buyer = await signUp(stack, { email: 'buyer@e2e.test', displayName: 'Bea Buyer' });
  learner = await signUp(stack, { email: 'learner@e2e.test', displayName: 'Lin Learner' });
  await grantCourse(stack, learner.user.id);
}, { timeout: 180_000 });
after(async () => { await browser?.close(); await stack?.stop(); });

async function axe(p, name) {
  const results = await new AxeBuilder({ page: p }).withTags(TAGS).disableRules(DISABLED).analyze();
  const theme = await p.evaluate(() => document.documentElement.getAttribute('data-theme') ?? 'system');
  const summary = results.violations.map(v => `${v.id} [${v.impact}] ${v.help}\n    ${v.nodes.slice(0, 3).map(n => n.target.join(' ') + ' :: ' + n.failureSummary?.split('\n')[1]).join('\n    ')}`);
  assert.deepEqual(summary, [], `${name} (${theme} theme) has axe violations:\n  ${summary.join('\n  ')}`);
  return results;
}

test('SPEC TEST 11 (light): Library in the Buy state and the checkout-failed state have zero violations', { timeout: 60_000 }, async () => {
  const c = await contextWithSession(browser, stack, buyer.setCookie);
  const p = await c.newPage();
  await p.goto('/library');
  assert.equal(await p.locator('button:has-text("Buy")').count(), 1, 'the unowned course shows a Buy button');
  await axe(p, 'Library (Buy)');
  await p.goto('/library?checkout=failed');
  await p.locator('.callout[role="alert"]').waitFor();
  await axe(p, 'Library (checkout failed)');
  urls.libraryBuy = '/library';
  urls.libraryFailed = '/library?checkout=failed';
  await c.close();
});

test('SPEC TEST 11 (light): the learner loop — Dojo, course, lesson player, assessment, partial-credit result, pass result, verify — zero violations at every step', { timeout: 120_000 }, async () => {
  ctx = await contextWithSession(browser, stack, learner.setCookie);
  page = await ctx.newPage();
  await page.goto('/');
  await axe(page, 'Dojo home');
  await page.getByRole('link', { name: 'Library' }).click();
  await axe(page, 'Library (owned)');
  await page.getByRole('link', { name: /^(Start|Continue)$/ }).click();
  await page.waitForURL(/\/courses\//);
  urls.course = new URL(page.url()).pathname;
  assert.ok(await page.locator('[data-review="draft"]').count(), 'unsigned content is labelled Draft, pending legal review');
  await axe(page, 'Course');

  // lesson 1 -> lesson 2 through the real form posts
  await page.getByRole('link', { name: /Begin/ }).click();
  await page.waitForURL(/\/lessons\//);
  urls.lesson = new URL(page.url()).pathname;
  assert.ok(await page.locator('.lb-trap').count(), 'the trap block renders');
  assert.ok(await page.getByText(/verified/i).first().isVisible(), 'the verified-on date is shown to the learner');
  await axe(page, 'Lesson player');
  await page.getByRole('button', { name: /complete|next/i }).first().click();
  await page.waitForURL(/\/lessons\//);
  await page.getByRole('button', { name: /complete|finish|course/i }).first().click();
  await page.waitForURL(/\/courses\//);

  // assessment: a thin answer first -> partial credit, fail, missed elements named
  await page.getByRole('button', { name: 'Start the assessment' }).click();
  await page.waitForURL(/\/assess\//);
  await axe(page, 'Assessment');
  await page.locator('textarea').fill('A signed written authorization that states the reason, signed on or before payday; the general acknowledgment at hire is not enough.');
  await page.getByLabel('On or before the next regular payday').check();
  await page.getByRole('button', { name: 'Submit answers' }).click();
  await page.waitForURL(/\/results\//);
  urls.resultFail = new URL(page.url()).pathname;
  await assert.doesNotReject(page.getByRole('heading', { name: 'Not yet' }).waitFor());
  assert.match(await page.locator('.result').innerText(), /You missed:/);
  assert.match(await page.locator('.result').innerText(), /95-25\.8/);
  assert.match(await page.locator('.result').innerText(), /1 of 4 elements/);
  await axe(page, 'Result (partial credit, below threshold)');

  // try again with a full answer -> pass -> credential
  await page.getByRole('button', { name: 'Try again' }).click();
  await page.waitForURL(/\/assess\//);
  await page.locator('textarea').fill('The employer needs a written authorization signed by the cashier that states the reason, signed on or before payday. A general acknowledgment at hire is not enough. The employee must get advance written notice of the actual amount and notice of the right to withdraw the authorization. For a shortage the employer has to give 7 days written notice of the amount before the payday. Because it is an overtime week the deduction can only bring pay down to minimum wage for the 40 regular hours and cannot touch the 6 overtime hours.');
  await page.getByLabel('On or before the next regular payday').check();
  await page.getByRole('button', { name: 'Submit answers' }).click();
  await page.waitForURL(/\/results\//);
  urls.resultPass = new URL(page.url()).pathname;
  await page.getByRole('heading', { name: 'Passed' }).waitFor();
  const ref = (await page.locator('.callout-ok .cite-ref').first().innerText()).trim();
  assert.match(ref, /^LC-E2E-/, 'the credential reference is shown');
  await axe(page, 'Result (pass)');
  await page.getByRole('link', { name: 'View your credential' }).click();
  await page.waitForURL(/\/verify\//);
  urls.verify = new URL(page.url()).pathname;
  await page.getByRole('heading', { name: 'This credential is valid.' }).waitFor();
  await axe(page, 'Public verify');

  // Dojo home now shows the Orange rank and the credential
  await page.goto('/');
  assert.match(await page.locator('main').innerText(), /Orange Belt/);
  await axe(page, 'Dojo home (credentialed)');
  urls.dojo = '/';
});

test('SPEC TEST 11 (dark): the theme toggle switches to dark and every page above has zero violations in the dark theme', { timeout: 120_000 }, async () => {
  assert.ok(urls.verify && urls.resultPass && urls.lesson, 'the light pass must have walked the loop first');
  await page.goto('/');
  const toggle = page.locator('[data-theme-toggle]');
  await toggle.click();
  assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), 'dark');
  assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
  for (const [name, path] of Object.entries(urls)) {
    if (name.startsWith('library')) continue; // buyer's pages: separate context below
    await page.goto(path);
    assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), 'dark', `${name} keeps the dark theme across navigation`);
    await axe(page, `${name} (dark)`);
  }
  const c = await contextWithSession(browser, stack, buyer.setCookie);
  const p = await c.newPage();
  await p.goto('/library');
  await p.locator('[data-theme-toggle]').click();
  await axe(p, 'Library (Buy, dark)');
  await p.goto('/library?checkout=failed');
  assert.equal(await p.evaluate(() => document.documentElement.getAttribute('data-theme')), 'dark');
  await axe(p, 'Library (checkout failed, dark)');
  await c.close();
});
