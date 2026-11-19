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

