// End-to-end test: loads the real extension in Chromium and fills synthetic forms.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'tests', 'out');
const EXT_SRC = path.join(ROOT, 'extension');
const EXT = path.join(OUT, 'ext-under-test');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
fs.cpSync(EXT_SRC, EXT, { recursive: true });
// Test-only: grant site access up front, since a headless run can't click the toolbar icon (activeTab).
const mf = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json')));
mf.host_permissions = ['<all_urls>'];
mf.version_name = 'test';
fs.writeFileSync(path.join(EXT, 'manifest.json'), JSON.stringify(mf, null, 2));

const servers = [8901, 8902].map((p) =>
  spawn('python3', ['-m', 'http.server', String(p), '--bind', '127.0.0.1', '-d', path.join(ROOT, 'tests', 'fixtures')], { stdio: 'ignore' }));
await new Promise((r) => setTimeout(r, 800));

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

const PROFILE = {
  firstName: 'Priya', lastName: 'Sharma', email: 'priya.sharma@example.com', phone: '+91 98765 43210', phoneCountryCode: '+91',
  city: 'Bengaluru', state: 'Karnataka', country: 'India', postalCode: '560001', street: '12 MG Road',
  linkedin: 'https://linkedin.com/in/priya-example', github: 'https://github.com/priya-example', portfolio: 'https://priya.example.com',
  yearsExperience: '6', noticePeriod: '30 days', availableStartDate: '2026-12-01', expectedSalary: '35,00,000 INR',
  authorizedToWork: 'Yes', requireSponsorship: 'No', willingToRelocate: 'Yes', over18: 'Yes',
  gender: 'Female', hispanic: 'No', veteran: 'I am not a protected veteran', disability: 'No, I do not have a disability',
  summary: 'Backend engineer with 6 years building payments systems.', coverLetter: 'Dear hiring team, I am excited to apply…',
  skills: 'Go, Python, PostgreSQL, Kafka',
  experience: [{ title: 'Senior Software Engineer', company: 'Example Payments', startDate: '2022-03' }],
  education: [{ school: 'Example Institute of Technology', degree: "Bachelor's Degree", fieldOfStudy: 'Computer Science', endDate: '2019-06' }],
  customQA: [{ question: 'Why do you want to work at Acme?', answer: 'Acme builds the tools I use daily and I want to help scale them.' }],
};

const userData = path.join(OUT, 'profile-dir');
const ctx = await chromium.launchPersistentContext(userData, {
  channel: 'chromium', headless: true,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  viewport: { width: 1200, height: 900 },
});

try {
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker');
  const extId = new URL(sw.url()).host;
  check('Extension loads and service worker starts', !!extId, extId);

  // ------------------------------------------------------------ options page
  await new Promise((r) => setTimeout(r, 800));
  let options = ctx.pages().find((p) => p.url().includes('options.html'));
  check('Setup page opens automatically on first install', !!options);
  if (!options) { options = await ctx.newPage(); await options.goto(`chrome-extension://${extId}/options.html`); }
  await options.waitForSelector('#f-firstName');
  await options.fill('#f-firstName', 'Priya');
  await options.fill('#f-email', 'priya.sharma@example.com');
  await options.waitForFunction(() => document.querySelector('#save-state').textContent.includes('saved'));
  let stored = await sw.evaluate(() => chrome.storage.local.get('profile'));
  check('Typing on setup page autosaves', stored.profile?.firstName === 'Priya' && stored.profile?.email === 'priya.sharma@example.com');

  const resumePath = path.join(OUT, 'Priya_Sharma_Resume.pdf');
  fs.writeFileSync(resumePath, '%PDF-1.4\n% synthetic test resume\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
  await options.setInputFiles('#resume-file', resumePath);
  await options.waitForFunction(() => document.querySelector('.drop .name')?.textContent.includes('Priya_Sharma'));
  stored = await sw.evaluate(() => chrome.storage.local.get('resume'));
  check('Resume upload is stored', stored.resume?.name === 'Priya_Sharma_Resume.pdf' && stored.resume.dataUrl.startsWith('data:'));

  // load the rest of the synthetic profile, then reload the page to prove it renders saved data
  await sw.evaluate((p) => chrome.storage.local.set({ profile: p }), PROFILE);
  await options.reload();
  await options.waitForSelector('#f-firstName');
  check('Setup page shows saved profile after reload', (await options.inputValue('#f-lastName')) === 'Sharma' && (await options.inputValue('#f-experience0-company')) === 'Example Payments');
  check('Completeness meter updates', (await options.textContent('#meter-pct')) === '100%', await options.textContent('#meter-pct'));
  await options.screenshot({ path: path.join(OUT, 'options.png'), fullPage: false });
  await options.setViewportSize({ width: 390, height: 844 });
  await options.waitForTimeout(300);
  const overflow = await options.evaluate(() => {
    const W = window.innerWidth;
    if (document.documentElement.scrollWidth <= W) return '';
    return [...document.querySelectorAll('*')].filter((e) => e.getBoundingClientRect().right > W + 1).slice(0, 6).map((e) => e.tagName + '.' + e.className).join(' ');
  });
  check('Setup page fits a phone-width window (no sideways scroll)', !overflow, overflow);
  await options.setViewportSize({ width: 1200, height: 900 });

