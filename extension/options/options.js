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

// ---------------------------------------------------------------- fields
function control(def, value, onChange, idPrefix = '') {
  const id = 'f-' + idPrefix + def.key;
  let input;
  if (def.type === 'select') {
    input = el('select', { id, name: def.key });
    def.options.forEach((o) => input.append(el('option', { value: o, text: o || '—' })));
    input.value = value || '';
  } else if (def.type === 'textarea') {
    input = el('textarea', { id, name: def.key, rows: def.rows || 3, placeholder: def.placeholder || '' });
    input.value = value || '';
  } else {
    input = el('input', {
      id, name: def.key, type: def.type || 'text', placeholder: def.placeholder || '',
      autocomplete: def.autocomplete || 'off', inputMode: def.type === 'number' ? 'numeric' : null,
    });
    if (def.type === 'number') input.min = '0';
    input.value = value || '';
  }
  input.addEventListener(def.type === 'select' ? 'change' : 'input', () => onChange(input.value));
  if (def.type === 'email' || def.type === 'url') {
    input.addEventListener('blur', () => input.setAttribute('aria-invalid', String(!!input.value && !input.checkValidity())));
  }
  const hintId = def.hint ? id + '-hint' : null;
  if (hintId) input.setAttribute('aria-describedby', hintId);
  if (def.required) input.setAttribute('aria-required', 'true');
  return el('div', { class: 'field' + (def.wide || def.type === 'textarea' ? ' wide' : '') },
    el('label', { htmlFor: id }, def.label, def.required ? el('span', { class: 'req', 'aria-hidden': 'true', text: '*' }) : null),
    input,
    def.hint ? el('span', { class: 'hint', id: hintId, text: def.hint }) : null,
  );
}

function renderSimple(sec) {
  const grid = el('div', { class: 'grid' });
  sec.fields.forEach((def) => grid.append(control(def, profile[def.key], (v) => { profile[def.key] = v; scheduleSave(); })));
  return grid;
}

function renderRepeat(sec) {
  const kind = sec.repeat;
  const cfg = REPEATS[kind];
  const wrap = el('div');
  const list = el('div');
  const draw = () => {
    list.replaceChildren();
    const items = profile[kind] || [];
    if (!items.length) list.append(el('div', { class: 'empty', text: `No ${cfg.noun}s added yet.` }));
    items.forEach((item, i) => {
      const node = $('#tpl-repeat-item').content.firstElementChild.cloneNode(true);
      node.querySelector('legend').textContent = (item.title || item.school || `${cfg.noun[0].toUpperCase() + cfg.noun.slice(1)} ${i + 1}`) + (item.company ? ` · ${item.company}` : '') + (item.degree ? ` · ${item.degree}` : '');
      const grid = node.querySelector('.grid');
      cfg.fields.forEach((def) =>
        grid.append(control(def, item[def.key], (v) => {
          item[def.key] = v;
          scheduleSave();
          if (/title|company|school|degree/.test(def.key)) node.querySelector('legend').textContent =
            (item.title || item.school || `${cfg.noun} ${i + 1}`) + (item.company ? ` · ${item.company}` : '') + (item.degree ? ` · ${item.degree}` : '');
        }, `${kind}${i}-`)),
      );
      const up = node.querySelector('[data-act="up"]');
      up.disabled = i === 0;
      up.setAttribute('aria-label', `Move ${cfg.noun} ${i + 1} up`);
      up.addEventListener('click', () => { items.splice(i - 1, 0, items.splice(i, 1)[0]); scheduleSave(); draw(); });
      const rm = node.querySelector('[data-act="remove"]');
      rm.setAttribute('aria-label', `Remove ${cfg.noun} ${i + 1}`);
      rm.addEventListener('click', () => { items.splice(i, 1); scheduleSave(); draw(); toast(`Removed ${cfg.noun}`); });
      list.append(node);
    });
    updateNavCounts();
  };
  draw();
  wrap.append(list, el('button', {
    type: 'button', class: 'btn', text: `+ Add ${cfg.noun}`,
    onclick: () => {
      profile[kind] = profile[kind] || [];
      profile[kind].push({});
      scheduleSave();
      draw();
      list.lastElementChild?.querySelector('input')?.focus();
    },
  }));
  return wrap;
}

