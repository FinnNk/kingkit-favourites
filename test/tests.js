(async function () {
  const out = [];
  const t = (name, cond, extra) => out.push((cond ? '[PASS] ' : '[FAIL] ') + name + (extra ? ' — ' + extra : ''));
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];

  await wait(250); // let injectAll + refresh settle

  // 1. injection
  const tiles = $$('.prodtile');
  const tileBtns = $$('.prodtile > .kkf-btn');
  t('a button is injected on every tile', tileBtns.length === tiles.length, `${tileBtns.length}/${tiles.length}`);
  t('buttons sit outside the product anchor', tileBtns.every(b => !b.closest('a')));
  t('hero button injected on product page', !!$('.product-main-image > .kkf-btn--large'));
  t('hero button is labelled "Save"', $('.kkf-btn--large .kkf-btn__label')?.textContent === 'Save');

  // 2. extracted payload
  const payload = JSON.parse(tileBtns[0].getAttribute('data-kkf'));
  t('id is the normalised product path', payload.id === '/product/takom-1-16-01013-yamato-anchors', payload.id);
  t('title extracted', /YAMATO ANCHORS/.test(payload.title));
  t('image extracted absolute', payload.image === 'https://www.kingkit.co.uk/uploads/shop/medium/TAK01013SPECIAL.jpg', payload.image);
  t('scale extracted', payload.details === '1/16 Scale', payload.details);
  t('two price rows extracted', payload.prices.length === 2, JSON.stringify(payload.prices));
  t('sale + was price captured', payload.prices[0].current === '£19.99' && payload.prices[0].old === '£39.99');
  t('out-of-stock note captured', payload.prices[1].note === 'Out of stock');

  const hero = JSON.parse($('.kkf-btn--large').getAttribute('data-kkf'));
  t('hero captures product_id', hero.productId === '99572', hero.productId);
  t('hero captures both conditions', hero.prices.length === 2, JSON.stringify(hero.prices));
  t('hero labels conditions from ptype', hero.prices[0].label === 'New' && hero.prices[1].label === 'Pre-owned');
  t('hero captures sale price + was price', hero.prices[0].current === '£19.99' && hero.prices[0].old === '£39.99');
  t('hero captures undiscounted rrp price', hero.prices[1].current === '£14.50' && hero.prices[1].old === '', JSON.stringify(hero.prices[1]));
  t('hero captures stock notes', hero.prices[0].note === '3 in stock' && hero.prices[1].note === '1 in stock');
  t('hero captures breadcrumb category', hero.details === 'Model Ships Kits', hero.details);

  // 3. clicking must not activate the tile link
  let navigated = false;
  $$('.prodtile a.product-tile').forEach(a => a.addEventListener('click', e => { navigated = true; e.preventDefault(); }));

  tileBtns[0].click();
  await wait(200);
  t('click did not trigger the product link', navigated === false);
  t('button shows saved state', tileBtns[0].classList.contains('is-fav'));
  t('aria-pressed reflects state', tileBtns[0].getAttribute('aria-pressed') === 'true');
  t('toast shown', !!$('.kkf-toast'));

  let saved = await KKFav.list();
  t('one record stored', saved.length === 1, String(saved.length));
  t('record has schema version + timestamp', saved[0].v === 2 && saved[0].addedAt > 0);
  t('stored in sync by default', Object.keys(chrome.storage.sync._bag).length === 1);

  // 4. toggle off
  tileBtns[0].click();
  await wait(200);
  t('toggle removes the record', (await KKFav.count()) === 0);
  t('button reverts to unsaved', !tileBtns[0].classList.contains('is-fav'));

  // 5. cloned tile (owl carousel clones markup, not listeners)
  const clone = tiles[1].cloneNode(true);
  document.querySelector('.pad15').appendChild(clone);
  await wait(120);
  t('clone is not double-injected', clone.querySelectorAll(':scope > .kkf-btn').length === 1,
    String(clone.querySelectorAll(':scope > .kkf-btn').length));
  clone.querySelector('.kkf-btn').click();
  await wait(200);
  t('cloned button still saves (delegation)', (await KKFav.count()) === 1);
  t('original tile repaints from storage', tiles[1].querySelector('.kkf-btn').classList.contains('is-fav'));

  // 6. hero button
  $('.kkf-btn--large').click();
  await wait(200);
  t('hero saves', (await KKFav.count()) === 2);
  t('hero label switches to Saved', $('.kkf-btn--large .kkf-btn__label').textContent === 'Saved');

  // 7. notes + update keeps addedAt
  const before = (await KKFav.list()).find(f => f.id === hero.id);
  await KKFav.update(hero.id, { note: 'for the winter build' });
  const after = (await KKFav.list()).find(f => f.id === hero.id);
  t('note persisted', after.note === 'for the winter build');
  t('update preserves addedAt', after.addedAt === before.addedAt);

  // 8. export / import round-trip
  const dump = await KKFav.exportAll();
  t('export has both records', dump.favourites.length === 2 && dump.format === 'kingkit-favourites');
  await KKFav.clear();
  t('clear empties the store', (await KKFav.count()) === 0);
  const imported = await KKFav.importAll(dump);
  t('import restores everything', imported.added === 2 && (await KKFav.count()) === 2, JSON.stringify(imported));
  const reimport = await KKFav.importAll(dump);
  t('re-import skips duplicates', reimport.added === 0 && reimport.skipped === 2, JSON.stringify(reimport));
  t('import rejects junk', await KKFav.importAll({ nope: 1 }).then(() => false, () => true));

  // 9. sync quota failure falls back to local
  chrome.storage.sync._failNext = true;
  await KKFav.add({ url: 'https://www.kingkit.co.uk/product/quota-test', title: 'Quota test' });
  const settings = await KKFav.getSettings();
  t('sync failure sets the fallback flag', settings.syncFallback === true);
  t('record landed in local instead', 'kkf:/product/quota-test' in chrome.storage.local._bag);
  t('fallback record still listed', (await KKFav.count()) === 3, String(await KKFav.count()));

  // 10. migrate between areas
  const moved = await KKFav.migrate('local');
  t('migrate reports the moved count', moved === 3, String(moved));
  t('sync emptied after migrate', Object.keys(chrome.storage.sync._bag).filter(k => k.startsWith('kkf:')).length === 0);
  t('everything still listed after migrate', (await KKFav.count()) === 3);
  t('migrate clears the fallback flag', (await KKFav.getSettings()).syncFallback === false);
  await KKFav.migrate('sync');
  t('migrate back to sync works', Object.keys(chrome.storage.sync._bag).filter(k => k.startsWith('kkf:')).length === 3);

  // 11. id normalisation
  t('trailing slash + case normalise to one id',
    KKFav.idFromUrl('https://www.kingkit.co.uk/product/ABC/') === KKFav.idFromUrl('https://www.kingkit.co.uk/product/abc'));

  // 12. site vocabulary harvesting
  for (let i = 0; i < 30 && KKFav.vocabIsStale(await KKFav.getVocab()); i++) await wait(100);
  const vocab = await KKFav.getVocab();
  t('vocabulary harvested', !!vocab && vocab.brands.length > 0);
  t('brands came from the ajax endpoint (not inlined on this page)',
    window.__fetchLog.some(u => u.includes('/ajax/get-brands.php')));
  t('"All …" placeholder options excluded',
    !vocab.brands.some(b => /^All /.test(b)) && !vocab.categories.some(c => /^All /.test(c)));
  t('categories read from the Kit Finder form',
    vocab.categories.includes('Aircraft Model Kits') && vocab.categories.length === 5, String(vocab.categories.length));
  t('vocabulary is stored locally, never synced',
    'kkf.vocab' in chrome.storage.local._bag && !('kkf.vocab' in chrome.storage.sync._bag));

  // 13. facet capture at save time
  await KKFav.clear();
  tileBtns[0].click();
  await wait(250);
  const rec = (await KKFav.list())[0];
  t('scale captured from the tile', rec.scale === '1/16', rec.scale);
  t('brand resolved from the vocabulary', rec.brand === 'Takom', rec.brand);

  // enrichment backfills what a listing tile cannot show
  for (let i = 0; i < 30 && !(await KKFav.get(rec.id)).category; i++) await wait(100);
  const enriched = await KKFav.get(rec.id);
  t('category backfilled from the product page', enriched.category === 'Aircraft Model Kits', enriched.category);
  t('product id backfilled too', enriched.productId === '55501', enriched.productId);
  t('enrichment preserves addedAt', enriched.addedAt === rec.addedAt);

  // 14. longest-prefix brand matching
  t('longest brand name wins over a shorter prefix',
    KKFav.matchBrand('SPECIAL HOBBY 1/48 SH48206 FIAT G.50', vocab.brands) === 'Special Hobby',
    KKFav.matchBrand('SPECIAL HOBBY 1/48 SH48206 FIAT G.50', vocab.brands));
  t('unknown manufacturer yields no match',
    KKFav.matchBrand('WOBBLEFIX 1/48 999 SOMETHING', vocab.brands) === '');

  // 15. scale parsing
  t('scale parsed from "1/16 Scale"', KKFav.parseScale('1/16 Scale') === '1/16');
  t('scale parsed from a title', KKFav.parseScale('ACADEMY 1/800 14213 USS NIMITZ') === '1/800');
  t('no scale in a scaleless title', KKFav.parseScale('ACADEMY 18129 DA VINCI CART') === '');

  // 16. facets derived for records saved before this feature existed
  const legacyTile = { title: 'AIRFIX 1/72 08022 JUNKERS JU52', details: '1/72 Scale' };
  const dTile = KKFav.facetsFor(legacyTile, vocab);
  t('legacy tile record yields brand + scale', dTile.brand === 'Airfix' && dTile.scale === '1/72', JSON.stringify(dTile));
  t('legacy tile record has no category', dTile.category === '');

  const legacyProduct = { title: 'TAKOM 1/16 01013 YAMATO ANCHORS', details: 'Model Ships Kits' };
  const dProduct = KKFav.facetsFor(legacyProduct, vocab);
  t('legacy product record recovers its category', dProduct.category === 'Model Ships Kits', dProduct.category);
  t('legacy product record still finds brand + scale',
    dProduct.brand === 'Takom' && dProduct.scale === '1/16', JSON.stringify(dProduct));

  t('a scale-like details value is not mistaken for a category',
    KKFav.facetsFor({ title: 'AIRFIX 1/72 X', details: '1/72 Scale' }, vocab).category === '');
  t('facets fall back to the title with no vocabulary',
    KKFav.facetsFor({ title: 'AIRFIX 1/72 08022 JUNKERS' }, null).brand === 'Airfix');

  /* ================= Scalemates engine (KKSM) ================= */
  const FX = window.SM_FIXTURES;

  // 17. KingKit title parsing
  const p1 = KKSM.parseTitle({ title: 'RODEN 1/48 434 JUNKERS D.I (SHORT FUSELAGE)', brand: 'Roden' });
  t('sm: title parses brand/scale/number/subject',
    p1.brand === 'Roden' && p1.scale === '1/48' && p1.number === '434' && /JUNKERS D\.I/.test(p1.subject),
    JSON.stringify(p1));
  const p2 = KKSM.parseTitle({ title: 'SPECIAL HOBBY 1/48 SH48206 REGGIANE RE.2005', brand: 'Special Hobby' });
  t('sm: prefixed catalogue number parsed', p2.number === 'SH48206', p2.number);
  const p3 = KKSM.parseTitle({ title: 'TAKOM 1/16 01013 YAMATO ANCHORS - SPECIAL OFFER PRICE', brand: 'Takom' });
  t('sm: sale suffix stripped before parsing', p3.subject === 'YAMATO ANCHORS', p3.subject);

  // 18. search result parsing (real captured HTML)
  const roden = KKSM.parseSearchHtml(FX.SEARCH_RODEN_434);
  t('sm: parses the roden result', roden.length === 1, String(roden.length));
  t('sm: extracts url/year/brand/number',
    roden[0].url === 'https://www.scalemates.com/kits/roden-434-junkers-di--122091' &&
    roden[0].year === '2007' && roden[0].brand === 'Roden' && roden[0].number === '434',
    JSON.stringify(roden[0]));
  t('sm: extracts era and variant', roden[0].era === 'World War I' && roden[0].variant === 'short-fuselage version');
  t('sm: topic header captured for semantic search',
    roden[0].topic && roden[0].topic.name === 'Junkers D.I' && roden[0].topic.alt === 'Junkers J 9' &&
    roden[0].topic.path === 'Aircraft Propeller', JSON.stringify(roden[0].topic));
  t('sm: subject nation read from the topic flag', roden[0].topic.nation === 'DR', roden[0].topic.nation);

  const sh = KKSM.parseSearchHtml(FX.SEARCH_SH_48206);
  t('sm: parses multiple boxings', sh.length === 2 && sh[0].year === '2021' && sh[1].year === '2020');
  t('sm: empty results parse to empty list', KKSM.parseSearchHtml(FX.SEARCH_EMPTY).length === 0);

  // 19. scoring and match choice
  const chosen = KKSM.chooseMatch(p1, roden);
  t('sm: exact match accepted with number+brand', !!chosen && chosen.s.numberHit && chosen.s.brandHit);

  const shChoice = KKSM.chooseMatch(p2, sh);
  t('sm: rebox tie broken by earliest year', shChoice && shChoice.cand.year === '2020', shChoice && shChoice.cand.year);
  t('sm: number normalisation matches SH48206 to 48206',
    !!KKSM.chooseMatch(KKSM.parseTitle({ title: 'SPECIAL HOBBY 1/48 48206 REGGIANE RE.2005', brand: 'Special Hobby' }), sh));

  const mixed = KKSM.parseSearchHtml(FX.SEARCH_MIXED_BRANDS);
  const academyPick = KKSM.chooseMatch(
    KKSM.parseTitle({ title: 'ACADEMY 1/48 2159 P-47D THUNDERBOLT', brand: 'Academy' }), mixed);
  t('sm: wrong-brand candidate (Eduard etch) rejected in favour of Academy',
    academyPick && /academy-2159/.test(academyPick.cand.url), academyPick && academyPick.cand.url);
  t('sm: subject-only similarity without brand agreement is rejected',
    KKSM.chooseMatch(KKSM.parseTitle({ title: 'HOBBYCRAFT 1/48 999 P-47D THUNDERBOLT' }), mixed) === null);

  // 20. query ladder
  const q1 = KKSM.buildQueries(p1);
  t('sm: primary query is brand + number', q1[0] === 'Roden 434', q1[0]);
  t('sm: fallback query is brand + subject words', /^Roden JUNKERS/.test(q1[1]), q1[1]);

  // 21. lookup flow with a stubbed fetch — no network
  const stub = bodyByCall => {
    let call = 0;
    const log = [];
    const fn = async url => {
      log.push(url);
      const body = bodyByCall[Math.min(call++, bodyByCall.length - 1)];
      if (body === 403) return { ok: false, status: 403, text: async () => '' };
      return { ok: true, status: 200, text: async () => body };
    };
    fn.log = log;
    return fn;
  };

  const favR = { title: 'RODEN 1/48 434 JUNKERS D.I (SHORT FUSELAGE)', brand: 'Roden', scale: '1/48' };
  const f1 = stub([FX.SEARCH_RODEN_434]);
  const sm1 = await KKSM.lookup(favR, f1, null);
  t('sm: lookup matches on the first query', sm1.status === 'matched' && sm1.year === '2007' && sm1.url.includes('122091'),
    JSON.stringify(sm1));
  t('sm: one request sufficed', f1.log.length === 1, String(f1.log.length));
  t('sm: search url shape', f1.log[0] === 'https://www.scalemates.com/search.php?fkSECTION%5B%5D=Kits&q=Roden%20434', f1.log[0]);
  t('sm: era and topic stored for search', sm1.era === 'World War I' && sm1.topicPath === 'Aircraft Propeller');

  const f2 = stub([FX.SEARCH_EMPTY, FX.SEARCH_RODEN_434]);
  const sm2 = await KKSM.lookup(favR, f2, null);
  t('sm: ladder falls through to the subject query', sm2.status === 'matched' && f2.log.length === 2);

  const f3 = stub([FX.SEARCH_EMPTY, FX.SEARCH_EMPTY]);
  const sm3 = await KKSM.lookup({ title: 'TAKOM 1/16 01013 YAMATO ANCHORS', brand: 'Takom' }, f3, null);
  t('sm: exhausted ladder yields permanent nomatch', sm3.status === 'nomatch');
  t('sm: nomatch is never retried', KKSM.needsLookup({ title: 'x', sm: sm3 }) === false);
  t('sm: matched is never retried', KKSM.needsLookup({ title: 'x', sm: sm1 }) === false);
  t('sm: missing sm means lookup needed', KKSM.needsLookup({ title: 'x' }) === true);

  const f4 = stub([403]);
  const sm4 = await KKSM.lookup(favR, f4, null);
  t('sm: 403 pauses the queue', sm4.status === 'error' && sm4.pauseQueue === true);
  t('sm: fresh error is not retried immediately', KKSM.needsLookup({ title: 'x', sm: sm4 }) === false);
  t('sm: stale error is retried', KKSM.needsLookup({ title: 'x', sm: Object.assign({}, sm4, { at: Date.now() - 16 * 60 * 1000 }) }) === true);
  t('sm: retries are capped', KKSM.needsLookup({ title: 'x', sm: { status: 'error', tries: 3, at: 0 } }) === false);

  // 22. kit page parsing (manual link)
  const kit = KKSM.parseKitPage(FX.KIT_PAGE_RODEN_434, 'https://www.scalemates.com/kits/roden-434-junkers-di--122091?utm=x');
  t('sm: kit page yields year/brand/number/scale/ean',
    kit.year === '2007' && kit.brand === 'Roden' && kit.number === '434' && kit.scale === '1:48' && kit.ean === '4823017700963',
    JSON.stringify(kit));
  t('sm: kit page url stripped of query', kit.url === 'https://www.scalemates.com/kits/roden-434-junkers-di--122091');

  /* ================= semantic layer (KKSem) ================= */

  // Deterministic fake embedder: bag-of-axes over a tiny lexicon, so related
  // words share an axis and cosine behaves like the real model in miniature.
  const AXES = { aircraft: 0, plane: 0, biplane: 0, junkers: 0, fokker: 0,
                 ship: 1, battleship: 1, yamato: 1, warship: 1,
                 truck: 2, lorry: 2, cargo: 2, m35a2: 2,
                 german: 3, japanese: 4, war: 5, i: 6, ii: 7 };
  const fakeEmbed = async text => {
    const v = new Float32Array(KKSem.DIM);
    String(text).toLowerCase().split(/[^a-z0-9]+/).forEach(w => {
      if (w in AXES) v[AXES[w]] += 1;
    });
    if (!v.some(x => x)) v[KKSem.DIM - 1] = 1e-4; // never a zero vector
    return v;
  };
  KKSem._setEmbedderForTests(fakeEmbed);

  // 23. primitives
  const rt = KKSem.vecFromB64(KKSem.b64FromVec(new Float32Array([0.25, -1.5, 3.75])));
  t('sem: base64 round-trip preserves float vectors', rt.length === 3 && rt[0] === 0.25 && rt[1] === -1.5 && rt[2] === 3.75);
  const nv = KKSem.normalise(new Float32Array([3, 4]));
  t('sem: normalise yields unit vectors', Math.abs(KKSem.cosine(nv, nv) - 1) < 1e-6);
  t('sem: hash changes with text', KKSem.hash('abc') !== KKSem.hash('abd'));

  // 24. embed text composition — short and descriptive by design: subject,
  // nation, era, topic; NO catalogue numbers, scales, brands or years, which
  // measurably dilute the vector (see comment in semantic.js).
  const embTxt = KKSem.textFor(
    { title: 'RODEN 1/48 434 JUNKERS D.I', note: 'gift idea',
      sm: { status: 'matched', era: 'World War I', subject: 'Junkers D.I', variant: 'short-fuselage version',
            topicAlt: 'Junkers J 9', topicPath: 'Aircraft Propeller', topicNation: 'DR', year: '2007' } },
    { brand: 'Roden', scale: '1/48', category: 'Aircraft Model Kits' });
  t('sem: embed text is subject + nation + era + topic + note',
    embTxt === 'junkers d.i (junkers j 9), short-fuselage version. german world war i propeller aircraft. gift idea',
    embTxt);
  t('sem: numbers, scale and year kept out of the vector',
    embTxt.indexOf('434') === -1 && embTxt.indexOf('1/48') === -1 && embTxt.indexOf('2007') === -1);
  t('sem: unmatched fav falls back to cleaned title + category',
    KKSem.textFor({ title: 'TAKOM 1/16 01013 JAPANESE NAVY BATTLESHIP YAMATO ANCHORS', brand: 'Takom' },
                  { category: 'Model Ships Kits' })
      === 'japanese navy battleship yamato anchors. ships');
  t('sem: unmatched sm contributes nothing',
    KKSem.textFor({ title: 'X', sm: { status: 'nomatch', era: 'SHOULD NOT APPEAR' } }, null).indexOf('appear') === -1);
  t('sem: unknown nation code degrades silently',
    KKSem.textFor({ title: 'Y', sm: { status: 'matched', subject: 'Thing', topicNation: 'ZZ', era: 'Modern' } }, null)
      === 'thing. modern');

  // 25. vector store lifecycle
  await chrome.storage.local.remove(
    Object.keys(chrome.storage.local._bag).filter(k => k.startsWith('kkfv:')));
  const semFavs = [
    { id: '/p/junkers', title: 'RODEN 434 JUNKERS BIPLANE', sm: null },
    { id: '/p/yamato', title: 'TAKOM YAMATO BATTLESHIP' },
    { id: '/p/truck', title: 'SKYBOW M35A2 CARGO TRUCK' }
  ];
  const nDone = await KKSem.ensureVectors(semFavs, null, 10);
  t('sem: ensureVectors embeds every new favourite', nDone === 3, String(nDone));
  let stored = await KKSem.storedVectors();
  t('sem: vectors persisted to local storage', stored.size === 3 &&
    Object.keys(chrome.storage.local._bag).filter(k => k.startsWith('kkfv:')).length === 3);
  t('sem: unchanged favourites are not re-embedded', (await KKSem.ensureVectors(semFavs, null, 10)) === 0);

  semFavs[0].title = 'RODEN 434 JUNKERS BIPLANE FIGHTER';
  t('sem: changed text is re-embedded', (await KKSem.ensureVectors(semFavs, null, 10)) === 1);

  t('sem: budget caps work per call', (await KKSem.ensureVectors(
    semFavs.map(f => ({ ...f, title: f.title + ' v2' })), null, 2)) === 2);

  const pruned = await KKSem.ensureVectors(semFavs.slice(0, 2), null, 10);
  stored = await KKSem.storedVectors();
  t('sem: vectors for removed favourites are pruned', !stored.has('/p/truck') && stored.size === 2, String(stored.size));

  // 26. search semantics via the fake model
  await KKSem.ensureVectors(semFavs, null, 10);
  const sims = await KKSem.search('lorry');
  t('sem: search returns a sim for every stored vector', sims.size === 3);
  t('sem: "lorry" lands on the truck via shared axis',
    sims.get('/p/truck') > 0.5 && sims.get('/p/truck') > (sims.get('/p/yamato') || 0) + 0.3,
    JSON.stringify([...sims].map(([k, v]) => k + ':' + v.toFixed(2))));
  const simsPlane = await KKSem.search('biplane');
  t('sem: "biplane" lands on the junkers', simsPlane.get('/p/junkers') > 0.5 && simsPlane.get('/p/junkers') > simsPlane.get('/p/truck'));

  // 27. graceful degradation without a model
  KKSem._setEmbedderForTests(null);
  const noModelInit = KKSem.init; // real init would try dynamic import; stub it
  KKSem._setEmbedderForTests(fakeEmbed); // restore for any later use

  const failures = out.filter(l => l.startsWith('[FAIL]'));
  document.getElementById('results').innerHTML =
    out.map(l => `<div class="${l.startsWith('[PASS]') ? 'ok' : 'fail'}">${l.replace(/</g, '&lt;')}</div>`).join('') +
    `<div style="margin-top:10px;font-weight:700">${out.length - failures.length}/${out.length} passed</div>`;
  window.__testSummary = { total: out.length, failed: failures.length, failures };
})();
