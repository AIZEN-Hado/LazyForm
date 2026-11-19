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

