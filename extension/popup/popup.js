import { fillTab, scanTab, captureTab, RestrictedPageError, SITE_ORIGINS } from '../lib/run.js';

const view = document.getElementById('view');
const el = (tag, props = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k in n) n[k] = v;
    else n.setAttribute(k, v === true ? '' : v);
  }
  kids.flat().forEach((k) => k != null && n.append(k));
  return n;
};

document.getElementById('open-profile').addEventListener('click', () => { chrome.runtime.openOptionsPage(); window.close(); });

let tabId = null;
let shortcut = 'Alt+Shift+F';

async function getTabId() {
  // Automated tests open the popup in a tab; only a build marked "test" honours this
  const fromQuery = new URLSearchParams(location.search).get('tabId');
  if (fromQuery && chrome.runtime.getManifest().version_name === 'test') return Number(fromQuery);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

function restrictedMessage() {
  return el('div', { class: 'err', role: 'alert' },
    el('strong', { text: 'Can’t fill this page. ' }),
    'Chrome doesn’t let extensions work on its own pages, the Web Store, or some secure portals. Open the application form and try again.');
}

let autoShortcut = 'Alt+Shift+Y';

function autoCard(st) {
  if (st && st.active) {
    return el('div', { class: 'auto on' },
      el('div', { class: 'auto-head' }, el('span', { class: 'orb', 'aria-hidden': 'true' }), el('strong', { text: 'Auto-apply is on in this tab' })),
      el('p', { text: `${st.filled} fields filled so far${st.needs ? ` · ${st.needs} need you on this page` : ''}. It keeps filling each new step and page until you stop it.` }),
      el('button', { class: 'btn stop', type: 'button', id: 'auto-stop', text: 'Stop auto-apply', onclick: stopAuto }));
  }
  return el('div', { class: 'auto' },
    el('div', { class: 'auto-head' }, el('span', { class: 'orb', 'aria-hidden': 'true' }), el('strong', { text: 'Auto-apply mode' }), autoShortcut ? el('kbd', { text: autoShortcut }) : null),
    el('p', { text: 'Fills every section, step and page of the application in this tab by itself, until you press Stop. Never submits.' }),
    el('button', { class: 'btn primary', type: 'button', id: 'auto-start', text: 'Start auto-apply', onclick: startAuto }));
}

async function sessionStatus() {
  try { return await chrome.runtime.sendMessage({ type: 'popup:status', tabId }); } catch { return { active: false }; }
}

async function startAuto() {
  const btn = document.getElementById('auto-start');
  // If Chrome closes this popup while showing the permission prompt, the background finishes starting
  await chrome.runtime.sendMessage({ type: 'popup:pendingStart', tabId }).catch(() => {});
  // Asked here, inside the click, because Chrome only shows permission prompts for a user action
  const granted = await chrome.permissions.request({ origins: SITE_ORIGINS }).catch(() => false);
  if (!granted) {
    btn.replaceWith(el('p', { class: 'err', role: 'alert', text: 'Auto-apply needs permission to keep working as the application moves between pages. You can still use “Fill this page”.' }));
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Starting…';
  const res = await chrome.runtime.sendMessage({ type: 'popup:start', tabId });
  if (res?.restricted) { view.replaceChildren(restrictedMessage()); return; }
  start();
}

async function stopAuto() {
  await chrome.runtime.sendMessage({ type: 'popup:stop', tabId });
  start();
}

function home(status, st) {
  view.replaceChildren(
    status,
    autoCard(st),
    el('div', { class: 'divider' }, el('span', { text: 'or just this page' })),
    el('button', { class: 'fill', id: 'fill', type: 'button', onclick: doFill }, 'Fill this page once'),
    el('p', { class: 'hint' }, 'Shortcut: ', el('kbd', { text: shortcut }), ' · nothing is submitted'),
  );
}

