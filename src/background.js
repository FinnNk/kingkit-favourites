/**
 * Service worker: keeps the toolbar badge showing how many favourites are
 * saved. It has no other job — all reads and writes happen directly in the
 * content script and manager page against chrome.storage.
 */
importScripts('storage.js');

async function refreshBadge() {
  try {
    const total = await KKFav.count();
    await chrome.action.setBadgeText({ text: total ? String(total) : '' });
    await chrome.action.setBadgeBackgroundColor({ color: '#e11d48' });
    if (chrome.action.setBadgeTextColor) {
      await chrome.action.setBadgeTextColor({ color: '#ffffff' });
    }
    await chrome.action.setTitle({
      title: total
        ? `KingKit Favourites — ${total} saved`
        : 'KingKit Favourites'
    });
  } catch (err) {
    console.warn('[KingKit Favourites] badge update failed:', err);
  }
}

chrome.runtime.onInstalled.addListener(refreshBadge);
chrome.runtime.onStartup.addListener(refreshBadge);
KKFav.onChange(refreshBadge);

// The worker can be respawned by any event; make sure the badge is correct.
refreshBadge();
