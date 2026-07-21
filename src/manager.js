/**
 * The favourites manager. The same page is used as the toolbar popup and, with
 * ?tab=1, as a full-tab view.
 */
(function () {
  'use strict';

  var store = globalThis.KKFav;
  var isTab = new URLSearchParams(location.search).get('tab') === '1';

  var el = {
    body: document.body,
    count: document.getElementById('count'),
    openTab: document.getElementById('open-tab'),
    search: document.getElementById('search'),
    sort: document.getElementById('sort'),
    viewToggle: document.getElementById('view-toggle'),
    banner: document.getElementById('banner'),
    bannerText: document.getElementById('banner-text'),
    bannerDismiss: document.getElementById('banner-dismiss'),
    list: document.getElementById('list'),
    template: document.getElementById('fav-template'),
    exportBtn: document.getElementById('export'),
    importBtn: document.getElementById('import'),
    importFile: document.getElementById('import-file'),
    clearBtn: document.getElementById('clear'),
    area: document.getElementById('area'),
    usage: document.getElementById('usage'),
    toast: document.getElementById('toast'),
    toastText: document.getElementById('toast-text'),
    toastUndo: document.getElementById('toast-undo')
  };

  var state = { favourites: [], query: '', sort: 'added-desc' };

  /* --------------------------------------------------------------- format */

  var rtf = new Intl.RelativeTimeFormat('en-GB', { numeric: 'auto' });
  var UNITS = [
    ['year', 31536e6], ['month', 2592e6], ['week', 6048e5],
    ['day', 864e5], ['hour', 36e5], ['minute', 6e4]
  ];

  function relativeTime(ts) {
    if (!ts) return '';
    var diff = ts - Date.now();
    for (var i = 0; i < UNITS.length; i += 1) {
      if (Math.abs(diff) >= UNITS[i][1]) {
        return rtf.format(Math.round(diff / UNITS[i][1]), UNITS[i][0]);
      }
    }
    return 'just now';
  }

  function fullDate(ts) {
    if (!ts) return '';
    return new Date(ts).toLocaleString('en-GB', {
      day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  }

  function priceValue(fav) {
    var lowest = Infinity;
    (fav.prices || []).forEach(function (p) {
      var match = String(p.current || '').match(/[\d]+(?:[.,]\d+)?/);
      if (match) lowest = Math.min(lowest, parseFloat(match[0].replace(',', '')));
    });
    return lowest;
  }

  function formatBytes(n) {
    if (!n) return '0 KB';
    if (n < 1024) return n + ' B';
    return Math.round(n / 1024) + ' KB';
  }

  /* --------------------------------------------------------------- render */

  function matches(fav, query) {
    if (!query) return true;
    var haystack = [fav.title, fav.details, fav.note, fav.url]
      .filter(Boolean).join(' ').toLowerCase();
    return query.split(/\s+/).every(function (term) { return haystack.indexOf(term) !== -1; });
  }

  function sortFavourites(items, mode) {
    var sorted = items.slice();
    sorted.sort(function (a, b) {
      switch (mode) {
        case 'added-asc': return (a.addedAt || 0) - (b.addedAt || 0);
        case 'title-asc': return (a.title || '').localeCompare(b.title || '', 'en-GB');
        case 'title-desc': return (b.title || '').localeCompare(a.title || '', 'en-GB');
        case 'price-asc': return priceValue(a) - priceValue(b);
        case 'price-desc': return priceValue(b) - priceValue(a);
        default: return (b.addedAt || 0) - (a.addedAt || 0);
      }
    });
    return sorted;
  }

  function emptyState(filtered) {
    var wrap = document.createElement('div');
    wrap.className = 'empty';
    wrap.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.7 4.7 13.4a4.6 4.6 0 0 1 0-6.5 4.6 4.6 0 0 1 6.5 0l.8.8.8-.8a4.6 4.6 0 0 1 6.5 0 4.6 4.6 0 0 1 0 6.5Z"/></svg>' +
      (filtered
        ? '<h2>No matches</h2><p>Nothing here matches that search.</p>'
        : '<h2>No favourites yet</h2><p>Browse kingkit.co.uk and click the heart in the corner of any product image.</p>');
    return wrap;
  }

  function renderPrices(fav) {
    var parts = [];
    (fav.prices || []).forEach(function (p) {
      var label = p.label ? p.label + ' ' : '';
      if (p.current) {
        parts.push('<span>' + escapeHtml(label + p.current) +
          (p.old ? '<span class="was">' + escapeHtml(p.old) + '</span>' : '') + '</span>');
      } else if (p.note) {
        parts.push('<span class="oos">' + escapeHtml(label + p.note) + '</span>');
      }
    });
    return parts.join('');
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function buildCard(fav) {
    var node = el.template.content.firstElementChild.cloneNode(true);
    node.dataset.id = fav.id;

    var media = node.querySelector('.fav__media');
    var img = node.querySelector('.fav__media img');
    var title = node.querySelector('.fav__title');

    media.href = fav.url;
    title.href = fav.url;
    title.textContent = fav.title || fav.url;

    if (fav.image) {
      img.src = fav.image;
      img.alt = fav.title || '';
      // Thumbnails are hotlinked from kingkit.co.uk; if one 404s or the site
      // refuses the request, show a placeholder rather than a broken image.
      img.addEventListener('error', function () {
        media.classList.add('is-broken');
        img.remove();
      });
    } else {
      media.classList.add('is-broken');
      img.remove();
    }

    var details = node.querySelector('.fav__details');
    if (fav.details) details.textContent = fav.details; else details.hidden = true;

    var prices = node.querySelector('.fav__prices');
    var priceHtml = renderPrices(fav);
    if (priceHtml) prices.innerHTML = priceHtml; else prices.hidden = true;

    var noteText = node.querySelector('.fav__note-text');
    if (fav.note) {
      noteText.textContent = fav.note;
      noteText.hidden = false;
    }

    var added = node.querySelector('.fav__added');
    added.textContent = relativeTime(fav.addedAt);
    added.dateTime = fav.addedAt ? new Date(fav.addedAt).toISOString() : '';
    added.title = 'Saved ' + fullDate(fav.addedAt);

    node.querySelector('.js-note-input').value = fav.note || '';
    return node;
  }

  function render() {
    var query = state.query.trim().toLowerCase();
    var visible = sortFavourites(
      state.favourites.filter(function (f) { return matches(f, query); }),
      state.sort
    );

    el.list.textContent = '';
    if (!visible.length) {
      el.list.appendChild(emptyState(Boolean(query) && state.favourites.length > 0));
    } else {
      var frag = document.createDocumentFragment();
      visible.forEach(function (fav) { frag.appendChild(buildCard(fav)); });
      el.list.appendChild(frag);
    }

    el.count.textContent = String(state.favourites.length);
    el.exportBtn.disabled = !state.favourites.length;
    el.clearBtn.disabled = !state.favourites.length;
  }

  async function load() {
    state.favourites = await store.list();
    render();
    updateUsage();
  }

  async function updateUsage() {
    var settings = await store.getSettings();
    var stats = await store.usage();
    var active = stats[settings.area] || stats.local;
    var quota = active.quota ? ' of ' + formatBytes(active.quota) : '';
    el.usage.textContent = active.unavailable
      ? 'unavailable'
      : formatBytes(active.used) + quota + ' used';

    el.banner.hidden = !settings.syncFallback;
    if (settings.syncFallback) {
      el.bannerText.textContent =
        'Chrome sync storage is full or unavailable, so recent favourites were saved on this device only.';
    }
  }

  /* --------------------------------------------------------------- toasts */

  var toastTimer = null;
  var undoAction = null;

  function toast(message, undo) {
    el.toastText.textContent = message;
    undoAction = undo || null;
    el.toastUndo.hidden = !undo;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.toast.hidden = true;
      undoAction = null;
    }, 5000);
  }

  el.toastUndo.addEventListener('click', function () {
    var action = undoAction;
    el.toast.hidden = true;
    undoAction = null;
    if (action) action();
  });

  /* -------------------------------------------------------------- actions */

  el.list.addEventListener('click', function (event) {
    var card = event.target.closest('.fav');
    if (!card) return;
    var id = card.dataset.id;

    if (event.target.closest('.js-remove')) {
      var record = state.favourites.find(function (f) { return f.id === id; });
      card.classList.add('is-going');
      store.remove(id).then(function () {
        toast('Removed', function () { if (record) store.add(record); });
      });
      return;
    }

    if (event.target.closest('.js-note')) {
      var editor = card.querySelector('.fav__note-edit');
      editor.hidden = !editor.hidden;
      if (!editor.hidden) card.querySelector('.js-note-input').focus();
      return;
    }

    if (event.target.closest('.js-note-save')) {
      saveNote(card, id);
    }
  });

  el.list.addEventListener('keydown', function (event) {
    if (event.key !== 'Enter' || !event.target.classList.contains('js-note-input')) return;
    var card = event.target.closest('.fav');
    saveNote(card, card.dataset.id);
  });

  function saveNote(card, id) {
    var value = card.querySelector('.js-note-input').value.trim();
    store.update(id, { note: value }).then(function () {
      card.querySelector('.fav__note-edit').hidden = true;
      toast(value ? 'Note saved' : 'Note cleared');
    });
  }

  var searchTimer = null;
  el.search.addEventListener('input', function () {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      state.query = el.search.value;
      render();
    }, 120);
  });

  el.sort.addEventListener('change', function () {
    state.sort = el.sort.value;
    store.setSettings({ sort: state.sort });
    render();
  });

  el.viewToggle.addEventListener('click', function () {
    var next = el.body.classList.toggle('view-list') ? 'list' : 'grid';
    store.setSettings({ view: next });
  });

  el.openTab.addEventListener('click', function () {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/manager.html?tab=1') });
    window.close();
  });

  el.exportBtn.addEventListener('click', async function () {
    var payload = await store.exportAll();
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = 'kingkit-favourites-' + new Date().toISOString().slice(0, 10) + '.json';
    link.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  });

  el.importBtn.addEventListener('click', function () { el.importFile.click(); });

  el.importFile.addEventListener('change', async function () {
    var file = el.importFile.files && el.importFile.files[0];
    if (!file) return;
    try {
      var result = await store.importAll(JSON.parse(await file.text()));
      var bits = [result.added + ' imported'];
      if (result.skipped) bits.push(result.skipped + ' already saved');
      if (result.failed) bits.push(result.failed + ' skipped');
      toast(bits.join(', '));
    } catch (err) {
      console.error('[KingKit Favourites] import failed:', err);
      toast('That file could not be read as a favourites export');
    }
    el.importFile.value = '';
  });

  // Two-step confirmation — a native confirm() can dismiss the popup.
  var clearTimer = null;
  el.clearBtn.addEventListener('click', async function () {
    if (!el.clearBtn.classList.contains('is-confirming')) {
      el.clearBtn.classList.add('is-confirming');
      el.clearBtn.textContent = 'Tap again to confirm';
      clearTimer = setTimeout(resetClear, 4000);
      return;
    }
    clearTimeout(clearTimer);
    var backup = state.favourites.slice();
    await store.clear();
    resetClear();
    toast('Cleared ' + backup.length + ' favourites', function () {
      store.importAll(backup);
    });
  });

  function resetClear() {
    el.clearBtn.classList.remove('is-confirming');
    el.clearBtn.textContent = 'Clear all';
  }

  el.area.addEventListener('change', async function () {
    var target = el.area.value;
    el.area.disabled = true;
    try {
      var moved = await store.migrate(target);
      toast(target === 'sync'
        ? 'Now syncing ' + moved + ' favourites to your Chrome account'
        : 'Now storing ' + moved + ' favourites on this device only');
    } catch (err) {
      console.error('[KingKit Favourites] storage move failed:', err);
      toast('Could not move favourites — they are unchanged');
      var settings = await store.getSettings();
      el.area.value = settings.area;
    }
    el.area.disabled = false;
    updateUsage();
  });

  el.bannerDismiss.addEventListener('click', function () {
    store.setSettings({ syncFallback: false });
    el.banner.hidden = true;
  });

  store.onChange(load);

  /* ----------------------------------------------------------------- boot */

  (async function init() {
    if (isTab) el.body.classList.add('is-tab');
    var settings = await store.getSettings();
    if (settings.view === 'list') el.body.classList.add('view-list');
    state.sort = settings.sort || 'added-desc';
    el.sort.value = state.sort;
    el.area.value = settings.area;
    await load();
    el.search.focus();
  })();
})();
