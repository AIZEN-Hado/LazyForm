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

function renderQA() {
  const wrap = el('div');
  const list = el('div');
  const draw = () => {
    list.replaceChildren();
    const items = (profile.customQA = profile.customQA || []);
    if (!items.length) {
      list.append(el('div', { class: 'empty' },
        'Nothing saved yet. Add answers for questions like “Why do you want to work here?”, or after filling a form, use ',
        el('strong', { text: 'Save my new answers' }), ' in the LazyForm popup.'));
    } else {
      list.append(el('div', { class: 'qa-head', 'aria-hidden': 'true' }, el('span', { text: 'Question' }), el('span', { text: 'Your answer' }), el('span')));
    }
    items.forEach((item, i) => {
      const q = el('textarea', { rows: 1, placeholder: 'Question wording', 'aria-label': `Question ${i + 1}` });
      q.value = item.question || '';
      q.addEventListener('input', () => { item.question = q.value; scheduleSave(); });
      const a = el('textarea', { rows: 2, placeholder: 'Your answer', 'aria-label': `Answer ${i + 1}` });
      a.value = item.answer || '';
      a.addEventListener('input', () => { item.answer = a.value; scheduleSave(); });
      const rm = el('button', { type: 'button', class: 'btn ghost small danger', text: 'Remove', 'aria-label': `Remove answer ${i + 1}`,
        onclick: () => { items.splice(i, 1); scheduleSave(); draw(); } });
      list.append(el('div', { class: 'qa-row' }, q, a, rm));
    });
    updateNavCounts();
  };
  draw();
  renderQA.redraw = draw;
  wrap.append(list, el('button', { type: 'button', class: 'btn', text: '+ Add answer', onclick: () => {
    profile.customQA.push({ question: '', answer: '' }); scheduleSave(); draw();
    list.lastElementChild?.querySelector('textarea')?.focus();
  } }));
  return wrap;
}

function fmtSize(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }

function renderResume() {
  const wrap = el('div');
  const file = el('input', { type: 'file', accept: '.pdf,.doc,.docx,.rtf,.txt,.odt', hidden: true, id: 'resume-file' });
  const draw = () => {
    wrap.querySelector('.drop')?.remove();
    const ext = resume ? (resume.name.split('.').pop() || '').toUpperCase().slice(0, 4) : '';
    const drop = el('div', { class: 'drop' },
      el('div', { class: 'file-ico', 'aria-hidden': 'true', text: resume ? ext : '+' }),
      el('div', { class: 'meta' },
        el('div', { class: 'name', text: resume ? resume.name : 'No resume yet' }),
        el('div', { class: 'sub', text: resume ? `${fmtSize(resume.size)} · added ${new Date(resume.added).toLocaleDateString()}` : 'PDF or Word, up to 5 MB. Drop it here or choose a file.' })),
      el('div', { class: 'acts' },
        el('button', { type: 'button', class: 'btn', text: resume ? 'Replace' : 'Choose file', onclick: () => file.click() }),
        resume ? el('button', { type: 'button', class: 'btn ghost danger', text: 'Remove', onclick: async () => {
          resume = null; await chrome.storage.local.remove('resume'); draw(); updateMeter(); toast('Resume removed');
        } }) : null));
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) take(e.dataTransfer.files[0]); });
    wrap.prepend(drop);
  };
  const take = (f) => {
    if (f.size > MAX_RESUME) return toast('That file is over 5 MB — please use a smaller PDF.');
    const reader = new FileReader();
    reader.onload = async () => {
      resume = { name: f.name, type: f.type || 'application/octet-stream', size: f.size, dataUrl: reader.result, added: Date.now() };
      try { await chrome.storage.local.set({ resume }); draw(); updateMeter(); toast('Resume saved'); }
      catch (e) { toast('Couldn’t store that file: ' + e.message); }
    };
    reader.readAsDataURL(f);
  };
  file.addEventListener('change', () => file.files[0] && take(file.files[0]));
  wrap.append(file);
  draw();
  return wrap;
}

function toggle(id, label, desc, checked, onChange) {
  const input = el('input', { type: 'checkbox', id, checked, 'aria-describedby': id + '-d' });
  input.addEventListener('change', () => onChange(input.checked, input));
  return el('div', { class: 'toggle' }, input, el('div', {}, el('label', { htmlFor: id, text: label }), el('p', { id: id + '-d', text: desc })));
}

function renderSettings() {
  const wrap = el('div');
  wrap.append(
    toggle('s-auto', 'Allow auto-apply mode', 'Auto-apply mode keeps filling as an application moves through its steps and pages, so Chrome needs to let LazyForm work on the job sites you open. It only ever runs in the tab where you switch it on, and stops when you press Stop or close the tab.', renderSettings.granted,
      async (on, input) => {
        if (on) {
          const ok = await chrome.permissions.request({ origins: SITE_ORIGINS });
          if (!ok) { input.checked = false; toast('Permission not granted — “Fill this page” still works.'); return; }
          toast('Auto-apply mode allowed');
        } else {
          await chrome.permissions.remove({ origins: SITE_ORIGINS }).catch(() => {});
          toast('Auto-apply mode turned off everywhere');
        }
      }),
    toggle('s-over', 'Replace answers already on the form', 'Off by default, so LazyForm never overwrites something you or the site already filled in.', settings.overwrite,
      (on) => { settings.overwrite = on; scheduleSave(); }),
    toggle('s-hl', 'Highlight filled fields', 'Green outline for filled fields, dashed amber for ones you should check.', settings.highlight,
      (on) => { settings.highlight = on; scheduleSave(); }),
    toggle('s-panel', 'Show a summary on the page after filling', 'Lists the questions left for you, with a jump-to link for each.', settings.showPanel,
      (on) => { settings.showPanel = on; scheduleSave(); }),
  );
  const df = el('select', { id: 's-date', 'aria-describedby': 's-date-d' });
  [['auto', 'Automatic (from your browser language)'], ['DD/MM/YYYY', 'DD/MM/YYYY — e.g. 01/12/2026 for 1 December'], ['MM/DD/YYYY', 'MM/DD/YYYY — e.g. 12/01/2026 for 1 December']]
    .forEach(([v, t]) => df.append(el('option', { value: v, text: t })));
  df.value = settings.dateFormat || 'auto';
  df.addEventListener('change', () => { settings.dateFormat = df.value; scheduleSave(); });
  wrap.append(el('div', { class: 'field', style: 'margin-top:14px' },
    el('label', { htmlFor: 's-date', text: 'Date format for plain text date boxes' }), df,
    el('span', { class: 'hint', id: 's-date-d', text: 'Used only when a form doesn’t show which format it wants. Date pickers are always filled correctly.' })));
  wrap.append(el('h3', { class: 'sub-h', text: 'Keyboard shortcuts' }),
    el('p', { class: 'blurb' }, 'Fill this page: ', el('kbd', { id: 'kbd2', text: 'Alt+Shift+F' }), ' · Auto-apply on/off: ', el('kbd', { id: 'kbd3', text: 'Alt+Shift+Y' }), '. ',
      el('button', { type: 'button', class: 'btn ghost small', text: 'Change shortcut', onclick: () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }) })));

  const importInput = el('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  importInput.addEventListener('change', async () => {
    const f = importInput.files[0];
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!data || typeof data !== 'object' || !data.profile) throw new Error('Not an LazyForm backup');
      profile = data.profile;
      const { autoDetect, ...imported } = data.settings || {};
      settings = { ...DEFAULT_SETTINGS, ...imported };
      if (!['auto', 'DD/MM/YYYY', 'MM/DD/YYYY'].includes(settings.dateFormat)) settings.dateFormat = 'auto';
      resume = data.resume && typeof data.resume.dataUrl === 'string' && data.resume.dataUrl.startsWith('data:') ? data.resume : resume;
      await chrome.storage.local.set({ profile, settings, ...(resume ? { resume } : {}) });
      render();
      toast('Backup imported');
    } catch (e) { toast('Couldn’t import: ' + e.message); }
    importInput.value = '';
  });

  wrap.append(el('div', { class: 'row-actions' },
    el('button', { type: 'button', class: 'btn', text: 'Export backup', onclick: () => {
      const blob = new Blob([JSON.stringify({ app: 'LazyForm', version: 1, profile, settings, resume }, null, 2)], { type: 'application/json' });
      const a = el('a', { href: URL.createObjectURL(blob), download: 'lazyform-profile.json' });
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } }),
    el('button', { type: 'button', class: 'btn', text: 'Import backup', onclick: () => importInput.click() }),
    importInput,
    el('button', { type: 'button', class: 'btn ghost danger', text: 'Delete all my data', onclick: async () => {
      if (!confirm('Delete your whole LazyForm profile, resume and saved answers from this browser? This can’t be undone.')) return;
      await chrome.storage.local.clear();
      profile = {}; settings = { ...DEFAULT_SETTINGS }; resume = null;
      render(); toast('All data deleted');
    } }),
  ));
  return wrap;
}

