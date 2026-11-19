/*
 * Auto-apply mode (page side). Injected by the background worker only into the
 * tab where the user switched the mode on. Keeps filling new fields as steps,
 * sections and pages appear, until the user presses Stop.
 */
(() => {
  if (window.__lazyFormSession) return;

  const isTop = window.top === window;
  let cfg = null;
  let active = false;
  let observer = null;
  let timer = null;
  let lastRun = 0;
  let totals = { filled: 0, needs: 0 };
  let banner = null; // { host, root }

  const ATTR_FILTER = ['class', 'style', 'hidden', 'aria-hidden', 'disabled', 'open'];

  function siteAllowed() {
    if (!cfg) return false;
    const host = location.hostname;
    return cfg.origins.includes(location.origin) || cfg.ats.some((d) => host === d || host.endsWith('.' + d));
  }

  function send(msg) {
    try { chrome.runtime.sendMessage(msg).catch(() => {}); } catch { /* extension reloaded */ }
  }

  // --------------------------------------------------------------- filling
  async function run() {
    timer = null;
    if (!active || !window.__lazyForm) return;
    const since = Date.now() - lastRun;
    if (since < 1200) { timer = setTimeout(run, 1200 - since); return; }
    lastRun = Date.now();
    const res = await window.__lazyForm.fill({ onlyNew: true, silent: true });
    if (res.busy) { schedule(); return; }
    send({ type: 'session:filled', filled: res.filled.length, needs: res.pageNeeds || 0 });
  }

  function schedule() {
    if (!active || timer) return;
    timer = setTimeout(run, 700);
  }

  function observe() {
    if (observer) return;
    observer = new MutationObserver((records) => {
      for (const r of records) {
        const t = r.target.nodeType === 1 ? r.target : r.target.parentElement;
        if (t && t.closest && t.closest('[data-lazyform-ui]')) continue;
        schedule();
        return;
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ATTR_FILTER });
  }

  function stopLocal() {
    active = false;
    observer?.disconnect();
    observer = null;
    clearTimeout(timer);
    timer = null;
    banner?.host.remove();
    banner = null;
  }

