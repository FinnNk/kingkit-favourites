/**
 * Shared favourites store.
 *
 * Loaded as a classic script in three places — the content script, the service
 * worker (via importScripts) and the manager page — so it exports itself onto
 * the global object rather than using ES modules (content scripts cannot be
 * modules).
 *
 * Records are sharded one-per-key ("kkf:<id>") rather than kept in a single
 * blob. chrome.storage.sync caps a single item at 8 KB, which would limit a
 * blob to roughly 25 favourites; sharding lifts that to the account-wide
 * 100 KB / 512-item quota instead.
 *
 * Reads always merge sync + local so nothing a user saved can become invisible
 * after a storage-area switch or a quota fallback. Writes go to the preferred
 * area, falling back to local when sync refuses them.
 */
(function (global) {
  'use strict';

  var KEY_PREFIX = 'kkf:';
  var SETTINGS_KEY = 'kkf.settings';
  var VOCAB_KEY = 'kkf.vocab';
  var SCHEMA = 2;

  // The manufacturer and category lists change rarely; re-harvest fortnightly.
  var VOCAB_TTL = 14 * 24 * 60 * 60 * 1000;

  var DEFAULT_SETTINGS = {
    area: 'sync',        // preferred write target: 'sync' | 'local'
    syncFallback: false, // set when a sync write was rejected and spilled to local
    view: 'grid',        // manager layout: 'grid' | 'list'
    sort: 'added-desc',
    scalemates: true,    // background Scalemates lookups on/off
    watch: true          // daily price & stock re-checks on/off
  };

  function area(name) {
    return chrome.storage[name === 'sync' ? 'sync' : 'local'];
  }

  async function readArea(name) {
    try {
      return (await area(name).get(null)) || {};
    } catch (err) {
      // A disabled or unavailable sync area must never break the local one.
      console.warn('[KingKit Favourites] could not read', name, 'storage:', err);
      return {};
    }
  }

  /** Normalise a product URL into a stable id (its path, lower-cased). */
  function idFromUrl(href, base) {
    try {
      var u = new URL(href, base || (global.location ? global.location.href : undefined));
      return u.pathname.replace(/\/+$/, '').toLowerCase();
    } catch (err) {
      return String(href || '').trim().toLowerCase() || null;
    }
  }

  async function getSettings() {
    var stored = {};
    try {
      stored = (await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY] || {};
    } catch (err) {
      /* fall through to defaults */
    }
    return Object.assign({}, DEFAULT_SETTINGS, stored);
  }

  async function setSettings(patch) {
    var next = Object.assign({}, await getSettings(), patch);
    await chrome.storage.local.set({ [SETTINGS_KEY]: next });
    return next;
  }

  /* ------------------------------------------------------- site vocabulary */

  /**
   * KingKit's own manufacturer and category lists, harvested from the Kit
   * Finder form by the content script. Kept in local storage (never sync — the
   * manufacturer list alone is ~40 KB) and used to work out which brand a kit
   * belongs to from its title.
   */
  async function getVocab() {
    try {
      return (await chrome.storage.local.get(VOCAB_KEY))[VOCAB_KEY] || null;
    } catch (err) {
      return null;
    }
  }

  async function setVocab(vocab) {
    await chrome.storage.local.set({
      [VOCAB_KEY]: {
        brands: vocab.brands || [],
        categories: vocab.categories || [],
        brandIds: vocab.brandIds || {},     // lowercased name -> Kit Finder id
        categoryIds: vocab.categoryIds || {},
        fetchedAt: Date.now()
      }
    });
  }

  function vocabIsStale(vocab) {
    if (!vocab || !vocab.brands || !vocab.brands.length) return true;
    // Pre-deep-link vocabularies lack the id maps; refresh them promptly.
    if (!vocab.brandIds || !Object.keys(vocab.brandIds).length) return true;
    return (Date.now() - (vocab.fetchedAt || 0)) > VOCAB_TTL;
  }

  /* ------------------------------------------------------------- facets */

  /** "1/48 Scale", "SPECIAL HOBBY 1/48 SH48206 ..." -> "1/48" */
  function parseScale(value) {
    var match = String(value == null ? '' : value).match(/\b1\s*[\/:]\s*(\d+(?:\.\d+)?)\b/);
    return match ? '1/' + match[1] : '';
  }

  /**
   * Titles begin with the manufacturer, so the brand is the longest entry in
   * the site's own list that prefixes the title — longest wins so that
   * "Special Hobby" is not truncated to "Special".
   */
  function matchBrand(title, brands) {
    if (!title || !brands || !brands.length) return '';
    var lower = title.toLowerCase();
    var best = '';
    for (var i = 0; i < brands.length; i += 1) {
      var brand = brands[i];
      if (brand.length > best.length && lower.indexOf(brand.toLowerCase() + ' ') === 0) {
        best = brand;
      }
    }
    return best;
  }

  function firstWord(title) {
    var match = String(title == null ? '' : title).trim().match(/^[A-Za-z][A-Za-z'&.-]+/);
    if (!match) return '';
    var word = match[0];
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  }

  /**
   * Work out {brand, scale, category} for a favourite. Values captured at save
   * time win; anything missing is derived from the title, so records saved
   * before this feature existed are still filterable.
   */
  function facetsFor(fav, vocab) {
    var categories = (vocab && vocab.categories) || [];
    var category = fav.category || '';
    // v1 records reused `details` for the scale (tiles) or category (product
    // pages), so only treat it as a category when the site recognises it.
    if (!category && fav.details && categories.indexOf(fav.details) !== -1) {
      category = fav.details;
    }
    return {
      brand: fav.brand || matchBrand(fav.title, (vocab && vocab.brands) || []) || firstWord(fav.title),
      scale: fav.scale || parseScale(fav.details) || parseScale(fav.title),
      category: category
    };
  }

  /** Every favourite, newest first, merged across both storage areas. */
  async function list() {
    var areas = await Promise.all([readArea('local'), readArea('sync')]);
    var byId = new Map();

    areas.forEach(function (bag) {
      Object.keys(bag).forEach(function (key) {
        if (key.indexOf(KEY_PREFIX) !== 0) return;
        var rec = bag[key];
        if (!rec || typeof rec !== 'object') return;
        var id = rec.id || key.slice(KEY_PREFIX.length);
        var prev = byId.get(id);
        // Strictly newer wins; on an addedAt tie the FIRST-scanned copy
        // (local) survives, matching get() — local is where quota-fallback
        // writes land, so ties must not resurrect a stale sync copy.
        if (!prev || (rec.addedAt || 0) > (prev.addedAt || 0)) {
          byId.set(id, Object.assign({}, rec, { id: id }));
        }
      });
    });

    return Array.from(byId.values()).sort(function (a, b) {
      return (b.addedAt || 0) - (a.addedAt || 0);
    });
  }

  /** Just the ids — cheaper than list() for painting button states. */
  async function ids() {
    var areas = await Promise.all([readArea('local'), readArea('sync')]);
    var set = new Set();
    areas.forEach(function (bag) {
      Object.keys(bag).forEach(function (key) {
        if (key.indexOf(KEY_PREFIX) === 0) set.add(key.slice(KEY_PREFIX.length));
      });
    });
    return set;
  }

  async function get(id) {
    if (!id) return null;
    var key = KEY_PREFIX + id;
    var local = await readArea('local');
    var sync = await readArea('sync');
    var a = local[key];
    var b = sync[key];
    if (a && b) return (a.addedAt || 0) >= (b.addedAt || 0) ? a : b;
    return a || b || null;
  }

  async function has(id) {
    return Boolean(await get(id));
  }

  async function add(fav) {
    var id = fav.id || idFromUrl(fav.url);
    if (!id) throw new Error('Cannot save a favourite without a product URL.');

    var record = Object.assign({ v: SCHEMA }, fav, {
      id: id,
      addedAt: fav.addedAt || Date.now()
    });
    var key = KEY_PREFIX + id;
    var settings = await getSettings();

    try {
      await area(settings.area).set({ [key]: record });
      // Keep exactly one copy: a leftover in the other area (e.g. from an
      // earlier quota fallback) would tie on addedAt and shadow future edits.
      await area(settings.area === 'sync' ? 'local' : 'sync').remove(key)
        .catch(function () {});
      if (settings.area === 'sync' && settings.syncFallback) {
        await setSettings({ syncFallback: false });
      }
    } catch (err) {
      if (settings.area !== 'sync') throw err;
      // Sync quota exhausted (or sync disabled) — keep the favourite locally,
      // and clear any stale sync copy so it cannot shadow the fresh record
      // (an addedAt tie between the two would otherwise be ambiguous).
      console.warn('[KingKit Favourites] sync write failed, saving locally:', err);
      await chrome.storage.local.set({ [key]: record });
      await chrome.storage.sync.remove(key).catch(function () {});
      await setSettings({ syncFallback: true });
    }
    return record;
  }

  /** Remove from both areas so a stale copy cannot resurrect the entry. */
  async function remove(id) {
    if (!id) return;
    var key = KEY_PREFIX + id;
    await Promise.all([
      chrome.storage.local.remove(key),
      chrome.storage.sync.remove(key).catch(function () {})
    ]);
  }

  async function toggle(fav) {
    var id = fav.id || idFromUrl(fav.url);
    var existing = await get(id);
    if (existing) {
      await remove(id);
      // Hand back the full record so an Undo can restore notes, status,
      // Scalemates data and watch history — not just the scrape payload.
      return { id: id, saved: false, removed: existing };
    }
    await add(fav);
    return { id: id, saved: true };
  }

  /** Patch fields (e.g. the user's note) on an existing favourite. */
  async function update(id, patch) {
    var existing = await get(id);
    if (!existing) return null;
    return add(Object.assign({}, existing, patch, { id: id, addedAt: existing.addedAt }));
  }

  /**
   * Mark every alert on a favourite read — against the alerts as stored RIGHT
   * NOW, not a UI snapshot: the watcher may have appended alerts since the
   * manager last rendered, and those must not be resurrected unseen->seen
   * races in either direction.
   */
  async function markAlertsSeen(id) {
    var existing = await get(id);
    if (!existing || !existing.watch || !Array.isArray(existing.watch.alerts)) return null;
    var watch = Object.assign({}, existing.watch, {
      alerts: existing.watch.alerts.map(function (a) {
        return Object.assign({}, a, { seen: true });
      })
    });
    return update(id, { watch: watch });
  }

  async function clear() {
    var areas = await Promise.all([readArea('local'), readArea('sync')]);
    var localKeys = Object.keys(areas[0]).filter(function (k) { return k.indexOf(KEY_PREFIX) === 0; });
    var syncKeys = Object.keys(areas[1]).filter(function (k) { return k.indexOf(KEY_PREFIX) === 0; });
    await Promise.all([
      localKeys.length ? chrome.storage.local.remove(localKeys) : null,
      syncKeys.length ? chrome.storage.sync.remove(syncKeys).catch(function () {}) : null
    ]);
  }

  async function count() {
    return (await ids()).size;
  }

  async function exportAll() {
    return {
      format: 'kingkit-favourites',
      version: SCHEMA,
      exportedAt: new Date().toISOString(),
      favourites: await list()
    };
  }

  /**
   * Import a previously exported file. `replace` wipes the current list first;
   * otherwise entries are merged, keeping whichever copy was added most
   * recently. Returns a per-record tally so the UI can report partial success.
   */
  async function importAll(payload, options) {
    var opts = options || {};
    var items = Array.isArray(payload) ? payload : (payload && payload.favourites);
    if (!Array.isArray(items)) throw new Error('That file does not contain a favourites list.');

    if (opts.replace) await clear();

    var added = 0;
    var skipped = 0;
    var failed = 0;

    for (var i = 0; i < items.length; i += 1) {
      var item = items[i];
      var id = item && (item.id || idFromUrl(item.url, 'https://www.kingkit.co.uk/'));
      if (!id || !item.url) { failed += 1; continue; }
      try {
        var existing = opts.replace ? null : await get(id);
        if (existing && (existing.addedAt || 0) >= (item.addedAt || 0)) { skipped += 1; continue; }
        await add(Object.assign({}, item, { id: id }));
        added += 1;
      } catch (err) {
        console.warn('[KingKit Favourites] import failed for', id, err);
        failed += 1;
      }
    }
    return { added: added, skipped: skipped, failed: failed, total: items.length };
  }

  /**
   * Move every favourite into `target` ('sync' | 'local') and make it the
   * preferred area. Writes land before the old copies are cleared, so an
   * interrupted move duplicates rather than loses records — and list() dedupes
   * across areas anyway.
   */
  async function migrate(target) {
    var to = target === 'sync' ? 'sync' : 'local';
    var from = to === 'sync' ? 'local' : 'sync';
    var items = await list();

    // Batched so one oversized set() cannot reject the whole move.
    for (var i = 0; i < items.length; i += 20) {
      var chunk = {};
      items.slice(i, i + 20).forEach(function (rec) { chunk[KEY_PREFIX + rec.id] = rec; });
      await area(to).set(chunk);
    }

    var stale = Object.keys(await readArea(from)).filter(function (k) {
      return k.indexOf(KEY_PREFIX) === 0;
    });
    if (stale.length) {
      await area(from).remove(stale).catch(function () {});
    }

    await setSettings({ area: to, syncFallback: false });
    return items.length;
  }

  /** Approximate bytes used, per area, for the storage meter in the manager. */
  async function usage() {
    async function bytes(name) {
      try {
        var used = await area(name).getBytesInUse(null);
        return { used: used, quota: area(name).QUOTA_BYTES || 0 };
      } catch (err) {
        return { used: 0, quota: 0, unavailable: true };
      }
    }
    var result = await Promise.all([bytes('sync'), bytes('local')]);
    return { sync: result[0], local: result[1] };
  }

  /** Fires whenever the favourites set changes in any area or any tab. */
  function onChange(callback) {
    var handler = function (changes) {
      var touched = Object.keys(changes).some(function (k) { return k.indexOf(KEY_PREFIX) === 0; });
      if (touched) callback(changes);
    };
    chrome.storage.onChanged.addListener(handler);
    return function () { chrome.storage.onChanged.removeListener(handler); };
  }

  global.KKFav = {
    KEY_PREFIX: KEY_PREFIX,
    SCHEMA: SCHEMA,
    idFromUrl: idFromUrl,
    list: list,
    ids: ids,
    get: get,
    has: has,
    add: add,
    update: update,
    remove: remove,
    toggle: toggle,
    markAlertsSeen: markAlertsSeen,
    clear: clear,
    count: count,
    exportAll: exportAll,
    importAll: importAll,
    migrate: migrate,
    usage: usage,
    getSettings: getSettings,
    setSettings: setSettings,
    getVocab: getVocab,
    setVocab: setVocab,
    vocabIsStale: vocabIsStale,
    facetsFor: facetsFor,
    parseScale: parseScale,
    matchBrand: matchBrand,
    onChange: onChange
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
