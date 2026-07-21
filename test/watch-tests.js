// Price & stock watcher (KKWatch) suite. Runs after the main suite has
// published window.__testSummary, appends its lines to the same #results
// panel and merges its counts into the summary.
(async function () {
  const out = [];
  const t = (name, cond, extra) => out.push((cond ? '[PASS] ' : '[FAIL] ') + name + (extra ? ' — ' + extra : ''));
  const wait = ms => new Promise(r => setTimeout(r, ms));

  for (let i = 0; i < 200 && !window.__testSummary; i++) await wait(100);

  const FX = window.WATCH_FIXTURES;
  const HOUR = 60 * 60 * 1000;

  /* ------------------------------------------ parsing real page fixtures */

  const takom = KKWatch.parsePrices(FX.PAGE_TAKOM_SALE);
  t('watch: discounted new-only page yields one New row', takom.length === 1 && takom[0].label === 'New',
    JSON.stringify(takom));
  t('watch: sale price, was price and stock note captured',
    takom[0].current === '£19.99' && takom[0].old === '£39.99' && takom[0].note === '3 in stock',
    JSON.stringify(takom[0]));

  const eduard = KKWatch.parsePrices(FX.PAGE_EDUARD_PREOWNED);
  t('watch: pre-owned-only page yields one Pre-owned row', eduard.length === 1 && eduard[0].label === 'Pre-owned',
    JSON.stringify(eduard));
  t('watch: pre-owned discount parsed',
    eduard[0].current === '£19.99' && eduard[0].old === '£34.99' && eduard[0].note === '10 in stock',
    JSON.stringify(eduard[0]));

  const skybow = KKWatch.parsePrices(FX.PAGE_SKYBOW_PLAIN);
  t('watch: undiscounted rrp price parsed with empty old',
    skybow.length === 1 && skybow[0].label === 'New' && skybow[0].current === '£12.99' &&
    skybow[0].old === '' && skybow[0].note === '7 in stock',
    JSON.stringify(skybow));

  t('watch: a gone page parses to no rows', KKWatch.parsePrices(FX.PAGE_GONE).length === 0);
  t('watch: gone page detected by missing product_id/product-page',
    KKWatch.looksGone(FX.PAGE_GONE) === true && KKWatch.looksGone(FX.PAGE_TAKOM_SALE) === false);
  t('watch: money parses thousands and rejects blanks',
    KKWatch.money('£1,299.99') === 1299.99 && KKWatch.money('') === null);

  /* --------------------------------------------------------------- diff */

  const row = (label, current, old, note) => ({ label, current, old: old || '', note: note || '' });

  const drop = KKWatch.diff([row('New', '£32.50')], [row('New', '£19.99', '£32.50', '1 in stock')]);
  t('watch: price drop detected', drop.length === 1 && drop[0].kind === 'price-drop' &&
    drop[0].label === 'New' && drop[0].from === '£32.50' && drop[0].to === '£19.99', JSON.stringify(drop));

  const rise = KKWatch.diff([row('Pre-owned', '£8.99')], [row('Pre-owned', '£12.99')]);
  t('watch: price rise detected', rise.length === 1 && rise[0].kind === 'price-rise' &&
    rise[0].from === '£8.99' && rise[0].to === '£12.99', JSON.stringify(rise));

  const restockAbsent = KKWatch.diff(
    [row('New', '£12.99', '', '1 in stock')],
    [row('New', '£12.99', '', '1 in stock'), row('Pre-owned', '£7.50', '', '1 in stock')]);
  t('watch: restock when a condition appears', restockAbsent.length === 1 &&
    restockAbsent[0].kind === 'restock' && restockAbsent[0].label === 'Pre-owned' &&
    restockAbsent[0].from === '' && restockAbsent[0].to === '£7.50', JSON.stringify(restockAbsent));

  const restockNoted = KKWatch.diff(
    [row('Pre-owned', '', '', 'Out of stock')],
    [row('Pre-owned', '£8.99', '', '2 in stock')]);
  t('watch: restock when previously noted out of stock', restockNoted.length === 1 &&
    restockNoted[0].kind === 'restock' && restockNoted[0].to === '£8.99', JSON.stringify(restockNoted));

  const oos = KKWatch.diff([row('New', '£19.99', '£39.99', '3 in stock')], []);
  t('watch: out-of-stock when a condition vanishes', oos.length === 1 &&
    oos[0].kind === 'out-of-stock' && oos[0].label === 'New' &&
    oos[0].from === '£19.99' && oos[0].to === '', JSON.stringify(oos));

  t('watch: identical rows raise nothing', KKWatch.diff(
    [row('New', '£19.99', '£39.99', '3 in stock')],
    [row('New', '£19.99', '£39.99', '3 in stock')]).length === 0);
  t('watch: a stock-count change alone raises nothing', KKWatch.diff(
    [row('New', '£19.99', '£39.99', '3 in stock')],
    [row('New', '£19.99', '£39.99', '1 in stock')]).length === 0);
  t('watch: first ever data raises nothing',
    KKWatch.diff(undefined, [row('New', '£19.99')]).length === 0 &&
    KKWatch.diff([], [row('New', '£19.99')]).length === 0);

  const both = KKWatch.diff(
    [row('New', '£39.99'), row('Pre-owned', '£5.00')],
    [row('New', '£19.99', '£39.99', '3 in stock')]);
  t('watch: one check can raise several alerts', both.length === 2 &&
    both[0].kind === 'price-drop' && both[1].kind === 'out-of-stock' && both[1].label === 'Pre-owned',
    JSON.stringify(both));

  /* ---------------------------------------------- check() with stub fetch */

  const page = (body, status) => async () => ({
    ok: (status || 200) >= 200 && (status || 200) < 300,
    status: status || 200,
    text: async () => body
  });
  const dead = async () => { throw new Error('network down'); };

  const favTakom = {
    id: '/product/takom-yamato', url: 'https://www.kingkit.co.uk/product/takom-yamato',
    title: 'TAKOM 1/16 01013 YAMATO ANCHORS',
    prices: [row('New', '£39.99', '', '3 in stock')]
  };

  const ok = await KKWatch.check(favTakom, page(FX.PAGE_TAKOM_SALE));
  t('watch: successful check stamps checkedAt and resets tries',
    ok.watch.checkedAt > 0 && ok.watch.tries === 0 && ok.watch.gone === false, JSON.stringify(ok.watch));
  t('watch: successful check raises the drop alert',
    ok.watch.alerts.length === 1 && ok.watch.alerts[0].kind === 'price-drop' &&
    ok.watch.alerts[0].from === '£39.99' && ok.watch.alerts[0].to === '£19.99' &&
    ok.watch.alerts[0].seen === false, JSON.stringify(ok.watch.alerts));
  t('watch: prices overwritten with the freshly parsed rows',
    JSON.stringify(ok.prices) === JSON.stringify([row('New', '£19.99', '£39.99', '3 in stock')]),
    JSON.stringify(ok.prices));

  // Contract shape: exactly what the manager codes against.
  t('watch: watch record carries the contract fields',
    typeof ok.watch.checkedAt === 'number' && typeof ok.watch.tries === 'number' &&
    typeof ok.watch.gone === 'boolean' && Array.isArray(ok.watch.alerts) && ok.watch.alerts.length <= 10);
  const alertKeys = Object.keys(ok.watch.alerts[0]).sort().join(',');
  t('watch: alert objects carry exactly the contract keys',
    alertKeys === 'at,from,kind,label,seen,to', alertKeys);
  t('watch: alert field types match the contract',
    typeof ok.watch.alerts[0].at === 'number' &&
    ['price-drop', 'price-rise', 'restock', 'out-of-stock', 'gone'].includes(ok.watch.alerts[0].kind) &&
    typeof ok.watch.alerts[0].from === 'string' && typeof ok.watch.alerts[0].to === 'string');

  const gone404 = await KKWatch.check(favTakom, page('Not found', 404));
  t('watch: 404 marks the favourite gone', gone404.watch.gone === true && gone404.prices === null);
  t('watch: 404 raises a gone alert', gone404.watch.alerts[0].kind === 'gone' &&
    gone404.watch.alerts[0].from === '' && gone404.watch.alerts[0].to === '' &&
    gone404.watch.alerts[0].label === '', JSON.stringify(gone404.watch.alerts[0]));

  const goneSoft = await KKWatch.check(favTakom, page(FX.PAGE_GONE));
  t('watch: a 200 redirect-to-homepage also counts as gone',
    goneSoft.watch.gone === true && goneSoft.watch.alerts[0].kind === 'gone');
  const goneAgain = await KKWatch.check(
    Object.assign({}, favTakom, { watch: goneSoft.watch }), page(FX.PAGE_GONE));
  t('watch: an already-gone favourite gains no second gone alert',
    goneAgain.watch.alerts.filter(a => a.kind === 'gone').length === 1);

  const err1 = await KKWatch.check(
    Object.assign({}, favTakom, { watch: { checkedAt: 123, tries: 0, gone: false, alerts: [] } }), dead);
  t('watch: network error increments tries and leaves prices alone',
    err1.watch.tries === 1 && err1.prices === null && err1.watch.gone === false, JSON.stringify(err1.watch));
  t('watch: network error preserves the last successful checkedAt', err1.watch.checkedAt === 123);
  const err2 = await KKWatch.check(Object.assign({}, favTakom, { watch: err1.watch }), dead);
  t('watch: consecutive failures accumulate', err2.watch.tries === 2);

  const throttled = await KKWatch.check(favTakom, page('', 403));
  t('watch: 403 asks the worker to pause', throttled.pauseWatch === true && throttled.watch.tries === 1);
  t('watch: plain http errors just count as a failed try',
    (await KKWatch.check(favTakom, page('', 500))).watch.tries === 1);

  /* ------------------------------------------------- needsCheck schedule */

  const now = Date.now();
  const watched = (patch) => ({ url: 'https://x/', watch: Object.assign(
    { checkedAt: 0, triedAt: 0, tries: 0, gone: false, alerts: [] }, patch) });

  t('watch: interval constant is 20 hours', KKWatch.CHECK_INTERVAL_MS === 20 * HOUR);
  t('watch: a never-checked favourite is due', KKWatch.needsCheck({ url: 'https://x/' }, now) === true);
  t('watch: a just-checked favourite is not due',
    KKWatch.needsCheck(watched({ checkedAt: now - HOUR, triedAt: now - HOUR }), now) === false);
  t('watch: due again after the interval',
    KKWatch.needsCheck(watched({ checkedAt: now - 21 * HOUR, triedAt: now - 21 * HOUR }), now) === true);
  t('watch: gone favourites are never checked again',
    KKWatch.needsCheck(watched({ gone: true }), now) === false);
  t('watch: a fresh failure is not retried immediately',
    KKWatch.needsCheck(watched({ tries: 1, triedAt: now - HOUR }), now) === false);
  t('watch: under five failures the daily cadence holds',
    KKWatch.needsCheck(watched({ tries: 4, triedAt: now - 21 * HOUR }), now) === true);
  t('watch: after five failures retries back off to a week',
    KKWatch.needsCheck(watched({ tries: 5, triedAt: now - 24 * HOUR }), now) === false &&
    KKWatch.needsCheck(watched({ tries: 5, triedAt: now - 8 * 24 * HOUR }), now) === true);
  t('watch: politeness constants match the Scalemates queue',
    KKWatch.GAP_MS === 4000 && KKWatch.MAX_PER_DRAIN === 10);

  /* --------------------------------------------------------- alert cap */

  const existing = Array.from({ length: 9 }, (_, i) =>
    ({ at: 9 - i, kind: 'price-rise', label: 'New', from: '£1.00', to: '£2.00', seen: true }));
  const capped = await KKWatch.check({
    id: '/product/x', url: 'https://www.kingkit.co.uk/product/x',
    prices: [row('New', '£39.99'), row('Pre-owned', '£5.00')],
    watch: { checkedAt: 1, tries: 0, gone: false, alerts: existing }
  }, page(FX.PAGE_TAKOM_SALE));
  t('watch: alerts are capped at ten', capped.watch.alerts.length === 10,
    String(capped.watch.alerts.length));
  t('watch: new alerts go in front, oldest fall off the end',
    capped.watch.alerts[0].kind === 'price-drop' && capped.watch.alerts[1].kind === 'out-of-stock' &&
    capped.watch.alerts[9].at === 2, JSON.stringify(capped.watch.alerts.map(a => a.at)));
  t('watch: seen flags on earlier alerts survive a check', capped.watch.alerts[2].seen === true);

  // settings default (added to DEFAULT_SETTINGS in storage.js)
  t('watch: settings default the watcher on', (await KKFav.getSettings()).watch === true);

  /* --------------------- all-out-of-stock pages (review regression) --- */
  // A page whose every condition is out of stock has the product wrapper and
  // the price block but NO basket forms (hence no product_id). It must not
  // be classified gone, or restocks could never be noticed.
  const PAGE_ALL_OOS =
    '<html><body><div class="product-page"><div class="row">' +
    '<div class="col-md-6 col-sm-6"><h1>SOLD OUT KIT</h1>' +
    '<div class="price-availability-block clearfix"><div class="price" style="width:100%;">' +
    '<div class="col-xs-12 col-sm-6 padleft0 newpriceblock">Out of stock</div>' +
    '</div></div></div></div></div></body></html>';
  t('watch: all-out-of-stock page is NOT gone', KKWatch.looksGone(PAGE_ALL_OOS) === false);
  const oosFav = { id: '/product/oos', url: 'https://www.kingkit.co.uk/product/oos',
    prices: [row('New', '£19.99')], watch: { checkedAt: 1, tries: 0, gone: false, alerts: [] } };
  const oosCheck = await KKWatch.check(oosFav, page(PAGE_ALL_OOS));
  t('watch: selling out raises out-of-stock, not gone',
    oosCheck.watch.gone === false && oosCheck.watch.alerts[0].kind === 'out-of-stock',
    JSON.stringify(oosCheck.watch.alerts));
  t('watch: sold-out page stores the availability row',
    oosCheck.prices.length === 1 && oosCheck.prices[0].note === 'Out of stock');
  const restocked = await KKWatch.check(
    Object.assign({}, oosFav, { prices: oosCheck.prices, watch: oosCheck.watch }),
    page(FX.PAGE_TAKOM_SALE));
  t('watch: a later restock is detected after the sold-out period',
    restocked.watch.gone === false && restocked.watch.alerts[0].kind === 'restock',
    JSON.stringify(restocked.watch.alerts.map(a => a.kind)));

  /* -------------------- fresh saves wait a full interval (regression) - */
  t('watch: a just-saved favourite is not due (save-time scrape is fresh)',
    KKWatch.needsCheck({ url: 'https://x/', addedAt: now - HOUR }, now) === false);
  t('watch: an old never-checked favourite is due',
    KKWatch.needsCheck({ url: 'https://x/', addedAt: now - 21 * HOUR }, now) === true);

  /* --------------------------------------------------------- reporting */

  const failures = out.filter(l => l.startsWith('[FAIL]'));
  const results = document.getElementById('results');
  results.insertAdjacentHTML('beforeend',
    out.map(l => `<div class="${l.startsWith('[PASS]') ? 'ok' : 'fail'}">${l.replace(/</g, '&lt;')}</div>`).join('') +
    `<div style="margin-top:10px;font-weight:700">watch: ${out.length - failures.length}/${out.length} passed</div>`);

  const sum = window.__testSummary || { total: 0, failed: 0, failures: [] };
  sum.total += out.length;
  sum.failed += failures.length;
  sum.failures = (sum.failures || []).concat(failures);
  window.__testSummary = sum;
  results.insertAdjacentHTML('beforeend',
    `<div style="margin-top:4px;font-weight:700">combined: ${sum.total - sum.failed}/${sum.total} passed</div>`);
})();
