# Browser extension

Right-click any image on any site, choose **Check image for AI**, and the verdict appears in a side panel. It runs
the website's models and code, on the user's device: nothing is uploaded.

Works in Chrome, Brave and Edge (side panel), and in Firefox (sidebar). It also works on sites that cover their
images with transparent layers, such as Instagram.

## Build

```sh
npm install              # at the repo root first: the extension uses the website's packages
cd extension
npm install
npm run build            # Chrome, Brave, Edge → dist/chrome-mv3/
npm run build:firefox    # Firefox → dist/firefox-mv3/
```

Needs Node 20.12 or later (WXT 0.20; WXT 0.21 needs Node 22). The model weights must be in `public/models/<id>/`,
as for the website (see the root README).

## Try it

- **Chrome, Brave, Edge**: open `chrome://extensions` (`brave://extensions`, `edge://extensions`), turn on
  Developer mode, click **Load unpacked** and pick `extension/dist/chrome-mv3`.
- **Firefox**: open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on** and pick
  `extension/dist/firefox-mv3/manifest.json`. Firefox removes it when it restarts.

After a rebuild, click the reload button on the extension's card.

Using it:

- Right-click an image → **Check image for AI**. The panel opens, downloads the image and shows the score.
- The toolbar button opens the panel. Drop an image (a file, or an image dragged from a page), paste one
  (Ctrl+V), or click to choose a file.
- **Look closer**, under the score, shows what the file says about its origin (camera, date, software, AI labels,
  Content Credentials) and four views to inspect the image: error level, noise, spectrum and colors (PCA). A view
  is computed only once picked; click it to compare with the original.
- The model picker is under the result. The choice is remembered.

## Publish

| Store | Command | Upload |
|---|---|---|
| Chrome Web Store (Brave also installs from it), Edge Add-ons | `npm run zip` | `dist/*-chrome.zip` |
| addons.mozilla.org | `npm run zip:firefox` | `dist/*-firefox.zip`, plus `*-sources.zip` when asked for the source code |

- Mozilla asks for the source code because it is bundled. `*-sources.zip` holds the website code and the
  extension, without weights or `node_modules`. This README is the build guide for its reviewers.
- **Size**: the three current models make about 72 MB zipped (Mozilla's limit is 200 MB).
  `EXT_MODELS=pe_tiny,pe_small npm run zip` ships fewer models (the first is the default). A model whose
  `config.json` has an absolute `"model"` URL is not bundled: it downloads on first use.
- **Version**: taken from `version` in `package.json`. Raise it for every upload.
- **Firefox add-on ID**: `{463ff5de-a8e4-46e5-8894-38dd12c9e483}` in `wxt.config.ts`. Never change it once published.
- **Permissions** to explain in the store forms:
  - *Access to all websites*: to download the image the user right-clicks from whichever site serves it (CORS
    blocks this otherwise), and for the small script that finds that image in the page.
  - `contextMenus` for the menu item, `scripting` to add that script to tabs already open at install, `storage`
    to pass the request to the panel (session only), `sidePanel` for the panel (Chrome).
- **Privacy**: no data is collected or sent anywhere. The Firefox manifest declares
  `data_collection_permissions: none`. In the Chrome Web Store privacy form, declare no data collection: images
  are processed on the device.

## How it works

```
entrypoints/background.ts     menu item, opens the panel, hands the request over through storage.session
entrypoints/content.ts        remembers where the menu was opened and answers "which image is there?"
lib/findImage.ts              the image under the cursor: below overlays, largest srcset, CSS backgrounds,
                              shadow DOM; blob: images are read in the page and passed on as data: URLs
entrypoints/sidepanel/        the panel (React), built on the website's src/lib and src/components
  LookCloser.tsx              file facts and forensic views under the score
lib/provenance.ts             AI labels in the file's bytes: IPTC digital source type, C2PA, PNG generation settings
wxt.config.ts                 manifest, models copied from public/models, Vite settings
```

- The panel downloads the image itself. Extension pages with host access aren't subject to CORS. Then the
  website's code decodes the image, preprocesses it and runs the model.
- ONNX Runtime runs in a worker, on a single thread: extension pages aren't cross-origin isolated. The current
  models take 0.2–0.7 s per image.
- Two settings in `wxt.config.ts` look unusual but are required. The explicit `content_security_policy` allows
  WebAssembly, which WXT only allows in dev builds. `keepImportMetaUrlInPages` undoes WXT's rewrite of
  `import.meta.url`, which would otherwise break ONNX Runtime's worker.

## Limits

- No Safari build. It needs an Xcode wrapper and an Apple developer account.
- No Firefox for Android: it has no sidebar.
- Images only, not videos.
- Some sites refuse direct downloads (hotlink protection). The panel then suggests copying the image and pasting it.
- Social networks recompress images, and their scores are less reliable than scores on original files.

Icon: magnifying glass from [SVG Repo](https://www.svgrepo.com/) (Responsive Flat Icons, pixelbazaar, CC Attribution).
