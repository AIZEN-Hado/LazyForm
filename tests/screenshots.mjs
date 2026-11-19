// Captures the README screenshots from the real extension.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'docs', 'assets');
const EXT = path.join(ROOT, 'tests', 'out-shots', 'ext');
fs.mkdirSync(OUT, { recursive: true });
fs.rmSync(path.dirname(EXT), { recursive: true, force: true });
fs.cpSync(path.join(ROOT, 'extension'), EXT, { recursive: true });
const mf = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json')));
Object.assign(mf, { host_permissions: ['<all_urls>'], version_name: 'test' });
fs.writeFileSync(path.join(EXT, 'manifest.json'), JSON.stringify(mf));
const srv = spawn('python3', ['-m', 'http.server', '8931', '--bind', '127.0.0.1', '-d', path.join(ROOT, 'tests', 'fixtures2')], { stdio: 'ignore' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await wait(700);

const PROFILE = {
  firstName: 'Riya', lastName: 'Mehta', email: 'riya.mehta@example.com', phone: '+91 90000 12345', city: 'Pune', state: 'Maharashtra', country: 'India',
  linkedin: 'https://linkedin.com/in/riya-example', github: 'https://github.com/riya-example', yearsExperience: '4', noticePeriod: '30 days',
  expectedSalary: '24 LPA', authorizedToWork: 'Yes', requireSponsorship: 'No', skills: 'TypeScript, React, Node.js, PostgreSQL',
  summary: 'Full-stack engineer who likes shipping small, sharp products.',
  experience: [{ title: 'Software Engineer', company: 'Example Labs', startDate: '2022-01' }, { title: 'Frontend Intern', company: 'Demo Studio', startDate: '2021-01', endDate: '2021-12' }],
  education: [{ school: 'Example University', degree: 'B.E.', fieldOfStudy: 'Computer Engineering', endDate: '2021-06' }],
};

for (const scheme of ['light', 'dark']) {
  const ctx = await chromium.launchPersistentContext('', {
    channel: 'chromium', headless: true, colorScheme: scheme, deviceScaleFactor: 2, viewport: { width: 1280, height: 820 },
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  await wait(1500);
  const sw = ctx.serviceWorkers().find((w) => w.url().startsWith('chrome-extension'));
  const id = new URL(sw.url()).host;
  await sw.evaluate((p) => chrome.storage.local.set({ profile: p, resume: { name: 'Riya_Mehta_CV.pdf', type: 'application/pdf', size: 182000, dataUrl: 'data:application/pdf;base64,JVBERi0K', added: Date.now() } }), PROFILE);
  ctx.pages().forEach((p) => p.url().includes('options') && p.close());

  const opts = await ctx.newPage();
  await opts.goto(`chrome-extension://${id}/options.html`);
  await opts.waitForSelector('#f-firstName');
  await wait(600);
  await opts.screenshot({ path: path.join(OUT, `setup-${scheme}.png`) });

  if (scheme === 'light') {
    const page = await ctx.newPage();
    await page.setViewportSize({ width: 1100, height: 760 });
    await page.goto('http://127.0.0.1:8931/career.html');
    const tabId = await sw.evaluate(async () => (await chrome.tabs.query({})).find((t) => t.url?.includes('career.html')).id);
    const pop = await ctx.newPage();
    await pop.setViewportSize({ width: 368, height: 440 });
    await pop.goto(`chrome-extension://${id}/popup.html?tabId=${tabId}`);
    await pop.waitForSelector('#auto-start');
    await wait(700);
    await pop.screenshot({ path: path.join(OUT, 'popup-off.png') });
    await pop.click('#auto-start');
    await pop.waitForSelector('#auto-stop');
    await page.waitForFunction(() => document.getElementById('em').value !== '');
    await page.click('#next1');
    await page.waitForFunction(() => document.getElementById('t0').value !== '');
    await wait(1500);
    await pop.reload(); await pop.waitForSelector('#auto-stop'); await wait(500);
    await pop.screenshot({ path: path.join(OUT, 'popup-on.png') });
    await page.bringToFront();
    await page.screenshot({ path: path.join(OUT, 'autofill-page.png') });
  }
  await ctx.close();
}
srv.kill();
console.log(fs.readdirSync(OUT).join('\n'));
