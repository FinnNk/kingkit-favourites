/**
 * Price & stock watcher.
 *
 * Loaded by the service worker (importScripts) and by the test harness, so —
 * like scalemates.js — it exports onto the global object and touches no DOM
 * API: service workers have no DOMParser, hence the regex parsing.
 *
 * KingKit sells largely one-off second-hand stock, so each favourite's product
 * page is re-fetched roughly daily, the price rows are diffed against the
 * copy stored on the favourite, and any movement is recorded as an alert for
 * the manager to display. Design constraints, in order:
 *  1. Be a good guest. Checks run serially with a fixed gap, a drain fetches
 *     at most a handful of pages, a favourite is checked once per ~day, a
 *     product that has vanished is never fetched again, and a 403/429 pauses
 *     the whole watcher for an hour.
 *  2. Never invent an alert. The first ever snapshot produces no alerts, and
 *     identical rows are ignored — only genuine movement is recorded.
 */
(function (global) {
  'use strict';

  var GAP_MS = 4000;                              // pause between any two requests
  var MAX_PER_DRAIN = 10;                         // page fetches per drain, at most
  var CHECK_INTERVAL_MS = 20 * 60 * 60 * 1000;    // ~daily, with slack for the hourly alarm
  var MAX_TRIES = 5;                              // consecutive failures before backing off
  var RETRY_BACKOFF_MS = 7 * 24 * 60 * 60 * 1000; // one attempt per week once backed off
  var MAX_ALERTS = 10;                            // per favourite, newest first

  /* ------------------------------------------------------------ utilities */

  function decodeEntities(s) {
    return String(s || '')
      .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');
  }

  /** "£1,299.99" -> 1299.99; anything without digits -> null. */
  function money(s) {
    var m = String(s == null ? '' : s).replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
    return m ? parseFloat(m[1]) : null;
  }

  /** A row counts as buyable when it carries a price and is not noted out. */
  function available(row) {
    return Boolean(row) && money(row.current) !== null &&
      !/out of stock/i.test(row.note || '');
  }

  /* ------------------------------------------------------ page parsing */

  /**
   * Read the New / Pre-owned price rows off a product page, mirroring what
   * the content script stores at save time so the diff compares like with
   * like. There is one basket <form> per purchasable condition, keyed by its
   * hidden ptype input; the price is either `.saleprice span` (discounted,
   * with the old price in a <strike>) or `.rrpprice span` (undiscounted). A
   * condition that is out of stock simply has no form at all.
   */
  function parsePrices(html) {
    var s = String(html || '');
    var start = s.indexOf('price-availability-block');
    if (start === -1) return [];

    var rows = [];
    var formRe = /<form[^>]*action="\/basket"[\s\S]*?<\/form>/g;
    var fm;
    while ((fm = formRe.exec(s)) !== null) {
      var form = fm[0];
      var ptype = (form.match(/name="ptype"[^>]*value="([^"]*)"/) || [])[1] || '';
      var sale = (form.match(/<p class="saleprice">[\s\S]*?<span[^>]*>\s*(£[\d.,]+)/) || [])[1] || '';
      var rrp = (form.match(/<span class="rrpprice">[\s\S]*?<span[^>]*>\s*(£[\d.,]+)/) || [])[1] || '';
      var current = sale || rrp;
      if (!current) {
        var height = (form.match(/<div class="priceheight">([\s\S]*?)<\/div>/) || [])[1] || '';
        current = (height.match(/£[\d.,]+/) || [])[0] || '';
      }
      rows.push({
        label: ptype === 'preowned' ? 'Pre-owned' : (ptype === 'new' ? 'New' : ''),
        current: current,
        old: sale ? ((form.match(/<strike>[\s\S]*?<span[^>]*>\s*(£[\d.,]+)/) || [])[1] || '') : '',
        note: decodeEntities((form.match(/<p class="instock">([^<]*)<\/p>/) || [])[1] || '').trim()
      });
    }

    // Nothing purchasable: keep at least the availability note, exactly as
    // the content script does, so a later restock is detectable.
    if (!rows.length && /out of stock/i.test(s.slice(start, start + 6000))) {
      rows.push({ label: '', current: '', old: '', note: 'Out of stock' });
    }

    return rows.filter(function (r) { return r.current || r.note; });
  }

  /**
   * A product page that no longer exists either 404s or (more usually)
   * redirects to the homepage, which serves 200 without the .product-page
   * wrapper. Only the wrapper decides: the product_id input lives inside the
   * per-condition basket forms, and a page whose every condition is out of
   * stock legitimately has no forms at all — such a page must NOT be treated
   * as gone, or restocks could never be noticed.
   */
  function looksGone(html) {
    return String(html || '').indexOf('class="product-page"') === -1;
  }

  /* --------------------------------------------------------------- diff */

  /**
   * Compare the stored rows against the freshly parsed ones, per condition
   * label. Returns alert objects (without timestamps applied by check()):
   *   price-drop / price-rise  — the current price moved;
   *   restock                  — previously absent or noted out, now buyable;
   *   out-of-stock             — previously buyable, now absent or priceless.
   * The first ever snapshot (no old rows) yields nothing: there is no
   * baseline to have moved from.
   */
  function diff(oldRows, newRows, at) {
    var olds = Array.isArray(oldRows) ? oldRows : [];
    var news = Array.isArray(newRows) ? newRows : [];
    if (!olds.length) return [];

    var byLabel = function (rows) {
      var map = {};
      rows.forEach(function (r) { if (!(r.label in map)) map[r.label] = r; });
      return map;
    };
    var was = byLabel(olds);
    var is = byLabel(news);

    // New rows first (site order), then any conditions that have vanished.
    var labels = [];
    news.forEach(function (r) { if (labels.indexOf(r.label) === -1) labels.push(r.label); });
    olds.forEach(function (r) { if (labels.indexOf(r.label) === -1) labels.push(r.label); });

    var alerts = [];
    var push = function (kind, label, from, to) {
      alerts.push({ at: at || Date.now(), kind: kind, label: label, from: from, to: to, seen: false });
    };

    labels.forEach(function (label) {
      var a = was[label];
      var b = is[label];
      if (available(a) && available(b)) {
        var fromN = money(a.current);
        var toN = money(b.current);
        if (toN < fromN) push('price-drop', label, a.current, b.current);
        else if (toN > fromN) push('price-rise', label, a.current, b.current);
      } else if (available(a) && !available(b)) {
        push('out-of-stock', label, a.current, '');
      } else if (!available(a) && available(b)) {
        push('restock', label, a ? a.current : '', b.current);
      }
      // Neither buyable, or identical prices: nothing to say.
    });

    return alerts;
  }

  /* -------------------------------------------------------------- check */

  /**
   * Check one favourite. `fetchFn` is injected (real fetch in the worker, a
   * stub in tests). Never throws. Returns:
   *   watch  — the fav.watch record to store (see below);
   *   prices — freshly parsed rows to overwrite fav.prices, or null when the
   *            page could not be read (network error, throttled, gone);
   *   pauseWatch — set when a 403/429 asked us to back off site-wide (the
   *            flag is for the worker and is not stored on the favourite).
   *
   * fav.watch = { checkedAt, tries, gone, alerts } per the manager contract,
   * plus triedAt: the timestamp of the last attempt, successful or not, which
   * needsCheck uses to space out retries without disturbing checkedAt (the
   * last *successful* check, which the manager displays).
   */
  async function check(fav, fetchFn) {
    var prev = (fav && fav.watch) || {};
    var alerts = Array.isArray(prev.alerts) ? prev.alerts.slice() : [];
    var now = Date.now();

    function result(patch, prices, extra) {
      var watch = Object.assign({
        checkedAt: prev.checkedAt || 0,
        triedAt: now,
        tries: 0,
        gone: false,
        alerts: alerts.slice(0, MAX_ALERTS)
      }, patch);
      return Object.assign({ watch: watch, prices: prices }, extra || {});
    }

    function failure(extra) {
      return result({ tries: (prev.tries || 0) + 1, gone: Boolean(prev.gone) }, null, extra);
    }

    function gone() {
      if (!prev.gone) {
        alerts.unshift({ at: now, kind: 'gone', label: '', from: '', to: '', seen: false });
      }
      return result({ checkedAt: now, gone: true }, null);
    }

    var res;
    try {
      res = await fetchFn(fav.url);
    } catch (err) {
      return failure();
    }
    if (res.status === 404 || res.status === 410) return gone();
    if (res.status === 403 || res.status === 429) return failure({ pauseWatch: true });
    if (!res.ok) return failure();

    var html;
    try {
      html = await res.text();
    } catch (err) {
      return failure();
    }
    if (looksGone(html)) return gone();

    var rows = parsePrices(html);
    alerts = diff(fav.prices, rows, now).concat(alerts);
    return result({ checkedAt: now, alerts: alerts.slice(0, MAX_ALERTS) }, rows);
  }

  /* --------------------------------------------------------- scheduling */

  /**
   * Is this favourite due a check? True when it has never been attempted, or
   * the last attempt is older than the daily interval. After MAX_TRIES
   * consecutive failures the interval stretches to a week — the product may
   * be behind a long outage, but we never give up short of `gone`. The
   * settings.watch master switch is the worker's concern, not this one's.
   */
  function needsCheck(fav, now) {
    if (!fav || !fav.url) return false;
    var w = fav.watch;
    if (!w) {
      // Never checked — but the save-time scrape IS a fresh snapshot, so a
      // just-favourited kit waits a full interval like everything else.
      return (now || Date.now()) - (fav.addedAt || 0) > CHECK_INTERVAL_MS;
    }
    if (w.gone) return false;
    var last = Math.max(w.checkedAt || 0, w.triedAt || 0);
    if (!last) return true;
    var interval = (w.tries || 0) >= MAX_TRIES ? RETRY_BACKOFF_MS : CHECK_INTERVAL_MS;
    return (now || Date.now()) - last > interval;
  }

  global.KKWatch = {
    GAP_MS: GAP_MS,
    MAX_PER_DRAIN: MAX_PER_DRAIN,
    CHECK_INTERVAL_MS: CHECK_INTERVAL_MS,
    MAX_TRIES: MAX_TRIES,
    RETRY_BACKOFF_MS: RETRY_BACKOFF_MS,
    MAX_ALERTS: MAX_ALERTS,
    money: money,
    parsePrices: parsePrices,
    looksGone: looksGone,
    diff: diff,
    check: check,
    needsCheck: needsCheck
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
