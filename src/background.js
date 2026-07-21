/**
 * Service worker.
 *
 * Two jobs:
 *  - keep the toolbar badge showing how many favourites are saved;
 *  - enrich favourites from Scalemates, one at a time, politely.
 *
 * The queue is deliberately conservative: a single favourite is looked up at
 * most twice ever (two query formulations), results — including "no match" —
 * are permanent, requests run serially with a multi-second gap, and any
 * 403/429 pauses everything for an hour. The expected volume is a couple of
 * kits a month, so none of this should ever be felt by the other side.
 */
importScripts('storage.js', 'scalemates.js');

/* --------------------------------------------------------------- badge */

async function refreshBadge() {
  try {
    const total = await KKFav.count();
    await chrome.action.setBadgeText({ text: total ? String(total) : '' });
    await chrome.action.setBadgeBackgroundColor({ color: '#e11d48' });
    if (chrome.action.setBadgeTextColor) {
      await chrome.action.setBadgeTextColor({ color: '#ffffff' });
    }
    await chrome.action.setTitle({
      title: total ? `KingKit Favourites — ${total} saved` : 'KingKit Favourites'
    });
  } catch (err) {
    console.warn('[KingKit Favourites] badge update failed:', err);
  }
}

/* ---------------------------------------------------- scalemates queue */

const PAUSE_KEY = 'kkf.sm.pausedUntil';
let draining = false;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pausedUntil() {
  try {
    return (await chrome.storage.local.get(PAUSE_KEY))[PAUSE_KEY] || 0;
  } catch (err) {
    return 0;
  }
}

async function drainQueue() {
  if (draining) return;
  draining = true;
  try {
    const settings = await KKFav.getSettings();
    if (settings.scalemates === false) return;
    if (Date.now() < await pausedUntil()) return;

    // Loop rather than recurse: each pass re-reads storage, so favourites
    // added or removed mid-drain are picked up naturally.
    for (;;) {
      const pending = (await KKFav.list()).filter(KKSM.needsLookup);
      if (!pending.length) return;

      const fav = pending[0];
      const sm = await KKSM.lookup(fav, (url) => fetch(url, { credentials: 'omit' }), sleep);

      // The favourite may have been removed while we were fetching.
      if (await KKFav.has(fav.id)) {
        await KKFav.update(fav.id, { sm });
      }

      if (sm.pauseQueue) {
        // Asked to slow down — stop for an hour.
        await chrome.storage.local.set({ [PAUSE_KEY]: Date.now() + 60 * 60 * 1000 });
        console.warn('[KingKit Favourites] Scalemates throttled us; pausing lookups for an hour.');
        return;
      }
      await sleep(KKSM.GAP_MS);
    }
  } finally {
    draining = false;
  }
}

/* ------------------------------------------------------- manual linking */

// The manager sends a pasted kit URL; fetch that one page (kit pages are
// fine to fetch — only search is rationed) and extract the details.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'kkf:linkScalemates') return undefined;
  (async () => {
    try {
      const url = new URL(msg.url);
      if (!/(^|\.)scalemates\.com$/.test(url.hostname) || !/^\/kits\//.test(url.pathname)) {
        sendResponse({ ok: false, error: 'Not a Scalemates kit URL' });
        return;
      }
      const res = await fetch(url.href, { credentials: 'omit' });
      if (!res.ok) {
        sendResponse({ ok: false, error: 'HTTP ' + res.status });
        return;
      }
      const cand = KKSM.parseKitPage(await res.text(), url.href);
      const sm = Object.assign({ status: 'matched', at: Date.now(), manual: true }, cand);
      delete sm.topic;
      await KKFav.update(msg.id, { sm });
      sendResponse({ ok: true, sm });
    } catch (err) {
      sendResponse({ ok: false, error: String(err && err.message || err) });
    }
  })();
  return true; // async sendResponse
});

/* --------------------------------------------------------------- wiring */

chrome.runtime.onInstalled.addListener(() => { refreshBadge(); drainQueue(); });
chrome.runtime.onStartup.addListener(() => { refreshBadge(); drainQueue(); });
KKFav.onChange(() => { refreshBadge(); drainQueue(); });

// Fallback rescan so an interrupted drain (worker shutdown mid-queue)
// resumes without waiting for the next favourite to be added.
chrome.alarms.create('kkf-sm-rescan', { periodInMinutes: 5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'kkf-sm-rescan') drainQueue();
});

refreshBadge();
drainQueue();
