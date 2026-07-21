/**
 * Injects the favourite toggle over KingKit product imagery.
 *
 * Two hosts are handled:
 *   - `.prodtile`            — every grid tile (search results, carousels,
 *                              "related items", homepage specials)
 *   - `.product-main-image`  — the hero image on a product page
 *
 * The button is appended as a sibling of the tile's <a>, never inside it, so
 * there is no nested-interactive markup and no accidental navigation. Clicks
 * are handled by one delegated listener rather than per-button listeners: the
 * homepage carousel clones tiles with cloneNode(), which copies markup but not
 * listeners, and delegation keeps cloned buttons working.
 */
(function () {
  'use strict';

  var BTN = 'kkf-btn';
  var TOAST_MS = 2600;
  var store = globalThis.KKFav;

  var HEART = '<svg class="kkf-heart" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
    '<path d="M12 20.7 4.7 13.4a4.6 4.6 0 0 1 0-6.5 4.6 4.6 0 0 1 6.5 0l.8.8.8-.8a4.6 4.6 0 0 1 6.5 0 4.6 4.6 0 0 1 0 6.5Z"/></svg>';

  /* ---------------------------------------------------------------- helpers */

  function absolute(url) {
    if (!url) return '';
    try { return new URL(url, location.href).href; } catch (err) { return url; }
  }

  function text(node) {
    return node ? node.textContent.replace(/\s+/g, ' ').trim() : '';
  }

  /** Read the New / Pre-owned rows off a grid tile. */
  function pricesFromTile(tile) {
    return Array.prototype.map.call(tile.querySelectorAll('.price-row'), function (row) {
      return {
        label: text(row.querySelector('.price-label')),
        current: text(row.querySelector('.price-current')),
        old: text(row.querySelector('.price-old')),
        note: text(row.querySelector('.stock-note'))
      };
    }).filter(function (p) { return p.label || p.current || p.note; });
  }

  function favFromTile(tile) {
    var link = tile.querySelector('a.product-tile') || tile.querySelector('a[href*="/product/"]');
    if (!link || !link.getAttribute('href')) return null;

    var img = tile.querySelector('.product-media img') || tile.querySelector('img');
    var url = absolute(link.getAttribute('href'));

    return {
      id: store.idFromUrl(url),
      url: url,
      title: text(tile.querySelector('.product-title')) || (img && img.getAttribute('alt')) || text(link),
      image: img ? absolute(img.getAttribute('src')) : '',
      details: text(tile.querySelector('.product-details')),
      prices: pricesFromTile(tile)
    };
  }

  /**
   * Read the same shape off a product detail page.
   *
   * There is one basket <form> per purchasable condition, distinguished by its
   * hidden ptype input — there are no per-condition wrapper classes to key off.
   * Within a form the price is either `.saleprice span` (discounted, with the
   * old price in a <strike>) or `.rrpprice span` (undiscounted).
   */
  function favFromProductPage(page) {
    var img = page.querySelector('.product-main-image img:not(.zoomImg)');
    var block = page.querySelector('.price-availability-block');
    var prices = [];

    if (block) {
      Array.prototype.forEach.call(block.querySelectorAll('form'), function (form) {
        var ptype = (form.querySelector('input[name="ptype"]') || {}).value || '';
        var sale = text(form.querySelector('.saleprice span'));
        var rrp = text(form.querySelector('.rrpprice span'));
        var current = sale || rrp;
        if (!current) {
          var fallback = text(form.querySelector('.priceheight')).match(/£[\d.,]+/);
          current = fallback ? fallback[0] : '';
        }
        prices.push({
          label: ptype === 'preowned' ? 'Pre-owned' : (ptype === 'new' ? 'New' : ''),
          current: current,
          old: sale ? text(form.querySelector('strike span')) : '',
          note: text(form.querySelector('.instock'))
        });
      });

      // Nothing purchasable: keep at least the availability note.
      if (!prices.length && /out of stock/i.test(text(block))) {
        prices.push({ label: '', current: '', old: '', note: 'Out of stock' });
      }
    }

    // Breadcrumbs run Home › Category › [Sub] › Product; the top-level
    // category is the most useful label. Read <li>s only — querying "li, a"
    // returns each crumb twice.
    var breadcrumb = document.querySelector('.breadcrumb');
    var items = breadcrumb ? breadcrumb.querySelectorAll('li') : [];
    if (breadcrumb && !items.length) items = breadcrumb.querySelectorAll('a');
    var crumbs = Array.prototype.map.call(items, text).filter(Boolean);

    return {
      id: store.idFromUrl(location.href),
      url: absolute(location.pathname + location.search),
      title: text(page.querySelector('h1')) || document.title,
      image: img ? absolute(img.getAttribute('src')) : '',
      details: crumbs.length > 2 ? crumbs[1] : '',
      productId: (page.querySelector('input[name="product_id"]') || {}).value || '',
      prices: prices.filter(function (p) { return p.current || p.note; })
    };
  }

  /* ------------------------------------------------------------------- view */

  function makeButton(fav, large) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = BTN + (large ? ' ' + BTN + '--large' : '');
    btn.setAttribute('aria-pressed', 'false');
    btn.setAttribute('data-kkf-id', fav.id);
    // The payload rides on the element so cloned carousel tiles stay functional.
    btn.setAttribute('data-kkf', JSON.stringify(fav));
    btn.innerHTML = HEART + (large ? '<span class="kkf-btn__label">Save</span>' : '');
    paint(btn, false);
    return btn;
  }

  function paint(btn, saved) {
    var large = btn.classList.contains(BTN + '--large');
    btn.classList.toggle('is-fav', saved);
    btn.setAttribute('aria-pressed', saved ? 'true' : 'false');
    btn.title = saved ? 'Remove from KingKit favourites' : 'Save to KingKit favourites';
    btn.setAttribute('aria-label', btn.title);
    if (large) {
      var label = btn.querySelector('.kkf-btn__label');
      if (label) label.textContent = saved ? 'Saved' : 'Save';
    }
  }

  var toastTimer = null;

  function toast(message, undo) {
    var existing = document.querySelector('.kkf-toast');
    if (existing) existing.remove();

    var el = document.createElement('div');
    el.className = 'kkf-toast';
    el.setAttribute('role', 'status');

    var span = document.createElement('span');
    span.className = 'kkf-toast__text';
    span.textContent = message;
    el.appendChild(span);

    if (undo) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'kkf-toast__undo';
      button.textContent = 'Undo';
      button.addEventListener('click', function () {
        el.remove();
        undo();
      });
      el.appendChild(button);
    }

    document.body.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('is-in'); });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.classList.remove('is-in');
      setTimeout(function () { el.remove(); }, 200);
    }, TOAST_MS);
  }

  /* -------------------------------------------------------------- injection */

  function injectTiles(root) {
    var tiles = root.querySelectorAll ? root.querySelectorAll('.prodtile') : [];
    Array.prototype.forEach.call(tiles, function (tile) {
      if (tile.querySelector(':scope > .' + BTN)) return;
      var fav = favFromTile(tile);
      if (!fav || !fav.id) return;
      tile.classList.add('kkf-host');
      tile.appendChild(makeButton(fav, false));
    });
  }

  function injectProductPage() {
    var page = document.querySelector('.product-page');
    if (!page) return;
    var host = page.querySelector('.product-main-image');
    if (!host || host.querySelector('.' + BTN)) return;
    var fav = favFromProductPage(page);
    if (!fav || !fav.id) return;
    host.classList.add('kkf-host', 'kkf-host--hero');
    host.appendChild(makeButton(fav, true));
  }

  function injectAll() {
    injectTiles(document);
    injectProductPage();
    refresh();
  }

  /** Repaint every button on the page from the stored id set. */
  async function refresh() {
    var buttons = document.querySelectorAll('.' + BTN);
    if (!buttons.length) return;
    var saved = await store.ids();
    Array.prototype.forEach.call(buttons, function (btn) {
      paint(btn, saved.has(btn.getAttribute('data-kkf-id')));
    });
  }

  /* --------------------------------------------------------------- wiring */

  document.addEventListener('click', function (event) {
    var btn = event.target && event.target.closest ? event.target.closest('.' + BTN) : null;
    if (!btn) return;

    // Capture phase: stop the tile link and any carousel drag handler.
    event.preventDefault();
    event.stopPropagation();

    var fav;
    try {
      fav = JSON.parse(btn.getAttribute('data-kkf'));
    } catch (err) {
      return;
    }

    btn.classList.add('is-busy');
    store.toggle(fav).then(function (result) {
      btn.classList.remove('is-busy');
      if (result.saved) {
        btn.classList.add('kkf-pop');
        setTimeout(function () { btn.classList.remove('kkf-pop'); }, 320);
        toast('Saved to favourites', function () { store.remove(result.id); });
      } else {
        toast('Removed from favourites', function () { store.add(fav); });
      }
    }).catch(function (err) {
      btn.classList.remove('is-busy');
      console.error('[KingKit Favourites]', err);
      toast('Could not save — check the extension has storage access');
    });
  }, true);

  store.onChange(refresh);

  // KingKit renders server-side, but carousels clone tiles and some listings
  // paginate in place; a debounced observer keeps new nodes covered.
  var pending = false;
  new MutationObserver(function () {
    if (pending) return;
    pending = true;
    requestAnimationFrame(function () {
      pending = false;
      injectAll();
    });
  }).observe(document.documentElement, { childList: true, subtree: true });

  injectAll();
})();
