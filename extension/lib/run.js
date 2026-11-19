// Shared by the popup and the background worker.

const FILES = ['content/filler.js'];

export class RestrictedPageError extends Error {}

export const SITE_ORIGINS = ['https://*/*', 'http://*/*'];

async function inject(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: FILES });
  } catch {
    // allFrames can fail on a single restricted frame; retry the top frame only
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: FILES });
    } catch (e) {
      throw new RestrictedPageError(e.message || String(e));
    }
  }
}

async function runInFrames(tabId, fnName) {
  const exec = (allFrames) =>
    chrome.scripting.executeScript({
      target: { tabId, allFrames },
      func: (name) => (window.__lazyForm ? window.__lazyForm[name]() : null),
      args: [fnName],
    });
  let res;
  try { res = await exec(true); } catch { res = await exec(false); }
  return res.map((r) => r.result).filter(Boolean);
}

export async function fillTab(tabId) {
  await inject(tabId);
  const frames = await runInFrames(tabId, 'fill');
  return {
    busy: frames.length > 0 && frames.every((f) => f.busy),
    fieldCount: frames.reduce((n, f) => n + (f.fieldCount || 0), 0),
    filled: frames.flatMap((f) => f.filled || []),
    skipped: frames.flatMap((f) => f.skipped || []),
  };
}

export async function scanTab(tabId) {
  await inject(tabId);
  const frames = await runInFrames(tabId, 'scan');
  return {
    fields: frames.reduce((n, f) => n + f.fields, 0),
    recognised: frames.reduce((n, f) => n + f.recognised, 0),
  };
}

export async function captureTab(tabId) {
  await inject(tabId);
  const frames = await runInFrames(tabId, 'capture');
  const seen = new Set();
  return frames.flat().filter((q) => {
    const k = q.question.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
