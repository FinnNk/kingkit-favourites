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
  window.chrome.runtime = { getURL: p => './' + p.replace(/^src\//, ''), lastError: null };
  window.chrome.tabs = { create: o => { window.__lastTabCreate = o; } };
})();
