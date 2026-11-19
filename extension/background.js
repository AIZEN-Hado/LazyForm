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

