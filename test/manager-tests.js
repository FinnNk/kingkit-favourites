// UI regression tests for the manager page. Loaded last by
// make-manager-harness.py and inert unless the page URL carries ?autotest=1:
//
//   python test/make-manager-harness.py
//   python tools/serve.py 8770
//   -> http://127.0.0.1:8770/test/manager-harness.html?autotest=1
//
// Results land in a <pre id="autotest"> appended to the body, one
// [PASS]/[FAIL] line per assertion, so a headless --dump-dom can grep them.
(async function () {
  if (!/[?&]autotest=1(&|$)/.test(location.search)) return;

  // The semantic tier is deliberately neutralised: these tests exercise the
  // rules tier and the widgets, and must not depend on model downloads or on
  // what a live embedding happens to think of the seed titles.
  if (window.KKSem) {
    KKSem.search = () => Promise.resolve(new Map());
    KKSem.ensureVectors = () => Promise.resolve(0);
  }

  const out = [];
  const t = (name, cond, extra) =>
    out.push((cond ? '[PASS] ' : '[FAIL] ') + name + (!cond && extra ? ' — ' + extra : ''));
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];

  async function waitFor(predicate, label, timeout = 3000) {
    const deadline = Date.now() + timeout;
    for (;;) {
      let value;
      try { value = await predicate(); } catch (err) { value = false; }
      if (value) return true;
      if (Date.now() > deadline) { out.push('[FAIL] ' + label + ' — timed out'); return false; }
      await wait(50);
    }
  }

  const cardIds = () => $$('#list .fav').map(n => n.dataset.id);
  const card = id => $(`#list .fav[data-id="${id}"]`);
  const facetTexts = sel => [...sel.options].map(o => o.textContent);
  const setSelect = (sel, value) => {
    sel.value = value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const setSearch = value => {
    const box = $('#search');
    box.value = value;
    box.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  const RODEN = '/product/roden-aircraft-1-48-434-junkers-di-short-fuselage';
  const AIRFIX = '/product/airfix-1-48-spitfire-mkix';
  const TAKOM = '/product/takom-1-16-01013-yamato-anchors';
  const SKYBOW = '/product/skybow-1-35-3505-m35a2';
  const EDUARD = '/product/eduard-1-48-8021-hawker-tempest';

  await wait(600); // let the manager boot and paint the seed data

  /* ------------------------------------------------------------- boot */

  t('all five seeded favourites render', cardIds().length === 5, String(cardIds().length));

  /* ----------------------------------------------------------- status */

  t('every card carries a status select', $$('#list .fav .js-status').length === 5,
    String($$('#list .fav .js-status').length));
  t('status selects reflect stored statuses',
    card(RODEN).querySelector('.js-status').value === 'wanted' &&
    card(AIRFIX).querySelector('.js-status').value === 'bought' &&
    card(EDUARD).querySelector('.js-status').value === 'built');
  t('bought/built selects are tinted, wanted is not',
    card(AIRFIX).querySelector('.js-status').classList.contains('is-bought') &&
    card(EDUARD).querySelector('.js-status').classList.contains('is-built') &&
    !card(RODEN).querySelector('.js-status').classList.contains('is-bought') &&
    !card(RODEN).querySelector('.js-status').classList.contains('is-built'));

  t('status facet lists capitalised counts in lifecycle order',
    same(facetTexts($('#f-status')), ['All statuses', 'Wanted (3)', 'Bought (1)', 'Built (1)']),
    JSON.stringify(facetTexts($('#f-status'))));

  setSelect(card(RODEN).querySelector('.js-status'), 'bought');
  t('changing a card status persists it',
    await waitFor(async () => (await KKFav.get(RODEN)).status === 'bought', 'roden status -> bought') &&
    (await KKFav.get(RODEN)).status === 'bought');
  t('status change updates the facet counts',
    await waitFor(() => same(facetTexts($('#f-status')),
      ['All statuses', 'Wanted (2)', 'Bought (2)', 'Built (1)']), 'facet counts after change'));

  setSelect(card(RODEN).querySelector('.js-status'), 'wanted');
  t('a status can be set back to wanted',
    await waitFor(() => same(facetTexts($('#f-status')),
      ['All statuses', 'Wanted (3)', 'Bought (1)', 'Built (1)']), 'facet counts after revert'));

  setSelect($('#f-status'), 'built');
  await waitFor(() => cardIds().length === 1, 'status filter narrows the list');
  t('status facet filters the list', same(cardIds(), [EDUARD]), JSON.stringify(cardIds()));
  t('active status filter shows the clear button', !$('#f-clear').hidden);
  $('#f-clear').click();
  await waitFor(() => cardIds().length === 5, 'clear restores the list');
  t('clear resets the status facet', $('#f-status').value === '' && cardIds().length === 5);

  await KKFav.update(EDUARD, { status: 'wanted' });
  t('facet offers only statuses actually present',
    await waitFor(() => same(facetTexts($('#f-status')),
      ['All statuses', 'Wanted (4)', 'Bought (1)']), 'built vanishes from the facet'));
  await KKFav.update(EDUARD, { status: 'built' });
  await waitFor(() => facetTexts($('#f-status')).includes('Built (1)'), 'built returns to the facet');

  /* ------------------------------------------------------- year sort */

  setSelect($('#sort'), 'year-desc');
  await waitFor(() => cardIds()[0] === AIRFIX, 'year-desc re-renders');
  t('year-desc: newest year first, yearless kits last',
    same(cardIds(), [AIRFIX, RODEN, EDUARD, TAKOM, SKYBOW]), JSON.stringify(cardIds()));

  setSelect($('#sort'), 'year-asc');
  await waitFor(() => cardIds()[0] === EDUARD, 'year-asc re-renders');
  t('year-asc: oldest year first, yearless kits still last',
    same(cardIds(), [EDUARD, RODEN, AIRFIX, TAKOM, SKYBOW]), JSON.stringify(cardIds()));

  /* ------------------------------------------------------------- copy */

  setSelect($('#sort'), 'year-desc');
  await waitFor(() => cardIds()[0] === AIRFIX, 'year-desc again for a stable copy order');

  const copyBtn = $('#copy');
  t('copy button exists and is enabled', !!copyBtn && !copyBtn.disabled);

  let clipped = null;
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: text => { clipped = text; return Promise.resolve(); } }
  });

  copyBtn.click();
  await waitFor(() => clipped !== null, 'clipboard captured');

  const expected = [
    '# KingKit favourites',
    '- AIRFIX 1/48 A05126 SUPERMARINE SPITFIRE MK.IXC — New £24.99 — 2015 — https://www.kingkit.co.uk/product/airfix-1-48-spitfire-mkix ([Scalemates](https://www.scalemates.com/kits/airfix-a05126-spitfire--123456))',
    '- RODEN 1/48 434 JUNKERS D.I (SHORT FUSELAGE) — New £14.99 — 2007 — https://www.kingkit.co.uk/product/roden-aircraft-1-48-434-junkers-di-short-fuselage ([Scalemates](https://www.scalemates.com/kits/roden-434-junkers-di--122091))',
    '- EDUARD 1/48 8021 HAWKER TEMPEST Mk.V — Pre-owned £19.99 — 1997 — https://www.kingkit.co.uk/product/eduard-1-48-8021-hawker-tempest ([Scalemates](https://www.scalemates.com/kits/eduard-8021-hawker-tempest-mkv--197945))',
    '- TAKOM 1/16 01013 JAPANESE NAVY BATTLESHIP YAMATO ANCHORS — New £19.99 — https://www.kingkit.co.uk/product/takom-1-16-01013-yamato-anchors',
    '- SKYBOW 1/35 3505 M35A2 2.5 TON CARGO TRUCK — Pre-owned £24.00 — https://www.kingkit.co.uk/product/skybow-1-35-3505-m35a2'
  ].join('\n');
  t('copy produces the expected markdown', clipped === expected, JSON.stringify(clipped));
  t('copy shows a counting toast', $('#toast-text').textContent === 'Copied 5 kits',
    $('#toast-text').textContent);

  setSearch('zzz-no-such-kit');
  await waitFor(() => cardIds().length === 0, 'nonsense search empties the list');
  t('copy is disabled when nothing is visible', copyBtn.disabled);
  setSearch('');
  await waitFor(() => cardIds().length === 5, 'clearing the search restores the list');

  /* ----------------------------------------------------- alert chips */

  const rodenChip = card(RODEN).querySelector('.fav__alert');
  t('price-drop chip renders with label, arrow and old price',
    !!rodenChip && rodenChip.classList.contains('fav__alert--drop') &&
    rodenChip.querySelector('.fav__alert-text').textContent === 'New ↓ £14.99 (was £18.99)',
    rodenChip && rodenChip.querySelector('.fav__alert-text').textContent);

  const skybowChip = card(SKYBOW).querySelector('.fav__alert');
  t('restock chip renders with its label',
    !!skybowChip && skybowChip.classList.contains('fav__alert--restock') &&
    skybowChip.querySelector('.fav__alert-text').textContent === 'Pre-owned back in stock',
    skybowChip && skybowChip.querySelector('.fav__alert-text').textContent);

  t('a card whose alerts are all seen shows no chip', !card(EDUARD).querySelector('.fav__alert'));
  t('a card without watch data shows no chip', !card(TAKOM).querySelector('.fav__alert'));

  card(RODEN).querySelector('.js-alert-seen').click();
  t('dismissing a chip marks every alert seen',
    await waitFor(async () => {
      const fav = await KKFav.get(RODEN);
      return fav.watch.alerts.length === 1 && fav.watch.alerts.every(a => a.seen === true);
    }, 'roden alerts -> seen'));
  t('dismissed chip disappears from the card',
    await waitFor(() => !card(RODEN).querySelector('.fav__alert'), 'roden chip gone'));

  /* ------------------------------------------- existing behaviour */

  setSearch('yamato');
  await waitFor(() => cardIds().length === 1, 'search narrows to one card');
  t('search box still filters', same(cardIds(), [TAKOM]), JSON.stringify(cardIds()));
  setSearch('');
  await waitFor(() => cardIds().length === 5, 'search cleared again');

  setSelect($('#f-brand'), 'Airfix');
  await waitFor(() => cardIds().length === 1, 'brand filter narrows the list');
  t('brand facet still filters', same(cardIds(), [AIRFIX]), JSON.stringify(cardIds()));
  $('#f-clear').click();
  await waitFor(() => cardIds().length === 5, 'facet clear still works');
  t('facet clear still resets everything', $('#f-brand').value === '' && cardIds().length === 5);

  /* ------------------------------------------- find more like this */

  const moreBtn = card(RODEN).querySelector('.js-more');
  t('more-like-this button renders on cards', !!moreBtn);
  t('more row starts hidden', card(RODEN).querySelector('.fav__more').hidden === true);
  moreBtn.click();
  t('more button reveals the links row',
    await waitFor(() => card(RODEN).querySelector('.fav__more').hidden === false, 'more row visible'));
  t('more button reports expanded state',
    card(RODEN).querySelector('.js-more').getAttribute('aria-expanded') === 'true');

  const kkHref = card(RODEN).querySelector('.js-more-kingkit').href;
  t('KingKit link is a pre-filled Kit Finder search (brand id + caret scale)',
    kkHref.indexOf('search=kitfinder') !== -1 && kkHref.indexOf('brand=412') !== -1 &&
    (kkHref.indexOf('scale=1%5E48') !== -1 || kkHref.indexOf('scale=1^48') !== -1), kkHref);
  const smHref = card(RODEN).querySelector('.js-more-scalemates').href;
  t('Scalemates link uses the topic page when known',
    smHref === 'https://www.scalemates.com/topics/topic.php?id=2660', smHref);
  t('more links open in a new tab',
    card(RODEN).querySelector('.js-more-kingkit').target === '_blank');

  const smFallback = card(EDUARD).querySelector('.js-more-scalemates').href;
  t('Scalemates link falls back to a subject search without a topic url',
    smFallback.indexOf('search.php') !== -1 && smFallback.indexOf('Hawker%20Tempest') !== -1, smFallback);

  const kkFallback = card(TAKOM).querySelector('.js-more-kingkit').href;
  t('KingKit link falls back to a subject text search for an id-less brand',
    kkFallback.indexOf('search=text') !== -1 &&
    kkFallback.indexOf('JAPANESE%20NAVY%20BATTLESHIP%20YAMATO') !== -1, kkFallback);

  card(RODEN).querySelector('.js-more').click();
  t('more button toggles the row closed again',
    await waitFor(() => card(RODEN).querySelector('.fav__more').hidden === true, 'more row hidden'));

  /* ---------------------------------------------------------- report */

  const passed = out.filter(line => line.startsWith('[PASS]')).length;
  const pre = document.createElement('pre');
  pre.id = 'autotest';
  pre.textContent = out.join('\n') + '\nAUTOTEST ' + passed + '/' + out.length + ' passed';
  document.body.appendChild(pre);
})();
