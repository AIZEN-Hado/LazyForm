import { fillTab, SITE_ORIGINS } from './lib/run.js';

// Job-application platforms a career page commonly hands you off to.
// Auto-apply mode keeps working on these and on the site where it was started;
// any other site asks first.
const ATS_DOMAINS = [
  'greenhouse.io', 'lever.co', 'ashbyhq.com', 'myworkdayjobs.com', 'myworkday.com', 'workday.com', 'myworkdaysite.com',
  'smartrecruiters.com', 'icims.com', 'taleo.net', 'successfactors.com', 'successfactors.eu', 'sapsf.com', 'sapsf.eu',
  'jobvite.com', 'bamboohr.com', 'workable.com', 'recruitee.com', 'breezy.hr', 'applytojob.com', 'teamtailor.com',
  'personio.de', 'personio.com', 'oraclecloud.com', 'freshteam.com', 'zohorecruit.com', 'zohorecruit.in',
  'darwinbox.in', 'darwinbox.com', 'keka.com', 'rippling.com', 'rippling-ats.com', 'dover.com', 'wellfound.com',
  'jazzhr.com', 'paylocity.com', 'adp.com', 'ultipro.com', 'ukg.com', 'avature.net', 'eightfold.ai', 'phenompeople.com',
  'hirebridge.com', 'pinpointhq.com', 'homerun.co', 'comeet.com', 'comeet.co', 'gem.com', 'hire.trakstar.com',
];
const IDLE_LIMIT_MS = 3 * 60 * 60 * 1000; // a session ends after 3 hours without activity

// ------------------------------------------------------------------ session state
// Serialise read-modify-write of session state (several frames report at once)
let lock = Promise.resolve();
const withLock = (fn) => (lock = lock.then(fn, fn));

async function getSessions() {
  const { sessions = {} } = await chrome.storage.session.get('sessions');
  return sessions;
}
async function saveSessions(sessions) {
  await chrome.storage.session.set({ sessions });
}
const totalsOf = (s) => ({ filled: s.filled, needs: Object.values(s.needs || {}).reduce((a, b) => a + b, 0) });

async function setBadge(tabId, on) {
  try {
    await chrome.action.setBadgeBackgroundColor({ tabId, color: '#16a34a' });
    await chrome.action.setBadgeText({ tabId, text: on ? 'ON' : '' });
  } catch {}
}

async function injectSession(tabId, session) {
  try {
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['content/filler.js', 'content/session.js'] });
  } catch {
    try { await chrome.scripting.executeScript({ target: { tabId }, files: ['content/filler.js', 'content/session.js'] }); }
    catch { return false; } // restricted page (chrome://, Web Store) — try again on the next page
  }
  const cfg = { origins: session.origins, ats: ATS_DOMAINS, totals: totalsOf(session) };
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: (c) => window.__lazyFormSession && window.__lazyFormSession.start(c),
      args: [cfg],
    });
  } catch {}
  setBadge(tabId, true);
  return true;
}

export async function startSession(tabId) {
  if (!(await chrome.permissions.contains({ origins: SITE_ORIGINS }))) return { ok: false, needsPermission: true };
  const tab = await chrome.tabs.get(tabId);
  let origin;
  try { origin = new URL(tab.url).origin; } catch {}
  if (!origin || !/^https?:/.test(origin)) return { ok: false, restricted: true };
  const sessions = await getSessions();
  const session = sessions[tabId] || { origins: [], filled: 0, needs: {}, started: Date.now() };
  if (!session.origins.includes(origin)) session.origins.push(origin);
  session.last = Date.now();
  sessions[tabId] = session;
  await saveSessions(sessions);
  const ok = await injectSession(tabId, session);
  return { ok, restricted: !ok };
}

export async function stopSession(tabId) {
  const sessions = await getSessions();
  if (!sessions[tabId]) return;
  delete sessions[tabId];
  await saveSessions(sessions);
  try { await chrome.tabs.sendMessage(tabId, { type: 'session:stop' }); } catch {}
  setBadge(tabId, false);
}

async function stopAll() {
  const sessions = await getSessions();
  await Promise.all(Object.keys(sessions).map((id) => stopSession(Number(id))));
}

// ------------------------------------------------------------------ follow the tab
chrome.tabs.onUpdated.addListener((tabId, info) => withLock(async () => {
  if (info.status !== 'complete' && !info.url) return;
  const sessions = await getSessions();
  const s = sessions[tabId];
  if (!s) return;
  if (Date.now() - (s.last || s.started) > IDLE_LIMIT_MS) return stopSession(tabId);
  if (info.url) { s.needs = {}; await saveSessions(sessions); }
  if (info.status === 'complete') injectSession(tabId, s);
}));

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const sessions = await getSessions();
  if (sessions[tabId]) { delete sessions[tabId]; await saveSessions(sessions); }
});

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (sender.id !== chrome.runtime.id) return;
  withLock(async () => {
    // From the popup / settings (our own extension pages)
    if (sender.url && sender.url.startsWith(chrome.runtime.getURL(''))) {
      if (msg.type === 'popup:start') { await chrome.storage.session.remove('pendingStart'); return reply(await startSession(msg.tabId)); }
      if (msg.type === 'popup:pendingStart') {
        await chrome.storage.session.set({ pendingStart: { tabId: msg.tabId, at: Date.now() } });
        return reply({ ok: true });
      }
      if (msg.type === 'popup:stop') { await stopSession(msg.tabId); return reply({ ok: true }); }
      if (msg.type === 'popup:status') {
        const s = (await getSessions())[msg.tabId];
        return reply(s ? { active: true, ...totalsOf(s) } : { active: false });
      }
      return reply(null);
    }
    // From session.js inside the session tab
    const tabId = sender.tab.id;
    const sessions = await getSessions();
    const s = sessions[tabId];
    if (!s) return reply(null);
    if (msg.type === 'session:stop') { await stopSession(tabId); return reply({ ok: true }); }
    if (msg.type === 'session:allowSite' && sender.frameId === 0) {
      const origin = new URL(sender.url).origin;
      if (/^https?:/.test(origin) && !s.origins.includes(origin)) s.origins.push(origin);
      s.last = Date.now();
      await saveSessions(sessions);
      await injectSession(tabId, s);
      return reply({ ok: true });
    }
    if (msg.type === 'session:filled') {
      s.filled += Math.max(0, Math.min(500, Number(msg.filled) || 0));
      s.needs = s.needs || {};
      s.needs[sender.frameId] = Math.max(0, Math.min(500, Number(msg.needs) || 0));
      if (msg.filled) s.last = Date.now();
      await saveSessions(sessions);
      try { await chrome.tabs.sendMessage(tabId, { type: 'session:totals', totals: totalsOf(s) }, { frameId: 0 }); } catch {}
      return reply({ ok: true });
    }
    reply(null);
  });
  return true;
});

// ------------------------------------------------------------------ lifecycle
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === 'install') {
    const { profile } = await chrome.storage.local.get('profile');
    if (!profile) chrome.runtime.openOptionsPage();
  }
  // v1.0 registered an always-on page script; v1.1 no longer uses it
  try { await chrome.scripting.unregisterContentScripts({ ids: ['lazyform-detector'] }); } catch {}
  const { settings } = await chrome.storage.local.get('settings');
  if (settings && 'autoDetect' in settings) {
    delete settings.autoDetect;
    await chrome.storage.local.set({ settings });
  }
});

// Removing the site permission ends every session
chrome.permissions.onRemoved.addListener(() => stopAll());
// Permission just granted from the popup's "Start auto-apply" (the popup may have closed)
chrome.permissions.onAdded.addListener(async () => {
  const { pendingStart } = await chrome.storage.session.get('pendingStart');
  await chrome.storage.session.remove('pendingStart');
  if (pendingStart && Date.now() - pendingStart.at < 120000) withLock(() => startSession(pendingStart.tabId));
});

async function flash(tabId, text, color) {
  try {
    await chrome.action.setBadgeBackgroundColor({ tabId, color });
    await chrome.action.setBadgeText({ tabId, text });
    setTimeout(async () => {
      const on = !!(await getSessions())[tabId];
      chrome.action.setBadgeText({ tabId, text: on ? 'ON' : '' }).catch(() => {});
    }, 5000);
  } catch {}
}

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (!tab?.id) return;
  if (command === 'fill-form') {
    try {
      const res = await fillTab(tab.id);
      await flash(tab.id, String(res.filled.length), '#16a34a');
    } catch {
      await flash(tab.id, '!', '#b91c1c');
    }
  }
  if (command === 'toggle-auto') {
    if ((await getSessions())[tab.id]) return stopSession(tab.id);
    const res = await startSession(tab.id);
    if (res.needsPermission) chrome.runtime.openOptionsPage();
    else if (!res.ok) flash(tab.id, '!', '#b91c1c');
  }
});
