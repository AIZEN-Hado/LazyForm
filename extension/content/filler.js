/*
 * LazyForm fill engine.
 * Injected on demand (popup / shortcut) or by the optional auto-detect script.
 * Finds form controls, works out what each one is asking for, and fills it
 * from the profile saved in chrome.storage.local. It never submits a form.
 */
(() => {
  if (window.__lazyForm) return;

  const UI_ATTR = 'data-lazyform-ui';
  const MARK_ATTR = 'data-lazyform';

  // ---------------------------------------------------------------------------
  // Text helpers
  // ---------------------------------------------------------------------------
  const norm = (s) =>
    String(s || '')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[_\-\[\]\.\/\\:()]+/g, ' ')
      .replace(/[*?]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

  const clip = (s, n = 160) => {
    s = String(s || '').replace(/\s+/g, ' ').trim();
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  };

  const STOP = new Set(
    'the a an of to and or for in on at is are be you your yours do does did have has with this that what which please if any as by from we our us will would can could select choose enter provide'.split(' ')
  );
  const tokens = (s) =>
    norm(s)
      .split(' ')
      .filter((w) => w.length > 1 && !STOP.has(w))
      .map((w) => w.replace(/(ing|ed|es|s)$/, ''));

