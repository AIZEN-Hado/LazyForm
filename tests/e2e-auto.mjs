// Auto-apply mode end-to-end: multi-step career page, multi-page, new-site prompt, Stop, abuse attempts.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'tests', 'out-auto');
const EXT = path.join(OUT, 'ext-under-test');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
fs.cpSync(path.join(ROOT, 'extension'), EXT, { recursive: true });
const mf = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json')));
mf.host_permissions = ['<all_urls>']; // test-only: headless can't click the permission prompt
mf.version_name = 'test';
fs.writeFileSync(path.join(EXT, 'manifest.json'), JSON.stringify(mf, null, 2));

const servers = [8901, 8902].map((p) => spawn('python3', ['-m', 'http.server', String(p), '--bind', '127.0.0.1', '-d', path.join(ROOT, 'tests', 'fixtures2')], { stdio: 'ignore' }));
await new Promise((r) => setTimeout(r, 800));

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const PROFILE = {
  firstName: 'Priya', lastName: 'Sharma', email: 'priya@example.com', phone: '+91 98765 43210', city: 'Bengaluru', country: 'India',
  linkedin: 'https://linkedin.com/in/priya-example', expectedSalary: '35 LPA', gender: 'Female',
  authorizedToWork: 'Yes', requireSponsorship: 'No', availableStartDate: '2026-12-01',
  experience: [
    { title: 'Senior Software Engineer', company: 'Example Payments', startDate: '2022-03' },
    { title: 'Software Engineer', company: 'Old Corp', startDate: '2019-07', endDate: '2022-02' },
  ],
  education: [{ school: 'Example Institute of Technology', degree: 'B.Tech', fieldOfStudy: 'Computer Science', endDate: '2019-06' }],
  customQA: [
    { question: 'Why do you want to work at Acme?', answer: 'I love Acme products.' },
    { question: 'Why do you want to work here?', answer: 'The team and the problems excite me.' },
    { question: 'PAN card number', answer: 'ABCDE1234F' },
  ],
};

// Click a button inside LazyForm's closed shadow root the way a real user would (trusted mouse click)
async function clickClosed(page, cls) {
  const cdp = await page.context().newCDPSession(page);
  const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
  let found = null;
  (function walk(n) {
    if (found || !n) return;
    if (n.nodeName === 'BUTTON' && (n.attributes || []).join(' ').includes(cls)) found = n;
    [...(n.children || []), ...(n.shadowRoots || []), ...(n.contentDocument ? [n.contentDocument] : [])].forEach(walk);
  })(root);
  if (!found) throw new Error('button not found: ' + cls);
  const { model } = await cdp.send('DOM.getBoxModel', { backendNodeId: found.backendNodeId });
  const q = model.content;
  await page.mouse.click((q[0] + q[4]) / 2, (q[1] + q[5]) / 2);
  await cdp.detach();
}
const hasBanner = (page) => page.evaluate(() => !!document.querySelector('[data-lazyform-ui]'));

const ctx = await chromium.launchPersistentContext(path.join(OUT, 'profile'), {
  channel: 'chromium', headless: true, viewport: { width: 1100, height: 900 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});

try {
  await wait(1500);
  const sw = ctx.serviceWorkers().find((w) => w.url().startsWith('chrome-extension')) || (await ctx.waitForEvent('serviceworker'));
  const extId = new URL(sw.url()).host;
  await sw.evaluate((p) => chrome.storage.local.set({ profile: p, settings: { dateFormat: 'DD/MM/YYYY', highlight: true, showPanel: true } }), PROFILE);
  ctx.pages().filter((p) => p.url().includes('options.html')).forEach((p) => p.close());

  // ---- a hostile page in another tab can't trigger anything (no session there)
  const bystander = await ctx.newPage();
  await bystander.goto('http://127.0.0.1:8902/other.html?bystander');

  // ---- start auto-apply from the popup
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:8901/career.html');
  const tabId = await sw.evaluate(async () => (await chrome.tabs.query({})).find((t) => t.url?.includes('career.html')).id);
  const popup = await ctx.newPage();
  await popup.setViewportSize({ width: 360, height: 600 });
  popup.on('console', (m) => console.log('[popup]', m.type(), m.text()));
  popup.on('pageerror', (e) => console.log('[popup error]', e.message));
  await popup.goto(`chrome-extension://${extId}/popup.html?tabId=${tabId}`);
  await popup.waitForSelector('#auto-start');
  await popup.screenshot({ path: path.join(OUT, 'popup-off.png') });
  await popup.click('#auto-start');
  await popup.waitForSelector('#auto-stop', { timeout: 10000 }).catch(async (e) => { console.log('VIEW:', await popup.textContent('#view')); throw e; });
  check('Popup starts auto-apply and shows it as on', true);

  // Step 1 fills by itself
  await page.waitForFunction(() => document.getElementById('em').value !== '', null, { timeout: 8000 }).catch(() => {});
  const v = (s) => page.inputValue(s);
  check('Step 1 filled automatically', (await v('#fn')) === 'Priya' && (await v('#em')) === PROFILE.email && (await v('#ph')) === PROFILE.phone);
  check('Banner shown while on', await hasBanner(page));
  await page.screenshot({ path: path.join(OUT, 'step1.png') });

  // The user edits a filled field — auto-apply must not put it back
  await page.fill('#ln', 'Sharma-Rao');

  // Step 2 appears after "Next" — filled without any click on LazyForm
  await page.click('#next1');
  await page.waitForFunction(() => document.getElementById('t0').value !== '', null, { timeout: 8000 }).catch(() => {});
  check('Step 2 filled automatically after Next', (await v('#t0')) === 'Senior Software Engineer' && (await v('#c0')) === 'Example Payments');
  check('2nd job block gets the 2nd job', (await v('#t1')) === 'Software Engineer' && (await v('#c1')) === 'Old Corp', `${await v('#t1')} / ${await v('#c1')}`);
  check('Job dates (month inputs)', (await v('#s0')) === '2022-03' && (await v('#e1')) === '2022-02' && (await v('#e0')) === '', `${await v('#s0')} ${await v('#e0')} ${await v('#e1')}`);
  check('“I currently work here” ticked only for current job', (await page.isChecked('#cur0')) && !(await page.isChecked('#cur1')));
  check('Education block filled', (await v('#sch')) === 'Example Institute of Technology' && (await v('#deg')) === 'B.Tech' && (await v('#fos')) === 'Computer Science');
  check('User’s own edit was not overwritten', (await v('#ln')) === 'Sharma-Rao');

  // "+ Add another" creates a 3rd job block; profile only has 2, so it stays empty
  await page.click('#addexp');
  await wait(2500);
  check('Extra job block left empty (only 2 jobs in profile)', (await v('#t2')) === '');
  await page.screenshot({ path: path.join(OUT, 'step2.png'), fullPage: true });

  // Step 3: yes/no wording, saved answers, date format, sensitive field
  await page.click('#next2');
  await page.waitForFunction(() => document.getElementById('auth').value !== '', null, { timeout: 8000 }).catch(() => {});
  const authText = await page.$eval('#auth', (s) => s.options[s.selectedIndex].text);
  check('Authorized: picks “I am authorized” (not “I am not”)', authText === 'I am authorized to work in India', authText);
  check('Sponsorship: picks “No, I will not require”', await page.isChecked('input[name=sp][value=n]'));
  check('Saved Acme answer NOT reused for Globex; generic answer used instead', (await v('#why')) === 'The team and the problems excite me.', JSON.stringify(await v('#why')));
  check('Generic “work here” answer used', (await v('#why2')) === 'The team and the problems excite me.');
  check('Start date uses chosen DD/MM/YYYY format', (await v('#sd')) === '01/12/2026', await v('#sd'));
  check('Sensitive field (PAN) never filled, even with a saved answer', (await v('#ssn')) === '');
  check('Nothing submitted on the career page', !(await page.evaluate(() => window.__submitted)));
  await page.screenshot({ path: path.join(OUT, 'step3.png'), fullPage: true });

  // Page 2 on the same site: filled after navigation
  await page.click('#cont');
  await page.waitForURL('**/career2.html');
  await page.waitForFunction(() => document.getElementById('li').value !== '', null, { timeout: 8000 }).catch(() => {});
  check('Next page on same site filled automatically', (await v('#li')) === PROFILE.linkedin && (await v('#sal')) === '35 LPA' && (await v('#g')) === 'Female');
  check('Banner keeps running total', await hasBanner(page));
  await page.screenshot({ path: path.join(OUT, 'page2.png') });

  // Hand-off to a different site: waits for permission, page script can't press the button
  await page.click('#ext');
  await page.waitForURL('**/other.html');
  await wait(3000);
  check('New site is NOT filled without asking', (await v('#em')) === '');
  check('New site shows the “fill here too?” banner', await hasBanner(page));
  const tries = await page.evaluate(() => window.__tries);
  check('Page script found the banner but could not press it', tries > 0 && (await v('#em')) === '', `${tries} attempts`);
  await page.screenshot({ path: path.join(OUT, 'newsite.png') });
  await clickClosed(page, 'go');
  await page.waitForFunction(() => document.getElementById('em').value !== '', null, { timeout: 8000 }).catch(() => {});
  check('After the user clicks “Fill on this site”, it fills', (await v('#em')) === PROFILE.email && (await v('#city')) === 'Bengaluru');

  // Other tab untouched the whole time
  check('Other tabs never touched', (await bystander.inputValue('#em')) === '' && !(await hasBanner(bystander)));

  // Stop from the banner, then navigate: nothing fills any more
  await clickClosed(page, 'stop');
  await wait(500);
  check('Stop removes the banner', !(await hasBanner(page)));
  const st = await sw.evaluate(async (id) => (await chrome.storage.session.get('sessions')).sessions?.[id], tabId);
  check('Session ended in background', !st);
  await page.goto('http://127.0.0.1:8901/career.html?after-stop');
  await wait(2500);
  check('After Stop, new pages are not filled', (await v('#fn')) === '');

  // Popup reflects stopped state; restart & stop from popup
  await popup.reload();
  await popup.waitForSelector('#auto-start');
  check('Popup shows auto-apply off after Stop', true);
  await popup.click('#auto-start');
  await popup.waitForSelector('#auto-stop');
  await page.waitForFunction(() => document.getElementById('fn').value !== '', null, { timeout: 8000 }).catch(() => {});
  await popup.screenshot({ path: path.join(OUT, 'popup-on.png') });
  await popup.click('#auto-stop');
  await popup.waitForSelector('#auto-start');
  await wait(400);
  check('Stop from popup works', !(await hasBanner(page)));

  // Closing the tab ends the session
  await popup.click('#auto-start');
  await popup.waitForSelector('#auto-stop');
  await page.close();
  await wait(500);
  const left = await sw.evaluate(async () => Object.keys((await chrome.storage.session.get('sessions')).sessions || {}).length);
  check('Closing the tab ends the session', left === 0);

  // Capture refuses sensitive values
  const cap = await ctx.newPage();
  await cap.setContent('');
  await cap.goto('http://127.0.0.1:8901/career.html?capture');
  await cap.evaluate(() => { document.getElementById('step1').hidden = true; document.getElementById('step3').hidden = false; });
  await cap.fill('#ssn', 'ABCDE1234F');
  const capTab = await sw.evaluate(async () => (await chrome.tabs.query({})).find((t) => t.url?.includes('capture')).id);
  const items = await sw.evaluate(async (id) => {
    await chrome.scripting.executeScript({ target: { tabId: id }, files: ['content/filler.js'] });
    const [r] = await chrome.scripting.executeScript({ target: { tabId: id }, func: () => window.__lazyForm.capture() });
    return r.result;
  }, capTab);
  check('“Save my new answers” never saves ID/bank-type answers', !items.some((i) => /pan/i.test(i.question)), JSON.stringify(items));

  // Popup test hook is disabled in a normal build
  const real = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension', 'manifest.json')));
  check('Release manifest has no test flag', !real.version_name && !real.host_permissions);
} catch (e) {
  check('Unexpected error', false, e.stack);
} finally {
  await ctx.close();
  servers.forEach((s) => s.kill());
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}
