/**
 * Scalemates lookup engine.
 *
 * Loaded by the service worker (importScripts) and by the test harness, so —
 * like storage.js — it exports onto the global object and touches no DOM API:
 * service workers have no DOMParser, hence the regex parsing.
 *
 * Design constraints, in order:
 *  1. Be a good guest. One favourite costs at most two search requests, ever:
 *     results (including "no match") are stored permanently, lookups run
 *     serially with a fixed gap, and a 403/429 pauses the whole queue with
 *     exponential backoff. Nothing is ever fetched speculatively.
 *  2. Never mislink. A wrong year on the wrong kit is worse than no year, so
 *     a candidate is only accepted when the catalogue number and brand agree,
 *     or the evidence is otherwise overwhelming. Anything weaker is left
 *     unmatched for manual linking.
 */
(function (global) {
  'use strict';

  var ORIGIN = 'https://www.scalemates.com';
  var GAP_MS = 4000;          // pause between any two requests
  var ERROR_BACKOFF_MS = 15 * 60 * 1000;
  var MAX_TRIES = 3;          // network-error retries per favourite (matched/nomatch are final)

  /* ------------------------------------------------------------ utilities */

  function decodeEntities(s) {
    return String(s || '')
      .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');
  }

  function norm(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  /** Catalogue numbers compare without brand prefixes or leading zeros:
      "SH48206" == "48206", "A08022" == "08022" == "8022". */
  function numKey(s) {
    return norm(s).replace(/^[a-z]+/, '').replace(/^0+/, '');
  }

  function tokens(s) {
    return String(s || '').toLowerCase()
      .replace(/mk\.?\s*/g, 'mk')      // Mk.V / Mk V / MkV agree
      .split(/[^a-z0-9]+/).filter(function (w) { return w.length > 1; });
  }

  /** Sørensen–Dice over word sets — order-free subject similarity. */
  function dice(a, b) {
    var A = new Set(tokens(a));
    var B = new Set(tokens(b));
    if (!A.size || !B.size) return 0;
    var inter = 0;
    A.forEach(function (t) { if (B.has(t)) inter += 1; });
    return (2 * inter) / (A.size + B.size);
  }

  /* -------------------------------------------------- KingKit title parse */

  /**
   * "RODEN 1/48 434 JUNKERS D.I (SHORT FUSELAGE)" ->
   *   {brand:'Roden'|'RODEN', scale:'1/48', number:'434', subject:'JUNKERS D.I (SHORT FUSELAGE)'}
   * The stored fav.brand (matched against KingKit's own manufacturer list) is
   * preferred; parsing only fills the gaps.
   */
  function parseTitle(fav) {
    var title = String(fav.title || '')
      .replace(/\s*-\s*SPECIAL OFFER PRICE\s*$/i, '')
      .replace(/\s*-\s*limited special offer\s*$/i, '')
      .trim();

    var brand = fav.brand || '';
    var rest = title;
    if (brand && title.toLowerCase().indexOf(brand.toLowerCase() + ' ') === 0) {
      rest = title.slice(brand.length).trim();
    } else if (!brand) {
      var firstWord = title.match(/^\S+/);
      brand = firstWord ? firstWord[0] : '';
      rest = title.slice(brand.length).trim();
    }

    var scaleMatch = rest.match(/^1\s*\/\s*(\d+(?:\.\d+)?)\s*/);
    var scale = fav.scale || (scaleMatch ? '1/' + scaleMatch[1] : '');
    if (scaleMatch) rest = rest.slice(scaleMatch[0].length);

    // Catalogue number: optional letter prefix, then digits (possibly with
    // dots/dashes), terminated by whitespace. "SH48206", "A08022", "01013".
    var numMatch = rest.match(/^([A-Za-z]{0,4}[-]?\d[\d.\-]*[A-Za-z]?)\s+/);
    var number = numMatch ? numMatch[1] : '';
    var subject = numMatch ? rest.slice(numMatch[0].length).trim() : rest.trim();

    return { brand: brand, scale: scale, number: number, subject: subject };
  }

  /* ------------------------------------------------- search HTML parsing */

  /**
   * Parse Scalemates search results. Each hit is one
   *   <div class="ac dg bgl cc pr"> ... </div>
   * block whose <img title="1:48 Junkers D.I (Roden 434)"> encodes scale,
   * subject, brand and number, with year / era / variant in sibling divs.
   * Result blocks are grouped under <h4> topic headers carrying the subject's
   * canonical name, alternative designation and group » category path — kept
   * as extra search fodder.
   */
  function parseSearchHtml(html) {
    var results = [];
    var pieces = String(html || '').split(/<div class="ac dg bgl cc pr">/);

    // Topic headers: track the last one preceding each result block.
    function topicBefore(prefix) {
      var m, last = null;
      var re = /<h4><a href="\/topics\/[^"]*"[^>]*>([^<]*)<\/a>\s*(?:<span class=ut>([^<]*)<\/span>)?([\s\S]*?)<\/h4>/g;
      while ((m = re.exec(prefix)) !== null) {
        var tail = m[3] || '';
        var path = [];
        var pm, pre = /fkGROUPS[^>]*>([^<]+)<\/a>|fkCATNAME[^>]*>([^<]+)<\/a>/g;
        while ((pm = pre.exec(tail)) !== null) path.push(decodeEntities(pm[1] || pm[2]));
        last = {
          name: decodeEntities(m[1]),
          alt: decodeEntities(m[2] || ''),
          path: path.join(' '),
          // The topic header's flag is the subject's nation (e.g. DR, GB, JP).
          nation: (tail.match(/flags[^"]*"[^>]*title="([A-Z]{2,3})"/) || [])[1] || '',
          year: (tail.match(/>\s*(\d{4})\s*<\/span>/) || [])[1] || ''
        };
      }
      return last;
    }

    var seenPrefix = pieces[0];
    for (var i = 1; i < pieces.length; i += 1) {
      var block = pieces[i];
      var topic = topicBefore(seenPrefix);
      seenPrefix += block; // headers appear between blocks too

      var href = (block.match(/href="(\/kits\/[a-z0-9._%-]+--\d+)"/i) || [])[1];
      if (!href) continue;

      var label = decodeEntities((block.match(/<img[^>]*title="([^"]*)"/i) || [])[1] || '');
      // "1:48 Junkers D.I (Roden 434)" — brand+number in the final parens.
      var lm = label.match(/^\s*(1:[\d.]+)?\s*(.*?)\s*\(([^()]*)\s+(\S+)\)\s*$/);

      results.push({
        url: ORIGIN + href,
        label: label,
        scale: (lm && lm[1]) || '',
        subject: (lm && lm[2]) || '',
        brand: (lm && lm[3]) || '',
        number: (lm && lm[4]) || '',
        year: (block.match(/<div class="nw bgd dib c">(\d{4})<\/div>/) || [])[1] || '',
        era: decodeEntities((block.match(/<div class=ut>([^<]{2,60})<\/div>/) || [])[1] || ''),
        variant: decodeEntities((block.match(/<span class=ut>([^<]{2,80})<\/span>/) || [])[1] || ''),
        topic: topic || null
      });
    }
    return results;
  }

  /* ------------------------------------------------------------- scoring */

  function scoreCandidate(parsed, cand) {
    var numberHit = Boolean(parsed.number && cand.number &&
      numKey(parsed.number) && numKey(parsed.number) === numKey(cand.number));
    var brandHit = Boolean(parsed.brand && cand.brand &&
      (norm(cand.brand) === norm(parsed.brand) ||
       norm(cand.brand).indexOf(norm(parsed.brand)) === 0 ||
       norm(parsed.brand).indexOf(norm(cand.brand)) === 0));
    var scaleHit = Boolean(parsed.scale && cand.scale &&
      parsed.scale.replace('/', ':') === cand.scale);
    var subjectSim = dice(parsed.subject,
      cand.subject + ' ' + cand.variant + ' ' + (cand.topic ? cand.topic.alt : ''));

    return {
      score: (numberHit ? 5 : 0) + (brandHit ? 3 : 0) + (scaleHit ? 1.5 : 0) + subjectSim * 3,
      numberHit: numberHit,
      brandHit: brandHit,
      scaleHit: scaleHit,
      subjectSim: subjectSim
    };
  }

  /**
   * Accept only when it could not reasonably be another kit:
   *  - catalogue number AND brand agree (the normal case), or
   *  - brand, scale and a strong subject similarity all agree.
   * Ties (reboxings under one number) prefer the earliest year — the
   * original release of that boxing.
   */
  function chooseMatch(parsed, candidates) {
    var scored = candidates.map(function (cand) {
      return { cand: cand, s: scoreCandidate(parsed, cand) };
    }).filter(function (x) {
      return (x.s.numberHit && x.s.brandHit) ||
             (x.s.brandHit && x.s.scaleHit && x.s.subjectSim >= 0.6);
    });
    if (!scored.length) return null;

    scored.sort(function (a, b) {
      if (b.s.score !== a.s.score) return b.s.score - a.s.score;
      var ya = parseInt(a.cand.year, 10) || 9999;
      var yb = parseInt(b.cand.year, 10) || 9999;
      return ya - yb;
    });
    return scored[0];
  }

  /* ------------------------------------------------------------- queries */

  /** Most-precise first; a hit stops the ladder. */
  function buildQueries(parsed) {
    var queries = [];
    if (parsed.brand && parsed.number) queries.push(parsed.brand + ' ' + parsed.number);
    if (parsed.brand && parsed.subject) {
      var words = parsed.subject.replace(/[()]/g, ' ').split(/\s+/)
        .filter(Boolean).slice(0, 3).join(' ');
      if (words) {
        queries.push(parsed.brand + ' ' + words +
          (parsed.scale ? ' ' + parsed.scale.replace('/', ':') : ''));
      }
    }
    return queries;
  }

  function searchUrl(query) {
    return ORIGIN + '/search.php?fkSECTION%5B%5D=Kits&q=' + encodeURIComponent(query);
  }

  /* ------------------------------------------------------- kit page parse */

  /** For manually pasted links: everything needed is in the page's meta. */
  function parseKitPage(html, url) {
    var s = String(html || '');
    var title = decodeEntities((s.match(/<meta property="og:title" content="([^"]*)"/) || [])[1] ||
      (s.match(/<title>([^<]*)<\/title>/) || [])[1] || '');
    var desc = decodeEntities((s.match(/<meta property="og:description" content="([^"]*)"/) || [])[1] || '');
    // "World War I Junkers D.I, Roden 434 (2007)"
    var tm = title.match(/^(.*?),\s*([^,]*?)\s+(\S+)\s+\((\d{4})\)\s*$/);
    return {
      url: url.split('#')[0].split('?')[0],
      label: title,
      subject: (tm && tm[1]) || title,
      brand: (tm && tm[2]) || '',
      number: (tm && tm[3]) || '',
      year: (tm && tm[4]) || (desc.match(/released in (\d{4})/) || [])[1] || '',
      scale: (desc.match(/scale (1:[\d.]+)/) || [])[1] || '',
      ean: (desc.match(/EAN:\s*([0-9]{8,14})/) || [])[1] || '',
      era: '',
      variant: '',
      topic: null
    };
  }

  /* ------------------------------------------------------ enrichment run */

  /** Shape stored on the favourite as fav.sm */
  function record(status, cand, extra) {
    var sm = Object.assign({ status: status, at: Date.now() }, extra || {});
    if (cand) {
      sm.url = cand.url;
      sm.year = cand.year || '';
      sm.subject = cand.subject || '';
      sm.brand = cand.brand || '';
      sm.number = cand.number || '';
      sm.scale = cand.scale || '';
      sm.era = cand.era || '';
      sm.variant = cand.variant || '';
      if (cand.ean) sm.ean = cand.ean;
      if (cand.topic) {
        sm.topicName = cand.topic.name || '';
        sm.topicAlt = cand.topic.alt || '';
        sm.topicPath = cand.topic.path || '';
        sm.topicYear = cand.topic.year || '';
        sm.topicNation = cand.topic.nation || '';
      }
    }
    return sm;
  }

  function needsLookup(fav) {
    if (!fav || !fav.title) return false;
    if (!fav.sm) return true;
    if (fav.sm.status === 'error') {
      return (fav.sm.tries || 0) < MAX_TRIES &&
             Date.now() - (fav.sm.at || 0) > ERROR_BACKOFF_MS;
    }
    return false; // matched and nomatch are permanent
  }

  /**
   * Look one favourite up. `fetchFn` is injected (real fetch in the worker, a
   * stub in tests). Returns the sm record to store; never throws.
   */
  async function lookup(fav, fetchFn, sleep) {
    var parsed = parseTitle(fav);
    var queries = buildQueries(parsed);
    if (!queries.length) return record('nomatch', null, { reason: 'unparseable' });

    var tries = ((fav.sm && fav.sm.tries) || 0) + 1;
    for (var i = 0; i < queries.length; i += 1) {
      if (i > 0 && sleep) await sleep(GAP_MS);
      var res;
      try {
        res = await fetchFn(searchUrl(queries[i]));
      } catch (err) {
        return record('error', null, { tries: tries, reason: 'network' });
      }
      if (res.status === 429 || res.status === 403) {
        return record('error', null, { tries: tries, reason: 'throttled', pauseQueue: true });
      }
      if (!res.ok) return record('error', null, { tries: tries, reason: 'http ' + res.status });

      var candidates = parseSearchHtml(await res.text());
      var best = chooseMatch(parsed, candidates);
      if (best) {
        return record('matched', best.cand, {
          score: Math.round(best.s.score * 100) / 100,
          query: queries[i]
        });
      }
    }
    return record('nomatch', null, { queries: queries.length });
  }

  global.KKSM = {
    ORIGIN: ORIGIN,
    GAP_MS: GAP_MS,
    parseTitle: parseTitle,
    parseSearchHtml: parseSearchHtml,
    parseKitPage: parseKitPage,
    scoreCandidate: scoreCandidate,
    chooseMatch: chooseMatch,
    buildQueries: buildQueries,
    searchUrl: searchUrl,
    needsLookup: needsLookup,
    lookup: lookup
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
