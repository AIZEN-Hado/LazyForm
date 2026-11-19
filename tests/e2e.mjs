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

  // ------------------------------------------------------------ helpers
  async function openForm(url) {
    const page = await ctx.newPage();
    await page.goto(url);
    await page.waitForLoadState('networkidle');
    const tabId = await sw.evaluate(async (u) => (await chrome.tabs.query({})).find((t) => t.url === u)?.id, url);
    return { page, tabId };
  }
  async function fillViaPopup(tabId, shot) {
    const popup = await ctx.newPage();
    await popup.setViewportSize({ width: 360, height: 600 });
    await popup.goto(`chrome-extension://${extId}/popup.html?tabId=${tabId}`);
    await popup.waitForSelector('#fill');
    await popup.waitForFunction(() => !document.querySelector('.status')?.textContent.includes('Checking'));
    const status = await popup.textContent('.status');
    await popup.click('#fill');
    await popup.waitForSelector('.summary', { timeout: 20000 });
    if (shot) await popup.screenshot({ path: path.join(OUT, shot) });
    const filled = Number(await popup.textContent('.stat.ok b'));
    const needs = Number(await popup.textContent('.stat.warn b'));
    return { popup, filled, needs, status };
  }

  // ------------------------------------------------------------ Greenhouse-style
  {
    const { page, tabId } = await openForm('http://127.0.0.1:8901/greenhouse.html');
    const r = await fillViaPopup(tabId, 'popup-greenhouse.png');
    check('Popup detects fields before filling', /field.*match your profile/.test(r.status), r.status.trim());
    const v = async (s) => page.inputValue(s);
    check('GH: first/last/email/phone', (await v('#first_name')) === 'Priya' && (await v('#last_name')) === 'Sharma' && (await v('#email')) === PROFILE.email && (await v('#phone')) === PROFILE.phone);
    check('GH: location', (await v('#job_application_location')).startsWith('Bengaluru'), await v('#job_application_location'));
    check('GH: LinkedIn + website', (await v('#q1')) === PROFILE.linkedin && (await v('#q2')) === PROFILE.portfolio, `${await v('#q1')} | ${await v('#q2')}`);
    check('GH: work authorisation Yes / sponsorship No', (await v('#q3')) === '1' && (await v('#q4')) === '0');
    check('GH: saved custom answer used for "Why Acme?"', (await v('#q5')) === PROFILE.customQA[0].answer);
    check('GH: current company from experience', (await v('#q7')) === 'Example Payments');
    check('GH: expected salary', (await v('#q8')) === PROFILE.expectedSalary);
    check('GH: EEO selects', (await v('#gender')) === '2' && (await v('#hispanic')) === 'No' && (await v('#veteran')) === '1' && (await v('#disability')) === '2',
      [await v('#gender'), await v('#hispanic'), await v('#veteran'), await v('#disability')].join(','));
    const fileName = await page.evaluate(() => document.querySelector('#resume').files[0]?.name);
    check('GH: resume attached to file input', fileName === 'Priya_Sharma_Resume.pdf', String(fileName));
    check('GH: consent checkbox left for the user', !(await page.isChecked('#consent')));
    check('GH: hidden trap fields are NOT filled', (await v('#trap1')) === '' && (await v('#trap2')) === '');
    check('GH: unknown question left blank', (await v('#q6')) === '');
    check('GH: form NOT submitted', !(await page.evaluate(() => window.__submitted)));
    check('GH: on-page summary panel shown', await page.evaluate(() => !!document.getElementById('lazyform-panel-host')));
    await page.screenshot({ path: path.join(OUT, 'page-greenhouse.png'), fullPage: true });

    // learn a new answer from the page
    await page.fill('#q6', 'Go');
    await r.popup.click('text=Save my new answers');
    await r.popup.waitForSelector('.cap li');
    const capText = await r.popup.textContent('.cap');
    check('Capture finds the answer the user typed', /favourite programming language/i.test(capText) && capText.includes('Go'), capText.slice(0, 80));
    await r.popup.click('text=Save selected');
    await r.popup.waitForSelector('text=Saved');
    const qa = (await sw.evaluate(() => chrome.storage.local.get('profile'))).profile.customQA;
    check('Captured answer saved to profile', qa.some((q) => /favourite programming/i.test(q.question) && q.answer === 'Go'));
    await r.popup.close();

    // fresh page: the new saved answer is reused
    const again = await openForm('http://127.0.0.1:8901/greenhouse.html?second');
    const r2 = await fillViaPopup(again.tabId);
    check('Saved answer reused on next application', (await again.page.inputValue('#q6')) === 'Go');
    // already-filled fields are not overwritten
    await again.page.fill('#first_name', 'Manual');
    const r3 = await fillViaPopup(again.tabId);
    check('Does not overwrite what the user typed', (await again.page.inputValue('#first_name')) === 'Manual');
    await r2.popup.close(); await r3.popup.close(); await again.page.close();
    await page.close();
  }

  // ------------------------------------------------------------ Lever-style (no <label for>)
  {
    const { page, tabId } = await openForm('http://127.0.0.1:8901/lever.html');
    const r = await fillViaPopup(tabId, 'popup-lever.png');
    const v = (n) => page.inputValue(`[name="${n}"]`);
    check('Lever: full name from unlinked label', (await v('name')) === 'Priya Sharma', await v('name'));
    check('Lever: email/phone/org', (await v('email')) === PROFILE.email && (await v('phone')) === PROFILE.phone && (await v('org')) === 'Example Payments');
    check('Lever: LinkedIn / GitHub / Portfolio', (await v('urls[LinkedIn]')) === PROFILE.linkedin && (await v('urls[GitHub]')) === PROFILE.github && (await v('urls[Portfolio]')) === PROFILE.portfolio);
    check('Lever: years-of-experience range select (6 → 5-10)', (await v('cards[exp]')) === '5-10 years', await v('cards[exp]'));
    check('Lever: relocation radio Yes', await page.isChecked('input[name="cards[reloc]"][value="yes"]'));
    check('Lever: notice period', (await v('cards[notice]')) === '30 days');
    check('Lever: country select (India)', (await v('cards[country]')) === 'IN');
    check('Lever: gender radio Female (not "Male")', await page.isChecked('input[name="eeo[gender]"][value="Female"]'));
    await page.screenshot({ path: path.join(OUT, 'page-lever.png'), fullPage: true });
    await r.popup.close(); await page.close();
  }

  // ------------------------------------------------------------ React app with custom dropdowns
  {
    const { page, tabId } = await openForm('http://127.0.0.1:8901/react.html');
    const r = await fillViaPopup(tabId, 'popup-react.png');
    const state = JSON.parse(await page.textContent('#state'));
    check('React: controlled inputs update app state', state.firstName === 'Priya' && state.lastName === 'Sharma' && state.email === PROFILE.email && state.phone === PROFILE.phone, JSON.stringify(state));
    check('React: date input', state.start === '2026-12-01', state.start);
    check('React: "years" range select (6 → 5 or more)', state.exp === 'c', state.exp);
    check('React: authorised radio', state.auth === 'Yes');
    check('React: searchable combobox picks India', state.country === 'India', state.country);
    check('React: Workday-style listbox button picks Bachelor\'s', state.degree === "Bachelor's Degree", state.degree);
    check('React: form NOT submitted', !(await page.evaluate(() => window.__submitted)));
    await page.screenshot({ path: path.join(OUT, 'page-react.png'), fullPage: true });
    await r.popup.close(); await page.close();
  }

  // ------------------------------------------------------------ cross-origin iframe embed
  {
    const { page, tabId } = await openForm('http://127.0.0.1:8901/iframe.html');
    const r = await fillViaPopup(tabId);
    const frame = page.frames().find((f) => f.url().includes(':8902/'));
    check('Iframe: fills a cross-origin embedded form', (await frame.inputValue('#email')) === PROFILE.email && (await frame.inputValue('#first_name')) === 'Priya');
    await r.popup.close(); await page.close();
  }

