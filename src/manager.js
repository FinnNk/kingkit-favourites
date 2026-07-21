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
    copyBtn: document.getElementById('copy'),
    importBtn: document.getElementById('import'),
    importFile: document.getElementById('import-file'),
    clearBtn: document.getElementById('clear'),
    area: document.getElementById('area'),
    usage: document.getElementById('usage'),
    toast: document.getElementById('toast'),
    toastText: document.getElementById('toast-text'),
    toastUndo: document.getElementById('toast-undo'),
    filters: document.getElementById('filters'),
    filterClear: document.getElementById('f-clear')
  };

  // Facet key -> its <select> and the label for "no filter". `format` (when
  // present) turns a stored value into its display label.
  var FACETS = [
    { key: 'brand', el: document.getElementById('f-brand'), all: 'All manufacturers' },
    { key: 'scale', el: document.getElementById('f-scale'), all: 'All scales' },
    { key: 'category', el: document.getElementById('f-category'), all: 'All categories' },
    { key: 'status', el: document.getElementById('f-status'), all: 'All statuses', format: capitalise }
  ];

  var state = {
    favourites: [],
    facets: new Map(), // id -> {brand, scale, category}, derived, never stored
    vocab: null,
    query: '',
    sort: 'added-desc',
    filters: { brand: '', scale: '', category: '', status: '' },
    visible: [], // the array behind the current render, for Copy
    // Dense-vector results for the current query: Map id -> cosine sim.
    semantic: { query: '', sims: new Map() },
    semanticToken: 0
  };

  // Semantic acceptance, tuned against live all-MiniLM-L6-v2 output. A
  // favourite joins the semantic tail when its cosine similarity clears an
  // absolute floor AND sits a clear absolute gap above the collection mean.
  // The gap (not a z-score) is what rejects "nothing really matches" queries:
  // there every similarity compresses into a narrow band, so the top item's
  // gap over the mean collapses even though its z-score can stay high.
  // With very few vectors the mean is meaningless, so a plain threshold
  // applies instead.
  var SEM_FLOOR = 0.28;
  var SEM_GAP = 0.08;
  var SEM_SMALL_N = 4;
  var SEM_PLAIN = 0.35;
  var SEM_MAX_TAIL = 8;

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

  function capitalise(value) {
    var s = String(value == null ? '' : value);
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  /** Scalemates release year as a number, or null when unknown. */
  function releaseYear(fav) {
    var year = parseInt(fav.sm && fav.sm.status === 'matched' && fav.sm.year, 10);
    return isNaN(year) ? null : year;
  }

  /* --------------------------------------------------------------- render */

  /**
   * The stored facets plus the status, which lives on the favourite itself
   * (absent means 'wanted') — merged here so the faceted machinery treats it
   * like any other facet without storage.js needing to know about it.
   * Status is clamped to the known values: imported or hand-edited data can
   * carry anything ("Wanted", "ordered"), and an unknown value would derail
   * the facet dropdown and the card select alike.
   */
  var STATUSES = ['wanted', 'bought', 'built'];
  function statusOf(fav) {
    var s = String(fav.status || 'wanted').toLowerCase();
    return STATUSES.indexOf(s) !== -1 ? s : 'wanted';
  }

  function facetsOf(fav) {
    return Object.assign({}, state.facets.get(fav.id) || {}, {
      status: statusOf(fav)
    });
  }

  /**
   * Semantic-ish search. Each group is a set of terms treated as equivalent,
   * so "ww1", "biplane era" kits tagged by Scalemates as "World War I", and a
   * search for "planes" against the "Aircraft" topic all connect. Multi-word
   * variants are matched with token boundaries so "world war i" cannot hit
   * "world war ii".
   */
  var SYNONYMS = [
    ['ww1', 'wwi', 'ww 1', 'world war 1', 'world war i', 'great war', 'first world war'],
    ['ww2', 'wwii', 'ww 2', 'world war 2', 'world war ii', 'second world war'],
    ['cold war', 'coldwar'],
    ['aircraft', 'plane', 'planes', 'aeroplane', 'airplane', 'aviation', 'fighter', 'bomber', 'biplane', 'monoplane', 'warplane'],
    ['ship', 'ships', 'boat', 'boats', 'naval', 'navy', 'warship', 'battleship', 'submarine', 'destroyer'],
    ['tank', 'tanks', 'armour', 'armor', 'afv', 'military'],
    ['car', 'cars', 'automotive', 'automobile'],
    ['truck', 'lorry', 'lorries', 'trucks'],
    ['motorbike', 'motorcycle', 'bike'],
    ['figure', 'figures', 'figurine'],
    ['helicopter', 'chopper', 'rotorcraft'],
    ['german', 'germany', 'luftwaffe', 'wehrmacht'],
    ['british', 'britain', 'raf', 'royal air force', 'uk'],
    ['american', 'usa', 'usaf', 'us navy', 'usn'],
    ['japanese', 'japan', 'ijn', 'ija'],
    ['soviet', 'russian', 'russia', 'ussr']
  ];

  function expansionsFor(term) {
    var out = [term];
    SYNONYMS.forEach(function (group) {
      if (group.indexOf(term) !== -1) {
        group.forEach(function (variant) {
          if (variant !== term) out.push(variant);
        });
      }
    });
    return out;
  }

  function haystackOf(fav) {
    var f = facetsOf(fav);
    var sm = fav.sm && fav.sm.status === 'matched' ? fav.sm : null;
    return ' ' + [
      fav.title, fav.details, fav.note, fav.url, f.brand, f.scale, f.category,
      sm && sm.subject, sm && sm.variant, sm && sm.era, sm && sm.year,
      sm && sm.topicName, sm && sm.topicAlt, sm && sm.topicPath, sm && sm.topicYear,
      sm && sm.ean
    ].filter(Boolean).join(' ').toLowerCase().replace(/[^a-z0-9]+/g, ' ') + ' ';
  }

  /** Collapse multi-word synonym phrases ("great war") into their group's
      single-token representative, so splitting on spaces cannot break them. */
  function foldPhrases(query) {
    var q = ' ' + query + ' ';
    SYNONYMS.forEach(function (group) {
      var token = group.find(function (v) { return v.indexOf(' ') === -1; }) || group[0];
      group.forEach(function (variant) {
        if (variant.indexOf(' ') === -1) return;
        var at = q.indexOf(' ' + variant + ' ');
        if (at !== -1) q = q.split(' ' + variant + ' ').join(' ' + token + ' ');
      });
    });
    return q.trim();
  }

  function matches(fav, query) {
    if (!query) return true;
    var haystack = haystackOf(fav);
    // Every search term must match; a term matches if any of its synonym
    // variants occurs. Single words match as substrings (so "junker" finds
    // Junkers); multi-word variants require token boundaries.
    return foldPhrases(query.replace(/[^a-z0-9\s]/gi, ' ')).split(/\s+/).filter(Boolean)
      .every(function (term) {
        return expansionsFor(term).some(function (variant) {
          return variant.indexOf(' ') === -1
            ? haystack.indexOf(variant) !== -1
            : haystack.indexOf(' ' + variant + ' ') !== -1;
        });
      });
  }

  /**
   * How well a rules-based match fits the query — used to order the rules
   * tier while a search is active. Title hits count most, the whole phrase
   * appearing in the title most of all.
   */
  function relevancy(fav, query) {
    var title = String(fav.title || '').toLowerCase();
    var haystack = haystackOf(fav);
    var score = 0;
    if (query.length > 2 && title.indexOf(query) !== -1) score += 10;
    foldPhrases(query.replace(/[^a-z0-9\s]/gi, ' ')).split(/\s+/).filter(Boolean)
      .forEach(function (term) {
        if (title.indexOf(term) !== -1) score += 3;
        else if (haystack.indexOf(term) !== -1) score += 1;
        else score += 0.5; // matched via a synonym variant only
      });
    return score;
  }

  /** Semantic similarity for the current query, or -1 when not computed. */
  function semanticSim(fav) {
    if (state.semantic.query !== state.query.trim().toLowerCase()) return -1;
    var sim = state.semantic.sims.get(fav.id);
    return sim === undefined ? -1 : sim;
  }

  /* ------------------------------------------------- find more like this */

  /**
   * A pre-filled Kit Finder search for this kit's manufacturer and scale.
   * Kit Finder keys brands by numeric id (harvested into the vocabulary with
   * the names) and writes scales with a caret ("1^48"); when the id is
   * unknown — vocabulary not refreshed yet, or an odd brand — fall back to a
   * plain text search on the subject.
   */
  function kingkitMoreUrl(fav) {
    var f = facetsOf(fav);
    var brandIds = (state.vocab && state.vocab.brandIds) || {};
    var brandId = f.brand ? brandIds[f.brand.toLowerCase()] : '';
    if (brandId) {
      return 'https://www.kingkit.co.uk/shop.php?search=kitfinder&search_term=' +
        '&brand=' + encodeURIComponent(brandId) + '&cat=' +
        '&scale=' + encodeURIComponent((f.scale || '').replace('/', '^'));
    }
    var subject = (typeof KKSM !== 'undefined' && KKSM.parseTitle(fav).subject) || fav.title || '';
    return 'https://www.kingkit.co.uk/shop.php?search=text&search_term=' +
      encodeURIComponent(subject.split(/\s+/).slice(0, 4).join(' '));
  }

  /**
   * The Scalemates topic page lists every kit of this subject across all
   * brands and boxings — the ideal "more like this" for subject hunting.
   * Favourites matched before topic URLs were captured fall back to a
   * Scalemates search on the subject (a human click, not an automated one).
   */
  function scalematesMoreUrl(fav) {
    var sm = fav.sm && fav.sm.status === 'matched' ? fav.sm : null;
    if (sm && sm.topicUrl) return sm.topicUrl;
    var subject = (sm && sm.subject) ||
      (typeof KKSM !== 'undefined' && KKSM.parseTitle(fav).subject) || fav.title || '';
    return 'https://www.scalemates.com/search.php?fkSECTION%5B%5D=Kits&q=' +
      encodeURIComponent(subject);
  }

  /**
   * DevTools-only visibility into the two search tiers (the UI deliberately
   * does not distinguish them). Logged at debug level — enable "Verbose" in
   * the console filter to see it. One line per settled result set.
   */
  var lastSearchLog = '';
  function logSearchTiers(query, rules, tail) {
    var mean = null;
    if (state.semantic.query === query && state.semantic.sims.size) {
      var values = Array.from(state.semantic.sims.values());
      mean = values.reduce(function (a, b) { return a + b; }, 0) / values.length;
    }

    var lines = ['[KingKit Favourites] search "' + query + '"'];
    lines.push('  rules (' + rules.length + '):');
    rules.forEach(function (f) {
      lines.push('    relevancy ' + relevancy(f, query).toFixed(1).padStart(5) + '  ' + f.title);
    });
    if (state.semantic.query !== query) {
      lines.push('  semantic: pending…');
    } else {
      lines.push('  semantic (' + tail.length + ' accepted; floor ' + SEM_FLOOR +
        ', gap ' + SEM_GAP + ' over mean ' + (mean === null ? 'n/a' : mean.toFixed(3)) + '):');
      tail.forEach(function (f) {
        lines.push('    cosine ' + semanticSim(f).toFixed(3) + '  ' + f.title);
      });
      // The best rejections explain why something is absent.
      var shown = new Set(rules.concat(tail).map(function (f) { return f.id; }));
      var rejected = state.favourites.filter(function (f) {
        return !shown.has(f.id) && semanticSim(f) >= 0;
      }).sort(function (a, b) { return semanticSim(b) - semanticSim(a); }).slice(0, 3);
      if (rejected.length) {
        lines.push('  nearest rejected:');
        rejected.forEach(function (f) {
          lines.push('    cosine ' + semanticSim(f).toFixed(3) + '  ' + f.title);
        });
      }
    }

    var text = lines.join('\n');
    if (text !== lastSearchLog) {
      lastSearchLog = text;
      console.debug(text);
    }
  }

  /** Ids passing the floor + z-score acceptance for the current query. */
  function acceptedSemanticIds() {
    if (state.semantic.query !== state.query.trim().toLowerCase()) return new Set();
    var sims = state.semantic.sims;
    var accepted = new Set();
    if (!sims.size) return accepted;

    if (sims.size < SEM_SMALL_N) {
      sims.forEach(function (sim, id) { if (sim >= SEM_PLAIN) accepted.add(id); });
      return accepted;
    }

    var values = Array.from(sims.values());
    var mean = values.reduce(function (a, b) { return a + b; }, 0) / values.length;

    sims.forEach(function (sim, id) {
      if (sim >= SEM_FLOOR && sim - mean >= SEM_GAP) accepted.add(id);
    });
    return accepted;
  }

  /**
   * Kick off the dense-vector search for the current query; when it lands
   * (and the query has not moved on), re-render with the semantic tail.
   */
  function scheduleSemantic(query) {
    if (!query || typeof KKSem === 'undefined') return;
    if (state.semantic.query === query) return; // already computed or in flight
    var token = ++state.semanticToken;
    KKSem.search(query).then(function (sims) {
      if (token !== state.semanticToken) return; // superseded
      state.semantic = { query: query, sims: sims };
      render();
    }).catch(function () { /* rules-based results already shown */ });
  }

  /**
   * `except` skips one facet's own filter, which is what makes the dropdowns
   * behave: the scale list is counted against everything the other filters
   * allow, so picking a manufacturer narrows the scales on offer but does not
   * empty the manufacturer list itself.
   */
  function passesFilters(fav, except) {
    var f = facetsOf(fav);
    for (var i = 0; i < FACETS.length; i += 1) {
      var key = FACETS[i].key;
      if (key === except) continue;
      if (state.filters[key] && f[key] !== state.filters[key]) return false;
    }
    return true;
  }

  function anyFilterActive() {
    return FACETS.some(function (f) { return state.filters[f.key]; });
  }

  /** 1/24 before 1/48 before 1/72, with unparseable values last. */
  function byScale(a, b) {
    var da = parseFloat(String(a).split('/')[1]);
    var db = parseFloat(String(b).split('/')[1]);
    if (isNaN(da)) da = Infinity;
    if (isNaN(db)) db = Infinity;
    return da - db || String(a).localeCompare(String(b), 'en-GB');
  }

  /** Lifecycle order rather than alphabetical: wanted, bought, built. */
  var STATUS_ORDER = ['wanted', 'bought', 'built'];
  function byStatus(a, b) {
    var ia = STATUS_ORDER.indexOf(a);
    var ib = STATUS_ORDER.indexOf(b);
    if (ia === -1) ia = STATUS_ORDER.length;
    if (ib === -1) ib = STATUS_ORDER.length;
    return ia - ib || String(a).localeCompare(String(b), 'en-GB');
  }

  /**
   * Rebuild the facet dropdowns from the favourites themselves, so only values
   * actually present are offered — with a count beside each.
   */
  function renderFilters(searched) {
    el.filters.hidden = state.favourites.length < 2;
    if (el.filters.hidden) return;

    FACETS.forEach(function (facet) {
      var counts = new Map();
      searched.filter(function (fav) { return passesFilters(fav, facet.key); })
        .forEach(function (fav) {
          var value = facetsOf(fav)[facet.key];
          if (!value) return;
          counts.set(value, (counts.get(value) || 0) + 1);
        });

      var order = function (a, b) { return a.localeCompare(b, 'en-GB'); };
      if (facet.key === 'scale') order = byScale;
      if (facet.key === 'status') order = byStatus;
      var values = Array.from(counts.keys()).sort(order);

      // Keep the active choice selectable even once nothing matches it.
      var current = state.filters[facet.key];
      if (current && !counts.has(current)) values.unshift(current);

      var select = facet.el;
      select.textContent = '';
      select.appendChild(new Option(facet.all, ''));
      values.forEach(function (value) {
        var label = facet.format ? facet.format(value) : value;
        select.appendChild(new Option(label + ' (' + (counts.get(value) || 0) + ')', value));
      });
      select.value = current;
      select.disabled = !values.length;
      select.classList.toggle('is-active', Boolean(current));
    });

    el.filterClear.hidden = !anyFilterActive();
    el.filters.classList.toggle('has-clear', anyFilterActive());
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
        case 'year-desc':
        case 'year-asc': {
          // Kits without a known release year always sink to the bottom,
          // whichever direction the years themselves run in.
          var ya = releaseYear(a);
          var yb = releaseYear(b);
          if (ya === null && yb === null) return (b.addedAt || 0) - (a.addedAt || 0);
          if (ya === null) return 1;
          if (yb === null) return -1;
          return (mode === 'year-asc' ? ya - yb : yb - ya) || (b.addedAt || 0) - (a.addedAt || 0);
        }
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
        ? '<h2>No matches</h2><p>Nothing here matches your search and filters.</p>'
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

  /* --------------------------------------------------------- watch alerts */

  // The price watcher (src/watch.js) appends alerts to fav.watch.alerts,
  // newest first. Everything here is defensive: favourites saved before the
  // watcher existed carry no watch data at all.
  var ALERT_CLASS = {
    'price-drop': 'fav__alert--drop',
    'price-rise': 'fav__alert--muted',
    'restock': 'fav__alert--restock',
    'out-of-stock': 'fav__alert--muted',
    'gone': 'fav__alert--gone'
  };

  function newestUnseenAlert(fav) {
    var alerts = fav.watch && Array.isArray(fav.watch.alerts) ? fav.watch.alerts : [];
    for (var i = 0; i < alerts.length; i += 1) {
      if (alerts[i] && !alerts[i].seen) return alerts[i];
    }
    return null;
  }

  function alertText(alert) {
    var label = alert.label ? alert.label + ' ' : '';
    var was = alert.from ? ' (was ' + alert.from + ')' : '';
    switch (alert.kind) {
      case 'price-drop': return label + '↓ ' + (alert.to || '') + was;
      case 'price-rise': return label + '↑ ' + (alert.to || '') + was;
      case 'restock': return label ? label + 'back in stock' : 'Back in stock';
      case 'out-of-stock': return label ? label + 'out of stock' : 'Out of stock';
      case 'gone': return 'No longer listed';
      default: return label + (alert.kind || 'updated');
    }
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

    var f = facetsOf(fav);
    var sm = fav.sm && fav.sm.status === 'matched' ? fav.sm : null;
    var details = node.querySelector('.fav__details');
    var line = [f.brand, f.scale, f.category, sm && sm.year]
      .filter(Boolean).join(' · ') || fav.details;
    if (line) details.textContent = line; else details.hidden = true;

    var smLink = node.querySelector('.js-sm-link');
    if (sm && sm.url) {
      smLink.href = sm.url;
      smLink.hidden = false;
      smLink.title = 'View on Scalemates' + (sm.year ? ' (released ' + sm.year + ')' : '');
    }

    var alertEl = node.querySelector('.fav__alert');
    var alert = newestUnseenAlert(fav);
    if (alert) {
      alertEl.querySelector('.fav__alert-text').textContent = alertText(alert);
      alertEl.classList.add(ALERT_CLASS[alert.kind] || 'fav__alert--muted');
      alertEl.hidden = false;
    } else {
      alertEl.remove(); // cards without alerts keep exactly their old layout
    }

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

    var status = node.querySelector('.js-status');
    status.value = statusOf(fav);
    if (statusOf(fav) === 'bought') status.classList.add('is-bought');
    if (statusOf(fav) === 'built') status.classList.add('is-built');

    node.querySelector('.js-note-input').value = fav.note || '';
    node.querySelector('.js-sm-input').value = (fav.sm && fav.sm.url) || '';

    var moreKk = node.querySelector('.js-more-kingkit');
    moreKk.href = kingkitMoreUrl(fav);
    moreKk.title = 'Search KingKit for ' +
      ([f.brand, f.scale].filter(Boolean).join(' ') || 'similar kits');
    var moreSm = node.querySelector('.js-more-scalemates');
    moreSm.href = scalematesMoreUrl(fav);
    moreSm.title = 'Every boxing of this subject on Scalemates';
    return node;
  }

  function render() {
    var query = state.query.trim().toLowerCase();

    // Tier 1: rules-based matches (substring + synonyms), ranked by relevancy.
    // Tier 2: dense-vector matches above the threshold, ranked by similarity.
    // Both tiers respect the facet filters; the UI does not distinguish them.
    var rules = state.favourites.filter(function (f) { return matches(f, query); });
    var searched = rules;

    if (query) {
      scheduleSemantic(query);
      var inRules = new Set(rules.map(function (f) { return f.id; }));
      var accepted = acceptedSemanticIds();
      var tail = state.favourites.filter(function (f) {
        return !inRules.has(f.id) && accepted.has(f.id);
      }).sort(function (a, b) { return semanticSim(b) - semanticSim(a); })
        .slice(0, SEM_MAX_TAIL);

      rules = rules.slice().sort(function (a, b) {
        return relevancy(b, query) - relevancy(a, query);
      });
      searched = rules.concat(tail);
      logSearchTiers(query, rules, tail);
    }

    renderFilters(searched);

    var visible = searched.filter(function (f) { return passesFilters(f, null); });
    if (!query) visible = sortFavourites(visible, state.sort);
    state.visible = visible;

    el.list.textContent = '';
    if (!visible.length) {
      el.list.appendChild(emptyState((Boolean(query) || anyFilterActive()) && state.favourites.length > 0));
    } else {
      var frag = document.createDocumentFragment();
      visible.forEach(function (fav) { frag.appendChild(buildCard(fav)); });
      el.list.appendChild(frag);
    }

    el.count.textContent = visible.length === state.favourites.length
      ? String(state.favourites.length)
      : visible.length + '/' + state.favourites.length;
    el.exportBtn.disabled = !state.favourites.length;
    el.copyBtn.disabled = !visible.length;
    el.clearBtn.disabled = !state.favourites.length;
  }

  async function load() {
    state.vocab = await store.getVocab();
    state.favourites = await store.list();
    state.facets = new Map();
    state.favourites.forEach(function (fav) {
      state.facets.set(fav.id, store.facetsFor(fav, state.vocab));
    });
    state.semantic = { query: '', sims: new Map() }; // data changed; recompute
    render();
    updateUsage();
    scheduleEmbedding();
  }

  /**
   * Keep favourite vectors warm in the background: waits for the UI to
   * settle, then embeds anything new or changed, a bounded batch at a time.
   */
  var embedTimer = null;
  function scheduleEmbedding() {
    if (typeof KKSem === 'undefined') return;
    clearTimeout(embedTimer);
    embedTimer = setTimeout(function () {
      KKSem.ensureVectors(state.favourites, facetsOf, 25).then(function (done) {
        if (done > 0) scheduleEmbedding(); // keep draining the backlog
      }).catch(function () { /* semantic layer is best-effort */ });
    }, 400);
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

    if (event.target.closest('.js-more')) {
      var moreRow = card.querySelector('.fav__more');
      moreRow.hidden = !moreRow.hidden;
      event.target.closest('.js-more').setAttribute('aria-expanded', String(!moreRow.hidden));
      return;
    }

    if (event.target.closest('.js-alert-seen')) {
      // One click marks every alert on this favourite as read; the chip
      // disappears when the storage change re-renders the list. The store
      // operates on the alerts as stored right now, not this render's
      // snapshot — the watcher may have written since.
      store.markAlertsSeen(id);
      return;
    }

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

  el.list.addEventListener('change', function (event) {
    var select = event.target.closest('.js-status');
    if (!select) return;
    var card = event.target.closest('.fav');
    store.update(card.dataset.id, { status: select.value });
  });

  el.list.addEventListener('keydown', function (event) {
    if (event.key !== 'Enter') return;
    if (!event.target.classList.contains('js-note-input') &&
        !event.target.classList.contains('js-sm-input')) return;
    var card = event.target.closest('.fav');
    saveNote(card, card.dataset.id);
  });

  function saveNote(card, id) {
    var note = card.querySelector('.js-note-input').value.trim();
    var smUrl = card.querySelector('.js-sm-input').value.trim();
    var fav = state.favourites.find(function (x) { return x.id === id; });
    var currentUrl = (fav && fav.sm && fav.sm.url) || '';

    var work = store.update(id, { note: note });

    if (smUrl && smUrl !== currentUrl) {
      // A pasted kit link: the worker fetches that one page for its details.
      work = work.then(function () {
        return new Promise(function (resolve) {
          chrome.runtime.sendMessage({ type: 'kkf:linkScalemates', id: id, url: smUrl }, resolve);
        });
      }).then(function (reply) {
        toast(reply && reply.ok
          ? 'Linked to Scalemates' + (reply.sm && reply.sm.year ? ' (' + reply.sm.year + ')' : '')
          : 'Could not link: ' + ((reply && reply.error) || 'no reply'));
      });
    } else if (!smUrl && currentUrl) {
      // Cleared: forget the link (and let automatic lookup have another go).
      work = work.then(function () { return store.update(id, { sm: null }); })
        .then(function () { toast('Scalemates link removed'); });
    } else {
      work = work.then(function () { toast(note ? 'Note saved' : 'Saved'); });
    }

    work.then(function () {
      var editor = card.querySelector('.fav__note-edit');
      if (editor) editor.hidden = true;
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

  FACETS.forEach(function (facet) {
    facet.el.addEventListener('change', function () {
      state.filters[facet.key] = facet.el.value;
      render();
    });
  });

  el.filterClear.addEventListener('click', function () {
    FACETS.forEach(function (facet) { state.filters[facet.key] = ''; });
    render();
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

  /**
   * One markdown bullet for the shareable list: title, first available price,
   * release year and URL, joined with em dashes; parts that are unknown are
   * simply left out, and a Scalemates link rides along when we have one.
   */
  function copyLine(fav) {
    // Titles come from scraped page data: collapse whitespace so an embedded
    // newline cannot forge extra bullets in the copied markdown.
    var flat = function (s) { return String(s || '').replace(/\s+/g, ' ').trim(); };
    var parts = [flat(fav.title) || fav.url];
    var price = (fav.prices || []).find(function (p) { return p && p.current; });
    if (price) parts.push(flat((price.label ? price.label + ' ' : '') + price.current));
    var year = releaseYear(fav);
    if (year !== null) parts.push(String(year));
    if (fav.url) parts.push(fav.url);
    var sm = fav.sm && fav.sm.status === 'matched' ? fav.sm : null;
    // Parentheses and whitespace in a URL would break out of the markdown
    // link; percent-encode them (a valid URL survives this unchanged).
    var smUrl = sm && sm.url ? String(sm.url)
      .replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/\s/g, '%20') : '';
    return '- ' + parts.join(' — ') + (smUrl ? ' ([Scalemates](' + smUrl + '))' : '');
  }

  el.copyBtn.addEventListener('click', function () {
    var visible = state.visible;
    if (!visible.length) return;
    if (!navigator.clipboard || !navigator.clipboard.writeText) {
      toast('The clipboard is not available here');
      return;
    }
    var lines = ['# KingKit favourites'];
    visible.forEach(function (fav) { lines.push(copyLine(fav)); });
    navigator.clipboard.writeText(lines.join('\n')).then(function () {
      toast('Copied ' + visible.length + (visible.length === 1 ? ' kit' : ' kits'));
    }).catch(function (err) {
      console.error('[KingKit Favourites] copy failed:', err);
      toast('Could not copy to the clipboard');
    });
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

  // Two-step confirmation with an arming delay — a native confirm() can
  // dismiss the popup, and an instant second step would make an accidental
  // double click destructive. The first click starts a red sweep across the
  // button; clicks during the sweep are ignored, and only once the button is
  // fully red does a click actually clear.
  var CLEAR_ARM_MS = 850;    // matches the background-size transition
  var CLEAR_RESET_MS = 4000; // armed window before falling back to idle
  var clearState = 'idle';   // 'idle' | 'arming' | 'armed'
  var clearArmTimer = null;
  var clearResetTimer = null;

  el.clearBtn.addEventListener('click', async function () {
    if (clearState === 'arming') return; // the accidental double click

    if (clearState === 'idle') {
      clearState = 'arming';
      el.clearBtn.textContent = 'Confirm clear';
      el.clearBtn.classList.add('is-confirming');
      // Force a reflow so the 0%-width fill is committed before the sweep
      // class lands — otherwise the transition can start from the end state.
      // (A reflow, not requestAnimationFrame: rAF never fires in a hidden
      // document, and correctness must not depend on rendering.)
      void el.clearBtn.offsetWidth;
      el.clearBtn.classList.add('is-arming');
      clearArmTimer = setTimeout(function () {
        clearState = 'armed';
        el.clearBtn.classList.add('is-armed');
        clearResetTimer = setTimeout(resetClear, CLEAR_RESET_MS);
      }, CLEAR_ARM_MS);
      return;
    }

    // Armed: this click is the confirmation.
    var backup = state.favourites.slice();
    resetClear();
    await store.clear();
    toast('Cleared ' + backup.length + ' favourites', function () {
      store.importAll(backup);
    });
  });

  function resetClear() {
    clearTimeout(clearArmTimer);
    clearTimeout(clearResetTimer);
    clearState = 'idle';
    el.clearBtn.classList.remove('is-confirming', 'is-arming', 'is-armed');
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

  var smEnabled = document.getElementById('sm-enabled');
  smEnabled.addEventListener('change', function () {
    store.setSettings({ scalemates: smEnabled.checked });
  });

  var watchEnabled = document.getElementById('watch-enabled');
  watchEnabled.addEventListener('change', function () {
    store.setSettings({ watch: watchEnabled.checked });
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
    smEnabled.checked = settings.scalemates !== false;
    watchEnabled.checked = settings.watch !== false;
    await load();
    el.search.focus();
  })();
})();
