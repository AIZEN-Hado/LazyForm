// Extra checklist items not covered by e2e.mjs / e2e-auto.mjs
import { chromium } from 'playwright';
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'tests', 'out-check');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const check = (id, name, ok, detail = '') => { results.push({ id, name, ok, detail }); console.log(`${ok === null ? 'MANUAL' : ok ? 'PASS' : 'FAIL'}  [${id}] ${name}${detail ? '  — ' + detail : ''}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- 1. the shareable zip itself
const REL = path.join(OUT, 'release');
execSync(`unzip -q ${path.join(ROOT, "dist", "lazyform-extension.zip")} -d ${REL}`);
const files = execSync(`cd ${REL} && find . -type f | sort`).toString().trim().split('\n');
const mf = JSON.parse(fs.readFileSync(path.join(REL, 'manifest.json')));
check('P1', 'Zip contains only extension files (no tests, keys, dotfiles)', !files.some((f) => /test|fixture|\.git|\.env|\.pem|node_modules|\.DS_Store/.test(f)), `${files.length} files`);
check('P2', 'Manifest V3, version set, no test flag, no always-on host access', mf.manifest_version === 3 && mf.version === '1.1.0' && !mf.version_name && !mf.host_permissions && !mf.content_scripts);
check('P3', 'All icon sizes present', ['16', '32', '48', '128'].every((s) => fs.existsSync(path.join(REL, mf.icons[s]))));
const src = files.filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(path.join(REL, f), 'utf8')).join('\n');
check('S1', 'No remote code / eval / new Function', !/\beval\(|new Function\(|importScripts\(\s*['"]http/.test(src));
check('S2', 'No network calls except reading the stored resume (data: URL)', (src.match(/fetch\(/g) || []).length === 1 && /fetch\(resume\.dataUrl\)/.test(src) && !/XMLHttpRequest|sendBeacon|WebSocket\(/.test(src));
check('S3', 'No externally_connectable / web_accessible_resources (websites can’t talk to it)', !mf.externally_connectable && !mf.web_accessible_resources);
const htmlFiles = files.filter((f) => f.endsWith('.html')).map((f) => fs.readFileSync(path.join(REL, f), 'utf8')).join('');
check('S4', 'No inline scripts or remote assets in extension pages', !/<script(?![^>]*src=)[^>]*>|\son\w+=["']|https?:\/\//.test(htmlFiles.replace(/<!doctype[^>]*>/i, '')));
check('S5', 'Every shadow root used for LazyForm UI is closed', !/attachShadow\(\{\s*mode:\s*'open'/.test(src));
check('S6', 'Banner buttons only react to real (trusted) clicks', /e\.isTrusted/.test(src));

// ---------------------------------------------------------------- browser checks on the release build
const servers = [8901, 8902].map((p) => spawn('python3', ['-m', 'http.server', String(p), '--bind', '127.0.0.1', '-d', path.join(ROOT, 'tests', 'fixtures2')], { stdio: 'ignore' }));
fs.writeFileSync(path.join(ROOT, 'tests', 'fixtures2', 'big.html'), `<!doctype html><title>Big form</title><form>${Array.from({ length: 150 }, (_, i) => {
  const labels = ['First name', 'Last name', 'Email', 'Phone', 'City', 'Country', 'LinkedIn', 'Notice period', 'Expected salary', 'Why do you like puzzles?'];
  return `<p><label for="b${i}">${labels[i % labels.length]} ${i}</label><input id="b${i}"></p>`;
}).join('')}</form>`);
fs.writeFileSync(path.join(ROOT, 'tests', 'fixtures2', 'busy.html'), `<!doctype html><title>Busy feed</title><form><label for="e">Email</label><input id="e"></form><div id="feed"></div>
<script>setInterval(()=>{const d=document.createElement('p');d.textContent='post '+Date.now();feed.prepend(d);if(feed.children.length>50)feed.lastChild.remove();},100)</script>`);
fs.writeFileSync(path.join(ROOT, 'tests', 'fixtures2', 'xss.html'), `<!doctype html><title>Labels with HTML</title><form>
<label for="q">&lt;img src=x onerror="window.__pwned=1"&gt; Required question *</label><input id="q" required>
<label for="e">Email</label><input id="e"></form>`);
fs.writeFileSync(path.join(ROOT, 'tests', 'fixtures2', 'empty.html'), `<!doctype html><title>Blog</title><h1>Just an article</h1><p>No forms here.</p>`);
await wait(800);

// test copy = release + host access so headless can act without clicking the toolbar
const T = path.join(OUT, 'test-build');
fs.cpSync(REL, T, { recursive: true });
const tmf = { ...mf, host_permissions: ['<all_urls>'], version_name: 'test' };
fs.writeFileSync(path.join(T, 'manifest.json'), JSON.stringify(tmf));

const PROFILE = {
  firstName: '<img src=x onerror="window.__pwned=1">Priya', lastName: 'Sharma', email: 'priya@example.com', phone: '+91 98765 43210', city: 'Bengaluru', country: 'India',
  linkedin: 'https://linkedin.com/in/x', noticePeriod: '30 days', expectedSalary: '35 LPA',
  experience: [{ title: 'Engineer', company: 'Example' }], education: [{ school: 'EIT' }],
};

async function launch(ext, name) {
  const ctx = await chromium.launchPersistentContext(path.join(OUT, name), {
    channel: 'chromium', headless: true, viewport: { width: 1100, height: 850 },
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  await wait(1500);
  const sw = ctx.serviceWorkers().find((w) => w.url().startsWith('chrome-extension')) || (await ctx.waitForEvent('serviceworker'));
  return { ctx, sw, id: new URL(sw.url()).host };
}

const errors = [];
const watch = (page, label) => { page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`)); page.on('console', (m) => m.type() === 'error' && !/favicon|ERR_|Failed to load resource/.test(m.text()) && errors.push(`${label}: ${m.text()}`)); };

try {
  // ---- release build exactly as a friend would load it
  {
    const { ctx, sw, id } = await launch(REL, 'rel');
    check('I1', 'Release zip loads in Chrome, background worker starts', !!id);
    const opts = ctx.pages().find((p) => p.url().includes('options.html'));
    check('I2', 'Setup page opens on first install', !!opts);
    const cmds = await sw.evaluate(() => chrome.commands.getAll());
    const fill = cmds.find((c) => c.name === 'fill-form');
    const auto = cmds.find((c) => c.name === 'toggle-auto');
    check('I3', 'Fill shortcut assigned (Alt+Shift+F)', !!fill?.shortcut, fill?.shortcut || 'not assigned');
    check('I4', 'Auto-apply shortcut assigned (Alt+Shift+Y)', !!auto?.shortcut, auto?.shortcut || 'not assigned by Chrome');
    const perms = await sw.evaluate(() => chrome.permissions.getAll());
    check('S7', 'Installs with no site access (only storage, activeTab, scripting)', perms.origins.length === 0 && perms.permissions.sort().join() === 'activeTab,scripting,storage', JSON.stringify(perms));
    const popup = await ctx.newPage(); watch(popup, 'popup');
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await popup.waitForSelector('#view .empty, #view .btn');
    check('U1', 'Popup with empty profile points to setup', (await popup.textContent('#view')).includes('Set up your profile'));
    await ctx.close();
  }

  const { ctx, sw, id } = await launch(T, 'test');
  ctx.pages().forEach((p) => p.url().includes('options') && p.close());
  await sw.evaluate((p) => chrome.storage.local.set({ profile: p }), PROFILE);

  // ---- setup page: a11y, backup, limits, XSS
  const opts = await ctx.newPage(); watch(opts, 'options');
  await opts.goto(`chrome-extension://${id}/options.html`);
  await opts.waitForSelector('#f-firstName');
  const unlabeled = await opts.evaluate(() => [...document.querySelectorAll('input:not([type=hidden]):not([hidden]), select, textarea')]
    .filter((e) => !(e.labels?.length || e.getAttribute('aria-label') || e.getAttribute('aria-labelledby'))).map((e) => e.id || e.name || e.type));
  check('A1', 'Every setup-page field has a label (screen readers)', unlabeled.length === 0, unlabeled.join(', '));
  const unnamedBtns = await opts.evaluate(() => [...document.querySelectorAll('button')].filter((b) => !(b.textContent.trim() || b.getAttribute('aria-label'))).length);
  check('A2', 'Every button has a name', unnamedBtns === 0);
  await opts.keyboard.press('Tab');
  const firstFocus = await opts.evaluate(() => document.activeElement.textContent.trim());
  check('A3', 'Keyboard: first Tab reaches “Skip to form” link', firstFocus === 'Skip to form', firstFocus);
  const outline = await opts.evaluate(() => { const i = document.getElementById('f-email'); i.focus(); const s = getComputedStyle(i); return s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2; });
  check('A4', 'Visible focus outline on fields', outline);

  // contrast of main text colours, light + dark
  async function contrastSet(page) {
    return page.evaluate(() => {
      const lum = (c) => { const [r, g, b] = c.match(/\d+/g).slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
      const bgOf = (el) => { for (let n = el; n; n = n.parentElement) { const c = getComputedStyle(n).backgroundColor; if (!/rgba\(0, 0, 0, 0\)|transparent/.test(c)) return c; } return 'rgb(255,255,255)'; };
      const els = [...document.querySelectorAll('h1, h2, label, p, .hint, .blurb, nav a, .side-note, button, .lede')].filter((e) => e.textContent.trim() && e.getClientRects().length);
      let worst = 99, which = '';
      els.forEach((e) => { const r = ratio(getComputedStyle(e).color, bgOf(e)); if (r < worst) { worst = r; which = e.className || e.tagName; } });
      return { worst: Math.round(worst * 100) / 100, which };
    });
  }
  const light = await contrastSet(opts);
  check('A5', 'Text contrast ≥ 4.5:1 (light mode)', light.worst >= 4.5, `lowest ${light.worst} on ${light.which}`);
  await opts.emulateMedia({ colorScheme: 'dark' });
  await wait(500); // let colour transitions finish
  const dark = await contrastSet(opts);
  check('A6', 'Text contrast ≥ 4.5:1 (dark mode)', dark.worst >= 4.5, `lowest ${dark.worst} on ${dark.which}`);
  await opts.screenshot({ path: path.join(OUT, 'options-dark.png') });
  await opts.emulateMedia({ colorScheme: 'light' });

  check('S8', 'HTML in your own profile is shown as text, never run', (await opts.inputValue('#f-firstName')).startsWith('<img') && !(await opts.evaluate(() => window.__pwned)));

  // resume over 5 MB is refused
  const big = path.join(OUT, 'big.pdf');
  fs.writeFileSync(big, Buffer.alloc(5.5 * 1024 * 1024, 1));
  await opts.setInputFiles('#resume-file', big);
  await wait(500);
  check('R1', 'Resume over 5 MB is refused with a message', !(await sw.evaluate(() => chrome.storage.local.get('resume'))).resume && /over 5 MB/.test(await opts.textContent('#toast')));

  // export → delete all → import round-trip
  const [dl] = await Promise.all([opts.waitForEvent('download'), opts.click('text=Export backup')]);
  const backup = path.join(OUT, 'backup.json');
  await dl.saveAs(backup);
  check('R2', 'Export backup downloads your profile', JSON.parse(fs.readFileSync(backup)).profile.email === 'priya@example.com');
  opts.once('dialog', (d) => d.accept());
  await opts.click('text=Delete all my data');
  await wait(400);
  const afterDelete = await sw.evaluate(() => chrome.storage.local.get(null));
  check('R3', '“Delete all my data” wipes everything', Object.keys(afterDelete).length === 0, JSON.stringify(Object.keys(afterDelete)));
  const bad = path.join(OUT, 'bad.json');
  fs.writeFileSync(bad, '{"hello":1}');
  await opts.setInputFiles('input[type=file][accept*=json]', bad);
  await wait(400);
  check('R4', 'Importing a wrong file is rejected', /Couldn’t import/.test(await opts.textContent('#toast')));
  await opts.setInputFiles('input[type=file][accept*=json]', backup);
  await wait(500);
  check('R5', 'Importing the backup restores the profile', (await sw.evaluate(() => chrome.storage.local.get('profile'))).profile?.email === 'priya@example.com');

  // ---- filling robustness
  // An extension page can use the same chrome.* APIs; it survives worker restarts
  async function liveSW() {
    const p = await ctx.newPage();
    await p.goto(`chrome-extension://${id}/popup.html`);
    return { evaluate: async (fn, arg) => { try { return await p.evaluate(fn, arg); } finally { await p.close(); } } };
  }
  async function tabOf(urlPart) { return (await liveSW()).evaluate(async (u) => (await chrome.tabs.query({})).find((t) => t.url?.includes(u))?.id, urlPart); }
  async function popupFill(tabId) {
    const p = await ctx.newPage(); watch(p, 'popup');
    await p.goto(`chrome-extension://${id}/popup.html?tabId=${tabId}`);
    await p.waitForSelector('#fill');
    await p.waitForFunction(() => !document.querySelector('.status')?.textContent.includes('Checking'));
    return p;
  }

  const empty = await ctx.newPage(); await empty.goto('http://127.0.0.1:8901/empty.html');
  const pe = await popupFill(await tabOf('empty.html'));
  check('U2', 'Page with no form: popup says so', /No form fields/.test(await pe.textContent('.status')));
  await pe.click('#fill'); await pe.waitForSelector('.empty h2');
  check('U3', 'Clicking Fill there explains nothing to fill', (await pe.textContent('.empty h2')) === 'No form found');
  await pe.close(); await empty.close();

  const xss = await ctx.newPage(); watch(xss, 'xss page');
  await xss.goto('http://127.0.0.1:8901/xss.html');
  const px = await popupFill(await tabOf('xss.html'));
  await px.click('#fill'); await px.waitForSelector('.summary');
  await wait(500);
  check('S9', 'Hostile label text shown safely in popup + on-page panel', !(await xss.evaluate(() => window.__pwned)) && !(await px.evaluate(() => window.__pwned)) && /img src=x/.test(await px.textContent('.list')));
  await px.close(); await xss.close();

  const bigp = await ctx.newPage(); await bigp.goto('http://127.0.0.1:8901/big.html');
  const pb = await popupFill(await tabOf('big.html'));
  const t0 = Date.now(); await pb.click('#fill'); await pb.waitForSelector('.summary', { timeout: 30000 });
  const ms = Date.now() - t0;
  check('F1', '150-field form fills in under 3 seconds', ms < 3000, `${ms} ms, ${await pb.textContent('.stat.ok b')} filled`);
  await pb.close(); await bigp.close();

  // ---- auto-apply: worker restart, busy page cost, permission removal
  const page = await ctx.newPage(); watch(page, 'career');
  await page.goto('http://127.0.0.1:8901/career.html');
  const tabId = await tabOf('career.html');
  const pp = await ctx.newPage(); watch(pp, 'popup');
  await pp.goto(`chrome-extension://${id}/popup.html?tabId=${tabId}`);
  await pp.click('#auto-start'); await pp.waitForSelector('#auto-stop');
  await page.waitForFunction(() => document.getElementById('em').value !== '', null, { timeout: 8000 });
  // kill the background worker (Chrome does this after ~30 s idle)
  let stopped = false;
  try {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('ServiceWorker.enable');
    await cdp.send('ServiceWorker.stopAllWorkers');
    stopped = true;
  } catch {}
  await wait(1500);
  await page.click('#next1');
  await page.waitForFunction(() => document.getElementById('t0').value !== '', null, { timeout: 8000 }).catch(() => {});
  await page.click('#next2'); await wait(300);
  await page.click('#cont'); await page.waitForURL('**/career2.html');
  await page.waitForFunction(() => document.getElementById('li').value !== '', null, { timeout: 10000 }).catch(() => {});
  check('W1', 'Auto-apply survives Chrome putting the background worker to sleep', stopped && (await page.inputValue('#li')) === PROFILE.linkedin, stopped ? '' : 'could not stop worker');

  // busy page: CPU cost while auto-apply is on
  const busy = await ctx.newPage(); await busy.goto('http://127.0.0.1:8901/busy.html');
  const busyTab = await tabOf('busy.html');
  const cdpB = await ctx.newCDPSession(busy); await cdpB.send('Performance.enable');
  const scriptTime = async () => (await cdpB.send('Performance.getMetrics')).metrics.find((m) => m.name === 'ScriptDuration').value;
  let a = await scriptTime(); await wait(6000); const off = (await scriptTime()) - a;
  const pb2 = await ctx.newPage();
  await pb2.goto(`chrome-extension://${id}/popup.html?tabId=${busyTab}`);
  await pb2.click('#auto-start'); await pb2.waitForSelector('#auto-stop');
  await wait(1500);
  a = await scriptTime(); await wait(6000); const on = (await scriptTime()) - a;
  check('F2', 'Auto-apply adds little CPU on a constantly-changing page', on - off < 0.6, `page scripts ${off.toFixed(2)}s → ${on.toFixed(2)}s per 6s`);
  await pb2.click('#auto-stop'); await pb2.close(); await busy.close();

  // Removing permission → sessions end: can't be simulated headless (test build has fixed host access)
  check('W2', 'Removing site permission stops auto-apply everywhere', null, 'needs a real Chrome: toggle off in Settings while a session runs');

  // extension update/reload keeps data
  const before = (await (await liveSW()).evaluate(() => chrome.storage.local.get('profile'))).profile?.email;
  await (await liveSW()).evaluate(() => { setTimeout(() => chrome.runtime.reload(), 50); }).catch(() => {});
  await wait(3000);
  const after = (await (await liveSW()).evaluate(() => chrome.storage.local.get('profile')).catch(() => ({}))).profile?.email;
  check('W3', 'Updating / reloading the extension keeps your profile', before && before === after, `${before} → ${after}`);

  check('E1', 'No JavaScript errors in extension pages or filled pages during all checks', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
} catch (e) {
  check('X', 'Unexpected error', false, e.stack);
} finally {
  servers.forEach((s) => s.kill());
  ['big.html', 'busy.html', 'xss.html', 'empty.html'].forEach((f) => fs.rmSync(path.join(ROOT, 'tests', 'fixtures2', f), { force: true }));
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
  const failed = results.filter((r) => r.ok === false);
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed, ${failed.length} failed`);
}
