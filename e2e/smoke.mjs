// End-to-end smoke test against a running production build.
//   npm run build && NODE_ENV=production COOKIE_SECURE=false PORT=4173 npm start   (in another terminal)
//   node e2e/smoke.mjs [baseURL]
// Two real browsers (Rohit on desktop, Jagan on mobile) verify live sync for cooking, washing and chat,
// then every page is checked for horizontal overflow and console errors at mobile/tablet/desktop sizes.
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const BASE = process.argv[2] ?? 'http://localhost:4173';
const OUT = 'e2e/.artifacts';
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const errors = [];

const browser = await chromium.launch();
async function member(name, viewport, mobile = false) {
  const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, baseURL: BASE });
  const page = await ctx.newPage();
  await page.goto('/login');
  await page.getByRole('button', { name: `Sign in as ${name}` }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  // Only count errors once signed in (the login screen's "am I signed in?" probe is an expected 401).
  page.on('console', (m) => m.type() === 'error' && errors.push(`${name}: ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  return page;
}

try {
  // ---- Login screen --------------------------------------------------------
  const anon = await (await browser.newContext({ viewport: { width: 390, height: 844 }, baseURL: BASE })).newPage();
  await anon.goto('/cooking');
  await anon.waitForURL(/\/login/);
  check('signed-out visit to /cooking redirects to /login', true);
  await anon.getByRole('button', { name: 'Sign in as Dharun' }).waitFor();
  const names = await anon.getByRole('button', { name: /^Sign in as / }).allInnerTexts();
  check('login shows exactly six members', names.length === 6, names.join(', '));
  check('login screen never says "Admin"', !/admin/i.test(await anon.locator('body').innerText()));
  await anon.screenshot({ path: `${OUT}/login-mobile.png`, fullPage: true });

  const rohit = await member('Rohit', { width: 1440, height: 900 });
  const jagan = await member('Jagan', { width: 390, height: 844 }, true);
  await jagan.getByRole('heading', { level: 1, name: 'Jagan' }).waitFor({ timeout: 8000 });
  check('dashboard greets the signed-in member', true);

  // ---- Cooking: Rohit publishes, Jagan sees it live and votes, Rohit sees the tally live
  const title = `Rice + Sambar ${Date.now() % 10000}`;
  await jagan.goto('/cooking');
  await rohit.goto('/cooking');
  await rohit.getByRole('button', { name: 'Publish a menu' }).first().click();
  await rohit.getByPlaceholder('Rice, sambar and potato fry').fill(title);
  await rohit.getByRole('button', { name: 'Publish menu' }).click();
  await jagan.getByText(title).first().waitFor({ timeout: 8000 });
  check('Jagan sees Rohit’s new menu without reloading', true);
  const jaganPublish = await jagan.getByRole('button', { name: 'Publish a menu' }).count();
  check('Jagan has no publish control', jaganPublish === 0);
  await jagan.getByRole('button', { name: 'OK, I want this' }).first().click();
  await rohit.waitForFunction(
    () => /\b1\s+want it/.test(document.querySelector('main')?.innerText ?? ''),
    null,
    { timeout: 8000 },
  );
  check('Rohit sees Jagan’s vote live (1 want it)', true);
  await rohit.screenshot({ path: `${OUT}/cooking-desktop.png`, fullPage: true });
  await jagan.reload();
  await jagan.getByText(title).first().waitFor();
  const pressed = await jagan.getByRole('button', { name: 'OK, I want this' }).first().getAttribute('aria-pressed');
  check('vote persists after refresh', pressed === 'true', `aria-pressed=${pressed}`);

  // ---- Washing: Jagan books a free day, Rohit's calendar turns it red live
  await rohit.goto('/washing');
  await jagan.goto('/washing');
  const free = jagan.getByRole('button', { name: /^Book / }).first();
  const label = (await free.getAttribute('aria-label')).replace(/^Book /, '');
  await free.evaluate((el) => el.scrollIntoView({ block: 'center' })); // keep it clear of the fixed mobile tab bar
  await free.click();
  await jagan.getByRole('button', { name: 'Book this day' }).click();
  await rohit.getByLabel(new RegExp(`${label}: booked by Jagan`)).first().waitFor({ timeout: 8000 });
  check(`Rohit sees Jagan’s booking for ${label} live`, true);
  const stillBookable = await rohit.getByRole('button', { name: `Book ${label}` }).count();
  check('the booked day is no longer bookable for others', stillBookable === 0);
  await jagan.screenshot({ path: `${OUT}/washing-mobile.png`, fullPage: true });

  // ---- Room cleaning: Rohit assigns Jagan, Jagan sees it live and completes it, Rohit sees it done live
  await jagan.goto('/cleaning');
  await rohit.goto('/cleaning');
  check('Jagan has no assign control', (await jagan.getByRole('button', { name: 'Assign duties' }).count()) === 0);
  await rohit.getByRole('button', { name: 'Assign duties' }).first().click();
  await rohit.locator('label', { hasText: 'Jagan' }).first().click();
  await rohit.locator('label', { hasText: 'Mopping' }).click();
  await rohit.locator('label', { hasText: 'Custom task' }).click();
  const chore = `Clean the fridge ${Date.now() % 10000}`;
  await rohit.getByLabel('Describe the custom task').fill(chore);
  await rohit.getByRole('button', { name: 'Assign 2 duties' }).click();
  await jagan.locator('main li', { hasText: chore }).waitFor({ timeout: 8000 });
  check('Jagan sees the assigned duties live', (await jagan.locator('main li', { hasText: 'Mopping' }).count()) > 0);
  const row = jagan.locator('main li', { hasText: chore });
  await row.getByRole('button', { name: 'Mark done' }).click();
  await rohit.waitForFunction(
    (t) => [...document.querySelectorAll('section')].some((s) => s.textContent?.startsWith('Completed') && s.textContent.includes(t)),
    chore,
    { timeout: 8000 },
  );
  check('Rohit sees the task completed live', true);
  await jagan.screenshot({ path: `${OUT}/cleaning-mobile.png`, fullPage: true });

  // ---- Chat: live delivery both ways, persistence
  await rohit.goto('/chat');
  await jagan.goto('/chat');
  const msg = `Hello from Jagan ${Date.now() % 10000} 🍛`;
  await jagan.getByPlaceholder('Message the room').fill(msg);
  await jagan.getByRole('button', { name: 'Send message' }).click();
  await rohit.getByText(msg).waitFor({ timeout: 8000 });
  check('Rohit receives Jagan’s chat message live', true);
  await rohit.reload();
  await rohit.getByText(msg).waitFor();
  check('chat message persists after refresh', true);
  await rohit.screenshot({ path: `${OUT}/chat-desktop.png` });
  await jagan.screenshot({ path: `${OUT}/chat-mobile.png` });

  // ---- Responsive: no horizontal overflow on any page at three sizes
  const sizes = { mobile: { width: 360, height: 780 }, tablet: { width: 820, height: 1180 }, desktop: { width: 1440, height: 900 } };
  for (const [sizeName, vp] of Object.entries(sizes)) {
    await rohit.setViewportSize(vp);
    for (const path of ['/', '/cooking', '/washing', '/cleaning', '/chat', '/members', '/settings']) {
      await rohit.goto(path);
      await rohit.waitForLoadState('networkidle');
      const overflow = await rohit.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      check(`no horizontal scroll ${sizeName} ${path}`, overflow <= 0, overflow > 0 ? `${overflow}px` : '');
      if (path === '/' || sizeName === 'tablet') await rohit.screenshot({ path: `${OUT}/${sizeName}${path.replace(/\//g, '-') || '-home'}.png`, fullPage: true });
    }
  }
} catch (err) {
  check('smoke run completed', false, err.message.split('\n')[0]);
} finally {
  check('no console errors', errors.length === 0, errors.slice(0, 5).join(' | '));
  await browser.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}
