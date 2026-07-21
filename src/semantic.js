/**
 * Dense-vector semantic search.
 *
 * Embeds each favourite's text once with a small sentence-embedding model
 * (all-MiniLM-L6-v2, 384 dimensions, int8-quantised ONNX) running locally via
 * the vendored Transformers.js + WASM runtime in vendor/ — no build step, no
 * remote code. The model weights (~24 MB) are fetched from the Hugging Face
 * hub on first use and cached by the browser thereafter.
 *
 * This layer is strictly additive: if the library fails to load (offline
 * first run, missing vendor files), callers get empty results and the
 * rules-based search carries on alone.
 *
 * Vectors are stored in chrome.storage.local ("kkfv:<id>"), never sync —
 * ~2 KB each would blow the sync quota, and they are cheap to recompute.
 */
(function (global) {
  'use strict';

  // all-MiniLM-L6-v2 is kept deliberately: benchmarked against
  // bge-small-en-v1.5 and gte-small on this corpus (11 probe queries, 5 kits,
  // 4 text configurations each) it won on every distribution-free metric —
  // top-1 ranking 8/9 vs 7/9, and roughly twice gte's separation margin
  // between right and wrong answers. Newer models' MTEB scores did not
  // transfer to short hobby-kit texts; their similarity distributions are
  // too compressed for thresholding.
  var MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
  var MODEL_TAG = 'minilm-l6-v2-q8-2v'; // bump to invalidate every stored vector
  var VEC_PREFIX = 'kkfv:';
  var DIM = 384;

  // A favourite is stored as TWO vectors — its subject sentence and its
  // descriptor sentence — and search takes the better of the two cosines.
  // Benchmarked as the best MiniLM configuration (recall of both British
  // WWII fighters for "battle of britain" instead of one). But a degenerate
  // descriptor ("military") lets the short subject vector inflate false
  // positives, so the split only applies when the descriptors are
  // substantive; otherwise one full-text vector is stored.
  var MIN_DESC_CHARS = 25;

  var pipelinePromise = null;   // resolves to embed(text)->Float32Array, or null
  var testEmbedder = null;

  /* ----------------------------------------------------------- utilities */

  /** FNV-1a — detects when a favourite's text changed and needs re-embedding. */
  function hash(text) {
    var h = 0x811c9dc5;
    for (var i = 0; i < text.length; i += 1) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(36);
  }

  function b64FromVec(vec) {
    var bytes = new Uint8Array(vec.buffer, vec.byteOffset, vec.byteLength);
    var s = '';
    for (var i = 0; i < bytes.length; i += 1) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }

  function vecFromB64(b64) {
    var s = atob(b64);
    var bytes = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i += 1) bytes[i] = s.charCodeAt(i);
    return new Float32Array(bytes.buffer);
  }

  /** Vectors are stored normalised, so cosine similarity is a dot product. */
  function cosine(a, b) {
    var n = Math.min(a.length, b.length);
    var dot = 0;
    for (var i = 0; i < n; i += 1) dot += a[i] * b[i];
    return dot;
  }

  function normalise(vec) {
    var sum = 0;
    for (var i = 0; i < vec.length; i += 1) sum += vec[i] * vec[i];
    var mag = Math.sqrt(sum) || 1;
    var out = new Float32Array(vec.length);
    for (var j = 0; j < vec.length; j += 1) out[j] = vec[j] / mag;
    return out;
  }

  /** Scalemates topic-flag codes -> nation words the model understands. */
  var NATIONS = {
    DR: 'german', D: 'german', GE: 'german', GB: 'british', UK: 'british',
    US: 'american', USA: 'american', JP: 'japanese', JAP: 'japanese',
    SU: 'soviet', RU: 'russian', IT: 'italian', FR: 'french', UA: 'ukrainian',
    PL: 'polish', CZ: 'czech', NL: 'dutch', SE: 'swedish', FI: 'finnish',
    AU: 'australian', CA: 'canadian', CN: 'chinese', IL: 'israeli',
    IN: 'indian', KR: 'korean', ES: 'spanish', AH: 'austro-hungarian'
  };

  /**
   * The text a favourite is embedded from. Deliberately short and
   * descriptive — subject, nation, era, topic, category — with catalogue
   * numbers, scales and brand boilerplate left out: mean pooling dilutes the
   * signal in long keyword soups, halving similarity scores (measured: a
   * "battle of britain" query scored 0.35 against a focused Spitfire text but
   * 0.16 against the kitchen-sink version). Exact tokens like numbers are the
   * rules tier's job.
   */
  /**
   * The two component texts a favourite is embedded from.
   * subject: the kit's canonical name ("junkers d.i (junkers j 9), short-fuselage version").
   * desc: everything descriptive — nation, era, topic path (reversed so
   * "Aircraft Propeller" reads as "propeller aircraft", which measurably
   * embeds better), the Markings operators and campaigns harvested from the
   * kit page, and the user's note. Catalogue numbers, scales, brands and
   * years stay out: keyword soups measurably halve similarities under mean
   * pooling, and exact tokens are the rules tier's job.
   */
  function textsFor(fav, facets) {
    var f = facets || {};
    var sm = fav.sm && fav.sm.status === 'matched' ? fav.sm : {};

    // Subject: Scalemates' canonical name, else the title minus brand/number.
    var subject = sm.subject || '';
    if (!subject) {
      if (typeof KKSM !== 'undefined') {
        subject = KKSM.parseTitle(fav).subject || fav.title || '';
      } else {
        subject = fav.title || '';
      }
    }
    if (sm.topicAlt) subject += ' (' + sm.topicAlt + ')';
    if (sm.variant) subject += ', ' + sm.variant;

    var descriptors = [
      NATIONS[sm.topicNation] || '',
      sm.era || '',
      (sm.topicPath || '').toLowerCase().split(' ').reverse().join(' ')
    ].filter(Boolean).join(' ');
    if (!descriptors && f.category) {
      // "Aircraft Model Kits" -> "aircraft", "Model Ships Kits" -> "ships"
      descriptors = f.category.replace(/\b(model|kits?)\b/gi, ' ')
        .replace(/\s+/g, ' ').trim().toLowerCase();
    }

    var desc = [descriptors, sm.operators, sm.campaigns, fav.note]
      .filter(Boolean).join('. ').toLowerCase();

    return {
      subject: subject.toLowerCase(),
      desc: desc,
      full: [subject.toLowerCase(), desc].filter(Boolean).join('. ')
    };
  }

  /** Single-string view of textsFor — used for hashing and by older tests. */
  function textFor(fav, facets) {
    return textsFor(fav, facets).full;
  }

  /* ------------------------------------------------------------ pipeline */

  function init() {
    if (testEmbedder) return Promise.resolve(testEmbedder);
    if (pipelinePromise) return pipelinePromise;

    pipelinePromise = (async function () {
      try {
        var lib = await import(chrome.runtime.getURL('vendor/transformers.min.js'));
        lib.env.allowLocalModels = false;
        lib.env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('vendor/');
        lib.env.backends.onnx.wasm.numThreads = 1; // extension pages lack COOP/COEP
        lib.env.backends.onnx.wasm.proxy = false;

        var extractor = await lib.pipeline('feature-extraction', MODEL_ID, {
          dtype: 'q8',
          device: 'wasm'
        });
        return async function embed(text) {
          var tensor = await extractor(String(text || ''), { pooling: 'mean', normalize: true });
          return new Float32Array(tensor.data);
        };
      } catch (err) {
        console.warn('[KingKit Favourites] semantic model unavailable:', err);
        return null;
      }
    })();
    return pipelinePromise;
  }

  function available() {
    return init().then(function (embed) { return Boolean(embed); });
  }

  /* ------------------------------------------------------ vector storage */

  async function storedVectors() {
    var bag;
    try {
      bag = await chrome.storage.local.get(null);
    } catch (err) {
      return new Map();
    }
    var map = new Map();
    Object.keys(bag).forEach(function (key) {
      if (key.indexOf(VEC_PREFIX) !== 0) return;
      var rec = bag[key];
      if (!rec || rec.m !== MODEL_TAG || !rec.v) return;
      map.set(key.slice(VEC_PREFIX.length), {
        h: rec.h,
        vec: vecFromB64(rec.v),
        subj: rec.s ? vecFromB64(rec.s) : null
      });
    });
    return map;
  }

  /**
   * Ensure every favourite has an up-to-date vector; the budget caps the
   * number of EMBEDDING CALLS per invocation (a two-vector favourite costs
   * two) so a manager session never grinds. Returns the number of calls
   * spent. Also prunes vectors for favourites that no longer exist —
   * including records left under older model tags, which storedVectors()
   * filters out but which would otherwise linger in storage forever.
   */
  async function ensureVectors(favs, facetsOf, budget) {
    var embed = await init();
    if (!embed) return 0;

    var have = await storedVectors();
    // Liveness is a property of the favourites list, not of loop progress:
    // an embedding failure must never cause live favourites' vectors to be
    // pruned below.
    var alive = new Set(favs.map(function (f) { return f.id; }));
    var done = 0;
    var max = budget || 20;

    for (var i = 0; i < favs.length; i += 1) {
      var fav = favs[i];
      var texts = textsFor(fav, facetsOf ? facetsOf(fav) : null);
      var h = hash(texts.subject + ' ' + texts.desc);
      var current = have.get(fav.id);
      if (current && current.h === h) continue;
      var cost = texts.desc.length >= MIN_DESC_CHARS ? 2 : 1;
      if (done + cost > max) continue;
      try {
        var record;
        if (cost === 2) {
          // Substantive descriptors: subject + descriptor vectors, best-of-two.
          var descVec = normalise(await embed(texts.desc));
          var subjVec = normalise(await embed(texts.subject));
          record = { m: MODEL_TAG, h: h, v: b64FromVec(descVec), s: b64FromVec(subjVec) };
        } else {
          // Thin descriptors: a lone short subject vector inflates false
          // positives, so store one full-text vector instead.
          var fullVec = normalise(await embed(texts.full));
          record = { m: MODEL_TAG, h: h, v: b64FromVec(fullVec) };
        }
        await chrome.storage.local.set({ [VEC_PREFIX + fav.id]: record });
        done += cost;
      } catch (err) {
        console.warn('[KingKit Favourites] embedding failed for', fav.id, err);
        break;
      }
    }

    // Prune vectors for removed favourites — inspect raw keys, not the
    // tag-filtered map, so obsolete-tag records are swept too.
    try {
      var bag = await chrome.storage.local.get(null);
      var stale = Object.keys(bag).filter(function (key) {
        return key.indexOf(VEC_PREFIX) === 0 && !alive.has(key.slice(VEC_PREFIX.length));
      });
      if (stale.length) await chrome.storage.local.remove(stale);
    } catch (err) { /* non-fatal */ }
    return done;
  }

  /** Similarities of every stored vector against the query: Map id -> cosine. */
  async function search(query) {
    var embed = await init();
    if (!embed) return new Map();
    var q;
    try {
      q = normalise(await embed(String(query || '').toLowerCase()));
    } catch (err) {
      return new Map();
    }
    var have = await storedVectors();
    var sims = new Map();
    have.forEach(function (rec, id) {
      var sim = cosine(q, rec.vec);
      if (rec.subj) sim = Math.max(sim, cosine(q, rec.subj));
      sims.set(id, sim);
    });
    return sims;
  }

  global.KKSem = {
    MODEL_ID: MODEL_ID,
    MODEL_TAG: MODEL_TAG,
    DIM: DIM,
    MIN_DESC_CHARS: MIN_DESC_CHARS,
    textsFor: textsFor,
    textFor: textFor,
    hash: hash,
    cosine: cosine,
    normalise: normalise,
    b64FromVec: b64FromVec,
    vecFromB64: vecFromB64,
    init: init,
    available: available,
    ensureVectors: ensureVectors,
    storedVectors: storedVectors,
    search: search,
    _setEmbedderForTests: function (fn) { testEmbedder = fn; pipelinePromise = null; }
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
