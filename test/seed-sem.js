// Seed data for the manager harness: a spread of eras, subjects and brands so
// both search tiers have something to bite on, plus statuses and price-watch
// data so the status, sorting and alert features are all visible. Loaded
// after mock-chrome.js.
(function () {
  var day = 86400000;
  var hour = 3600000;
  var now = Date.now();
  var thumb = function (c) {
    return "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='300' height='300'>" +
      "<rect width='300' height='300' fill='%23" + c + "'/></svg>";
  };

  var items = [
    { id: '/product/roden-aircraft-1-48-434-junkers-di-short-fuselage',
      title: 'RODEN 1/48 434 JUNKERS D.I (SHORT FUSELAGE)',
      brand: 'Roden', scale: '1/48', category: 'Aircraft Model Kits', image: thumb('a8b5c8'),
      addedAt: now - 2 * day,
      sm: { status: 'matched', at: now - day, url: 'https://www.scalemates.com/kits/roden-434-junkers-di--122091',
            year: '2007', subject: 'Junkers D.I', brand: 'Roden', number: '434', scale: '1:48',
            era: 'World War I', variant: 'short-fuselage version',
            topicName: 'Junkers D.I', topicAlt: 'Junkers J 9', topicPath: 'Aircraft Propeller', topicYear: '1918', topicNation: 'DR' },
      // The watcher spotted a price drop an hour ago; the stored prices
      // already reflect the new figure and the alert is still unread.
      prices: [{ label: 'New', current: '£14.99', old: '', note: '' }],
      watch: { checkedAt: now - hour, tries: 0, gone: false,
               alerts: [{ at: now - hour, kind: 'price-drop', label: 'New',
                          from: '£18.99', to: '£14.99', seen: false }] } },

    { id: '/product/airfix-1-48-spitfire-mkix',
      title: 'AIRFIX 1/48 A05126 SUPERMARINE SPITFIRE MK.IXC',
      brand: 'Airfix', scale: '1/48', category: 'Aircraft Model Kits', image: thumb('7fb3ad'),
      addedAt: now - 4 * day, status: 'bought',
      sm: { status: 'matched', at: now - day, url: 'https://www.scalemates.com/kits/airfix-a05126-spitfire--123456',
            year: '2015', subject: 'Supermarine Spitfire Mk.IXc', brand: 'Airfix', number: 'A05126', scale: '1:48',
            era: 'World War II', variant: '',
            topicName: 'Supermarine Spitfire', topicAlt: '', topicPath: 'Aircraft Propeller', topicYear: '1938', topicNation: 'GB' },
      prices: [{ label: 'New', current: '£24.99', old: '', note: '' }] },

    { id: '/product/takom-1-16-01013-yamato-anchors',
      title: 'TAKOM 1/16 01013 JAPANESE NAVY BATTLESHIP YAMATO ANCHORS',
      brand: 'Takom', scale: '1/16', category: 'Model Ships Kits', image: thumb('7c9cbf'),
      addedAt: now - 6 * day, note: 'anchors for the Yamato build',
      prices: [{ label: 'New', current: '£19.99', old: '£39.99', note: '' }] },

    { id: '/product/skybow-1-35-3505-m35a2',
      title: 'SKYBOW 1/35 3505 M35A2 2.5 TON CARGO TRUCK',
      brand: 'Skybow', scale: '1/35', category: 'Military Model Kits', image: thumb('c78d8d'),
      addedAt: now - 9 * day,
      prices: [{ label: 'Pre-owned', current: '£24.00', old: '', note: '' }],
      // Back in stock, and nobody has looked yet.
      watch: { checkedAt: now - hour, tries: 0, gone: false,
               alerts: [{ at: now - 2 * hour, kind: 'restock', label: 'Pre-owned',
                          from: '', to: '£24.00', seen: false }] } },

    { id: '/product/eduard-1-48-8021-hawker-tempest',
      title: 'EDUARD 1/48 8021 HAWKER TEMPEST Mk.V',
      brand: 'Eduard', scale: '1/48', category: 'Aircraft Model Kits', image: thumb('bfa0c9'),
      addedAt: now - 12 * day, status: 'built',
      // Watched, but every alert has already been read: no chip on this card.
      watch: { checkedAt: now - hour, tries: 0, gone: false,
               alerts: [{ at: now - 3 * day, kind: 'price-rise', label: 'Pre-owned',
                          from: '£17.99', to: '£19.99', seen: true }] },
      sm: { status: 'matched', at: now - day, url: 'https://www.scalemates.com/kits/eduard-8021-hawker-tempest-mkv--197945',
            year: '1997', subject: 'Hawker Tempest Mk.V', brand: 'Eduard', number: '8021', scale: '1:48',
            era: 'World War II', variant: '', topicName: 'Hawker Tempest', topicAlt: '', topicPath: 'Aircraft Propeller', topicNation: 'GB' },
      prices: [{ label: 'Pre-owned', current: '£19.99', old: '£34.99', note: '' }] }
  ];

  items.forEach(function (it) {
    it.url = 'https://www.kingkit.co.uk' + it.id;
    chrome.storage.sync._bag['kkf:' + it.id] = Object.assign({ v: 2 }, it);
  });

  chrome.storage.local._bag['kkf.vocab'] = {
    brands: ['Airfix', 'Eduard', 'Roden', 'Skybow', 'Takom'],
    categories: ['Aircraft Model Kits', 'Military Model Kits', 'Model Ships Kits'],
    fetchedAt: Date.now()
  };
})();
