import { SECTIONS, REPEATS, DEFAULT_SETTINGS } from './schema.js';

const SITE_ORIGINS = ['https://*/*', 'http://*/*'];
const MAX_RESUME = 5 * 1024 * 1024;

const $ = (s, r = document) => r.querySelector(s);
const el = (tag, props = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k in n && k !== 'list') n[k] = v;
    else n.setAttribute(k, v === true ? '' : v);
  }
  kids.flat().forEach((k) => k != null && n.append(k));
  return n;
};

let profile = {};
let settings = { ...DEFAULT_SETTINGS };
let resume = null;
let saveTimer = null;
let dirty = false;

// ---------------------------------------------------------------- saving
function setSaveState(state, text) {
  const s = $('#save-state');
  s.className = 'save' + (state ? ' ' + state : '');
  s.textContent = text;
}

function scheduleSave() {
  setSaveState('pending', 'Saving…');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 350);
  dirty = true;
  updateMeter();
}

async function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  try {
    await chrome.storage.local.set({ profile, settings });
    dirty = false;
    setSaveState('', 'All changes saved');
  } catch (e) {
    setSaveState('error', 'Couldn’t save — ' + (e.message || 'storage error'));
  }
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), 2600);
}

