/**
 * Service worker.
 *
 * Three jobs:
 *  - keep the toolbar badge showing how many favourites are saved (or, when
 *    there are unseen price/stock alerts, how many of those);
 *  - enrich favourites from Scalemates, one at a time, politely;
 *  - re-check each favourite's KingKit product page roughly daily for price
 *    and stock movement, recording alerts for the manager.
 *
 * Both queues are deliberately conservative: requests run serially with a
 * multi-second gap, results are cached or capped, and any 403/429 pauses
 * everything for an hour. The expected volume is a couple of kits a month,
 * so none of this should ever be felt by the other side.
 */
importScripts('storage.js', 'scalemates.js', 'watch.js');

/* --------------------------------------------------------------- badge */

async function refreshBadge() {
  try {
    const favs = await KKFav.list();
    const total = favs.length;
    let unseen = 0;
    favs.forEach((fav) => {
      if (fav.watch && Array.isArray(fav.watch.alerts)) {
        unseen += fav.watch.alerts.filter((a) => !a.seen).length;
      }
    });

    if (unseen > 0) {
      // Unseen price/stock alerts outrank the plain count — blue, not red.
      await chrome.action.setBadgeText({ text: String(unseen) });
      await chrome.action.setBadgeBackgroundColor({ color: '#2563eb' });
    } else {
      await chrome.action.setBadgeText({ text: total ? String(total) : '' });
      await chrome.action.setBadgeBackgroundColor({ color: '#e11d48' });
    }
    if (chrome.action.setBadgeTextColor) {
      await chrome.action.setBadgeTextColor({ color: '#ffffff' });
    }
    await chrome.action.setTitle({
      title: unseen > 0
        ? `KingKit Favourites — ${unseen} unseen ${unseen === 1 ? 'alert' : 'alerts'}, ${total} saved`
        : (total ? `KingKit Favourites — ${total} saved` : 'KingKit Favourites')
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

/* -------------------------------------------------- price & stock watch */

const WATCH_PAUSE_KEY = 'kkf.watch.pausedUntil';
let watchDraining = false;

async function watchPausedUntil() {
  try {
    return (await chrome.storage.local.get(WATCH_PAUSE_KEY))[WATCH_PAUSE_KEY] || 0;
  } catch (err) {
    return 0;
  }
}

/**
 * Re-check due favourites, serially and politely. Deliberately NOT wired to
 * storage changes — a fresh favourite carries the prices just scraped by the
 * content script, so it needs nothing for another 20 hours; the hourly alarm
 * is plenty. (Every check we store bumps the favourite's watch record, which
 * fires KKFav.onChange → refreshBadge + drainQueue; drainQueue no-ops fast,
 * and drainWatch is kept off that listener so it cannot feed itself.)
 */
async function drainWatch() {
  if (watchDraining) return;
  watchDraining = true;
  try {
    const settings = await KKFav.getSettings();
    if (settings.watch === false) return;
    if (Date.now() < await watchPausedUntil()) return;

    // Loop rather than recurse: each pass re-reads storage, so favourites
    // added or removed mid-drain are picked up naturally. The stored triedAt
    // stamp stops a just-checked favourite reappearing as due.
    for (let done = 0; done < KKWatch.MAX_PER_DRAIN; done += 1) {
      const now = Date.now();
      const due = (await KKFav.list()).filter((fav) => KKWatch.needsCheck(fav, now));
      if (!due.length) return;

      const fav = due[0];
      const result = await KKWatch.check(fav, (url) => fetch(url, { credentials: 'omit' }));

      // Re-read AFTER the fetch: the user may have removed the favourite, or
      // marked alerts seen, while the network was in flight. Seen flags from
      // the fresh copy are carried onto matching alerts so a wholesale write
      // of the pre-fetch snapshot cannot silently un-read them.
      const fresh = await KKFav.get(fav.id);
      if (fresh) {
        const freshAlerts = (fresh.watch && fresh.watch.alerts) || [];
        const seenKeys = new Set(freshAlerts
          .filter((a) => a.seen)
          .map((a) => a.at + '|' + a.kind + '|' + (a.label || '')));
        result.watch.alerts = result.watch.alerts.map((a) =>
          seenKeys.has(a.at + '|' + a.kind + '|' + (a.label || ''))
            ? Object.assign({}, a, { seen: true })
            : a);
        const patch = { watch: result.watch };
        if (result.prices) patch.prices = result.prices;
        await KKFav.update(fav.id, patch);
      }

      if (result.pauseWatch) {
        // Asked to slow down — stop for an hour.
        await chrome.storage.local.set({ [WATCH_PAUSE_KEY]: Date.now() + 60 * 60 * 1000 });
        console.warn('[KingKit Favourites] KingKit throttled us; pausing price checks for an hour.');
        return;
      }
      await sleep(KKWatch.GAP_MS);
    }
  } finally {
    watchDraining = false;
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

chrome.runtime.onInstalled.addListener(() => { refreshBadge(); drainQueue(); drainWatch(); });
chrome.runtime.onStartup.addListener(() => { refreshBadge(); drainQueue(); drainWatch(); });
KKFav.onChange(() => { refreshBadge(); drainQueue(); });

// Fallback rescan so an interrupted drain (worker shutdown mid-queue)
// resumes without waiting for the next favourite to be added.
chrome.alarms.create('kkf-sm-rescan', { periodInMinutes: 5 });
// Price & stock checks ride their own hourly alarm; the 20-hour interval in
// KKWatch.needsCheck decides which favourites are actually due.
chrome.alarms.create('kkf-watch', { periodInMinutes: 60 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'kkf-sm-rescan') drainQueue();
  if (alarm.name === 'kkf-watch') drainWatch();
});

refreshBadge();
drainQueue();
drainWatch();
