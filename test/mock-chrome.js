// Minimal chrome.* mock so the extension source can be exercised on a plain page.
(function () {
  function makeArea(name, quota) {
    var bag = {};
    var area = {
      QUOTA_BYTES: quota,
      _bag: bag,
      async get(keys) {
        if (keys === null || keys === undefined) return JSON.parse(JSON.stringify(bag));
        if (typeof keys === 'string') { var o = {}; if (keys in bag) o[keys] = bag[keys]; return o; }
        if (Array.isArray(keys)) { var r = {}; keys.forEach(k => { if (k in bag) r[k] = bag[k]; }); return r; }
        return JSON.parse(JSON.stringify(bag));
      },
      async set(obj) {
        var changes = {};
        Object.keys(obj).forEach(k => { changes[k] = { oldValue: bag[k], newValue: obj[k] }; bag[k] = obj[k]; });
        if (area._failNext) { area._failNext = false; throw new Error('QUOTA_BYTES quota exceeded'); }
        fire(changes, name);
      },
      async remove(keys) {
        var list = Array.isArray(keys) ? keys : [keys];
        var changes = {};
        list.forEach(k => { if (k in bag) { changes[k] = { oldValue: bag[k] }; delete bag[k]; } });
        if (Object.keys(changes).length) fire(changes, name);
      },
      async clear() { Object.keys(bag).forEach(k => delete bag[k]); fire({}, name); },
      async getBytesInUse() { return new Blob([JSON.stringify(bag)]).size; }
    };
    return area;
  }

  var listeners = [];
  function fire(changes, areaName) {
    listeners.slice().forEach(fn => { try { fn(changes, areaName); } catch (e) { console.error(e); } });
  }

  window.chrome = window.chrome || {};
  window.chrome.storage = {
    local: makeArea('local', 10485760),
    sync: makeArea('sync', 102400),
    onChanged: {
      addListener(fn) { listeners.push(fn); },
      removeListener(fn) { listeners = listeners.filter(f => f !== fn); }
    }
  };
  window.chrome.runtime = {
    getURL: p => './' + p.replace(/^src\//, ''),
    lastError: null,
    // Simulates the worker's manual-link handler when the engine + fixtures
    // are loaded on the page (manager tests).
    sendMessage(msg, cb) {
      window.__lastMessage = msg;
      if (msg && msg.type === 'kkf:linkScalemates' && window.KKSM && window.SM_FIXTURES) {
        const cand = window.KKSM.parseKitPage(window.SM_FIXTURES.KIT_PAGE_RODEN_434, msg.url);
        const sm = Object.assign({ status: 'matched', at: Date.now(), manual: true }, cand);
        window.KKFav.update(msg.id, { sm }).then(() => cb && cb({ ok: true, sm }));
        return;
      }
      cb && cb({ ok: false, error: 'no handler' });
    }
  };
  window.chrome.tabs = { create: o => { window.__lastTabCreate = o; } };

  // Stub the two same-origin requests the content script makes: the brand list
  // endpoint, and the product page it reads a category off after a save.
  window.__fetchLog = [];
  const realFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    const url = String(input);
    window.__fetchLog.push(url);
    if (url.includes('/ajax/get-brands.php')) {
      return Promise.resolve(new Response(
        "<option value=''>All Manufacturers</option>" +
        ['Academy', 'Airfix', 'Eduard', 'Skybow', 'Special', 'Special Hobby', 'Takom']
          .map((b, i) => `<option value='${i}'>${b}</option>`).join(''),
        { status: 200, headers: { 'Content-Type': 'text/html' } }));
    }
    if (url.includes('/product/')) {
      return Promise.resolve(new Response(
        '<html><body><div class="product-page">' +
        '<input type="hidden" name="product_id" value="55501">' +
        '</div><ol class="breadcrumb"><li><a>Home</a></li><li><a>Aircraft Model Kits</a></li>' +
        '<li>Sale items</li><li>A KIT</li></ol></body></html>',
        { status: 200, headers: { 'Content-Type': 'text/html' } }));
    }
    return realFetch(input, init);
  };
})();
