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

  const failures = out.filter(l => l.startsWith('[FAIL]'));
  document.getElementById('results').innerHTML =
    out.map(l => `<div class="${l.startsWith('[PASS]') ? 'ok' : 'fail'}">${l.replace(/</g, '&lt;')}</div>`).join('') +
    `<div style="margin-top:10px;font-weight:700">${out.length - failures.length}/${out.length} passed</div>`;
  window.__testSummary = { total: out.length, failed: failures.length, failures };
})();
