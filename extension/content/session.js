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

  // --------------------------------------------------------------- banner (top frame only)
  // Closed shadow root + isTrusted checks: page scripts can't read or press these buttons.
  function trusted(fn) {
    return (e) => { if (e.isTrusted) fn(e); };
  }

  function renderBanner() {
    if (!isTop) return;
    if (!banner) {
      const host = document.createElement('div');
      host.setAttribute('data-lazyform-ui', '');
      host.style.cssText = 'position:fixed;z-index:2147483647;left:16px;bottom:16px;';
      const root = host.attachShadow({ mode: 'closed' });
      root.innerHTML = `
        <style>
          :host{all:initial}
          .bar{display:flex;align-items:center;gap:12px;font:500 13px/1.35 Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;letter-spacing:-.005em;
            background:#0a0a0a;color:#fafafa;border-radius:999px;padding:6px 6px 6px 8px;box-shadow:0 20px 44px -16px rgba(0,0,0,.45);max-width:calc(100vw - 32px)}
          .dot{width:28px;height:28px;border-radius:50%;flex:none;
            background:radial-gradient(circle at 30% 28%,#ffd3a8 0 18%,transparent 46%),radial-gradient(circle at 72% 30%,#b9c6ff 0 20%,transparent 52%),radial-gradient(circle at 46% 78%,#ffb4d6 0 22%,transparent 56%),radial-gradient(circle,#9fe3ff,#c7b8ff 70%);
            animation:breathe 2.6s ease-in-out infinite}
          .dot.wait{animation:none;filter:grayscale(.85)}
          @keyframes breathe{0%,100%{transform:scale(1)}50%{transform:scale(1.1)}}
          @media (prefers-reduced-motion: reduce){.dot{animation:none}}
          .txt{min-width:0;padding-right:4px}
          .txt b{font-weight:600}
          .sub{display:block;color:#a3a3a3;font-size:12px}
          button{font:500 12.5px/1 Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;cursor:pointer;border-radius:999px;padding:9px 14px;border:0;background:#262626;color:#fafafa;white-space:nowrap}
          button:hover{background:#333}
          button:focus-visible{outline:2px solid #8ea2ff;outline-offset:2px}
          .go{background:#fafafa;color:#0a0a0a}
          .go:hover{background:#e5e5e5}
          .acts{display:flex;gap:6px;flex:none}
          [hidden]{display:none!important}
          @media (prefers-color-scheme: dark){.bar{background:#fafafa;color:#0a0a0a}.sub{color:#555}
            button{background:#ebebeb;color:#0a0a0a}button:hover{background:#dcdcdc}.go{background:#0a0a0a;color:#fafafa}.go:hover{background:#262626}}
        </style>
        <div class="bar" role="region" aria-label="LazyForm auto-apply mode">
          <span class="dot" aria-hidden="true"></span>
          <span class="txt" aria-live="polite"><b class="t1"></b><span class="sub t2"></span></span>
          <span class="acts">
            <button class="go" type="button" hidden>Fill on this site</button>
            <button class="review" type="button" hidden>Review</button>
            <button class="stop" type="button">Stop</button>
          </span>
        </div>`;
      root.querySelector('.stop').addEventListener('click', trusted(() => { send({ type: 'session:stop' }); stopLocal(); }));
      root.querySelector('.review').addEventListener('click', trusted(() => window.__lazyForm?.showPanel()));
      root.querySelector('.go').addEventListener('click', trusted(() => send({ type: 'session:allowSite' })));
      (document.body || document.documentElement).appendChild(host);
      banner = { host, root };
    }
    const { root } = banner;
    const allowed = siteAllowed();
    root.querySelector('.dot').classList.toggle('wait', !allowed);
    root.querySelector('.go').hidden = allowed;
    root.querySelector('.review').hidden = !allowed || !totals.needs;
    root.querySelector('.t1').textContent = allowed ? 'Auto-apply is on' : `Auto-apply paused on ${location.hostname}`;
    root.querySelector('.t2').textContent = allowed
      ? `${totals.filled} filled${totals.needs ? ` · ${totals.needs} need you` : ''} · nothing is submitted`
      : 'New site — fill here too?';
  }

