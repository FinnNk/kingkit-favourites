# KingKit Favourites

A Chrome extension that adds a "save for later" list to [kingkit.co.uk](https://www.kingkit.co.uk), which has no
built-in favouriting. Hover any product image, click the heart, and the kit is saved — with its title, thumbnail,
scale, and both the new and pre-owned prices — to a list you can search, annotate and manage from the toolbar.

Nothing is sent anywhere. Favourites live in Chrome's own storage and, by default, sync to any Chrome you are
signed into with the same Google account.

## Features

**On the KingKit site**

- **A heart on every product image.** It stays invisible until you hover the tile, so browsing looks unchanged —
  but once an item is saved the heart stays filled and visible, making it obvious at a glance which kits in a set
  of search results you have already saved.
- **Works everywhere products appear** — search and Kit Finder results, category listings, the homepage
  carousels, "related items", and the large image on a product page (which gets a labelled *Save* / *Saved*
  button instead of the small circular one).
- **One click, no navigation.** Clicking the heart never opens the product or triggers the tile link.
- **Undo.** Every save or removal shows a brief toast with an *Undo* button.
- **Captures the details worth keeping**: title, thumbnail, scale, category, product ID, and each price row
  including sale prices, the crossed-out original, and stock notes such as "Out of stock" or "3 in stock".

**In the favourites list** (click the toolbar icon)

- **Grid or list layout**, whichever you prefer — the choice is remembered.
- **Search** across titles, scales and your own notes.
- **Sort** by newest, oldest, title, or price (low–high / high–low).
- **Notes** — add a private reminder to any kit ("wanted for the winter build", "check postage").
- **Remove** individual items, or clear the whole list — both undoable.
- **Open in a full tab** for a wider, multi-column view when the list gets long.
- **Export / import** the list as JSON, for backups or moving between machines.
- **A badge** on the toolbar icon showing how many kits you have saved.
- **Dark mode**, following your system theme.

## Syncing across computers

By default favourites are written to `chrome.storage.sync`, so they follow your Google account to any Chrome you
are signed into — no account or server of mine involved. You can switch to device-only storage from the
**Storage** dropdown at the bottom of the list; switching moves the existing favourites across rather than
leaving them behind.

Chrome caps synced data at roughly 100 KB, which works out at somewhere around 250 kits. Each favourite is
stored under its own key rather than as one large blob, so you get the full quota instead of the ~8 KB
single-item limit. If Chrome ever refuses a sync write, the extension saves the favourite locally instead and
shows a banner explaining what happened — the item is never lost, and it still appears in your list.

## Installation

The extension is not on the Chrome Web Store, so it is loaded unpacked:

1. Download or clone this repository to somewhere permanent — Chrome loads the extension from this folder every
   time it starts, so don't put it in Downloads or a temp directory.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select this folder — the one containing `manifest.json`.
5. Optionally pin the heart icon to the toolbar via the puzzle-piece menu.

Visit [kingkit.co.uk](https://www.kingkit.co.uk) and hover a product image; a heart appears in the top-right
corner of the picture.

To update later, replace the folder contents and click the refresh icon on the extension's card in
`chrome://extensions`. Your favourites survive updates.

Chrome will show "Disable developer mode extensions" warnings on startup — that is expected for any unpacked
extension and safe to dismiss.

## Permissions

| Permission | Why |
| --- | --- |
| `storage` | To save your favourites and preferences. |
| `*://*.kingkit.co.uk/*` | To add the heart overlay to KingKit pages. The extension does not run on any other site. |

There are no network requests, no analytics, and no remote code. The only external content the extension loads
is the product thumbnails, fetched from kingkit.co.uk to display in your list; if one fails to load, a
placeholder is shown instead.

## Project layout

```
manifest.json         Manifest V3 definition
src/storage.js        Shared favourites store (content script, worker and manager all use it)
src/content.js        Injects the heart overlay and reads product details off the page
src/content.css       Overlay and toast styling
src/background.js     Service worker — keeps the toolbar badge count up to date
src/manager.html/.css/.js   The favourites list, used as both popup and full-tab page
test/harness.html     Offline test harness (see below)
tools/make-icons.ps1  Regenerates the PNG icons
```

### How it hooks into the site

KingKit renders server-side with a consistent structure, which the content script keys off:

- Every product tile is a `div.prodtile` containing `a.product-tile`, `.product-media img`, `.product-title`,
  `.product-details` and a `.price-block` of `.price-row`s.
- A product page has `.product-page` with `.product-main-image`, an `h1`, and one basket `<form>` per available
  condition, distinguished by a hidden `ptype` input (`new` / `preowned`) rather than by class.

The button is appended as a sibling of the tile's link (never inside it), clicks are handled by a single
delegated listener so that carousel-cloned tiles keep working, and a `MutationObserver` covers tiles added after
load. A favourite's identity is the normalised product URL path, so the same kit saved from a listing and from
its own page is one entry.

If KingKit changes its markup, `favFromTile` and `favFromProductPage` in [src/content.js](src/content.js) are the
two functions to update.

### Running the tests

`test/harness.html` mocks `chrome.storage` and runs the real `storage.js` and `content.js` against markup copied
verbatim from KingKit, covering overlay injection, data extraction, toggling, carousel clones, export/import,
the sync-quota fallback and storage migration. It needs to be served over HTTP rather than opened as a file:

```sh
python -m http.server 8000      # from the repository root
```

Then open <http://127.0.0.1:8000/test/harness.html>. Results are listed on the page, and a summary is available
as `window.__testSummary` in the console.

### Regenerating the icons

```sh
powershell -ExecutionPolicy Bypass -File tools/make-icons.ps1
```

## Troubleshooting

**No hearts appear.** Check the extension is enabled at `chrome://extensions` and reload the KingKit page. The
hearts are invisible until you hover a product tile.

**Favourites aren't syncing to another computer.** Both Chromes must be signed into the same Google account with
sync enabled for extension data, and the **Storage** dropdown must be set to "Synced to my Chrome account".
Sync is not instant — Chrome batches it.

**The list shows a storage banner.** Chrome's sync quota is full. Export a backup, remove some items, or switch
the Storage dropdown to "This device only".

**Thumbnails are blank.** The kit is still saved and the title links to the product; only the image failed to
load from kingkit.co.uk.
