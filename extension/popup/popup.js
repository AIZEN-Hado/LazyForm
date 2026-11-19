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

async function doFill() {
  const btn = document.getElementById('fill');
  btn.disabled = true;
  btn.replaceChildren(el('span', { class: 'spinner', 'aria-hidden': 'true' }), 'Filling…');
  try {
    const res = await fillTab(tabId);
    if (res.busy) {
      btn.disabled = false;
      btn.replaceChildren('Still filling — try again in a second');
      return;
    }
    showResult(res);
  } catch (e) {
    view.replaceChildren(e instanceof RestrictedPageError ? restrictedMessage() : el('div', { class: 'err', role: 'alert', text: 'Something went wrong: ' + e.message }));
  }
}

function listItems(items, mapFn) {
  return el('ul', { class: 'list' }, items.map(mapFn));
}

function showResult(res) {
  const needs = res.skipped.filter((s) => s.attention || s.required);
  const other = res.skipped.filter((s) => !(s.attention || s.required));
  if (!res.fieldCount) {
    view.replaceChildren(
      el('div', { class: 'empty' }, el('h2', { text: 'No form found' }), el('p', { text: 'This page has no fields LazyForm can fill. If the form is on the next step, open it and try again.' })),
      el('button', { class: 'btn', type: 'button', text: 'Try again', onclick: start }));
    return;
  }
  const blocks = [
    el('div', { class: 'summary' },
      el('div', { class: 'stat ok' }, el('b', { text: res.filled.length }), el('span', { text: 'fields filled' })),
      el('div', { class: 'stat warn' }, el('b', { text: needs.length }), el('span', { text: 'need your attention' }))),
  ];
  if (needs.length) {
    blocks.push(el('details', { open: true }, el('summary', { text: `Check these (${needs.length})` }),
      listItems(needs, (s) => el('li', {}, el('span', { class: 'q' }, s.required ? el('span', { class: 'req', text: 'Required · ' }) : null, s.label), el('span', { class: 'a', text: s.reason })))));
  }
  if (res.filled.length) {
    blocks.push(el('details', { open: !needs.length }, el('summary', { text: `Filled (${res.filled.length})` }),
      listItems(res.filled, (f) => el('li', {}, el('span', { class: 'q', text: f.label }), el('span', { class: 'a', text: f.value })))));
  }
  if (other.length) {
    blocks.push(el('details', {}, el('summary', { text: `Left blank (${other.length})` }),
      listItems(other, (s) => el('li', {}, el('span', { class: 'q', text: s.label }), el('span', { class: 'a', text: s.reason })))));
  }
  blocks.push(el('p', { class: 'muted', text: 'Review everything, then submit the form yourself.' }));
  blocks.push(el('div', { class: 'actions' },
    el('button', { class: 'btn', type: 'button', text: 'Back', onclick: start }),
    el('button', { class: 'btn', type: 'button', text: 'Save my new answers', title: 'After you answer the remaining questions yourself, save those answers for next time', onclick: doCapture })));
  view.replaceChildren(...blocks);
}

