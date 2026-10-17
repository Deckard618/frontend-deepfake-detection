# AGENTS.md

Essentials for anyone, human or AI agent, about to change this repository. [README.md](README.md) explains what the
project does and why. This file lists what you must know before touching it.

## The project in five lines

- A static site (React 18, Vite 5, TypeScript, Tailwind 3) that runs AI-content detectors **in the visitor's browser**
  with ONNX Runtime Web, plus image and video forensics views. There is no backend.
- Deployed on **Cloudflare Pages**. Model weights are hosted on **Hugging Face**, and `public/models/<id>/config.json`
  points to them.
- `extension/` is a Chrome and Firefox extension (WXT), built from the same `src/` code and the same models.
- Shipped models: three image classifiers (`pe_tiny`, the default, then `resnet50-6ch` and `pe_small`). The text
  pipeline works, but no text model is shipped.
- It is a **demo**: results are probabilities, never proof.

## Rules that must not break

1. **User content never leaves the device.** No upload, no backend, no analytics, no third-party scripts, fonts or
   CDNs. The only third-party requests allowed are model files at the URLs listed in `config.json`.
2. **Static only.** Don't add Cloudflare Pages Functions (`functions/`) or any server. Static requests are free and
   unlimited, Functions are metered.
3. **Keep cross-origin isolation.** COOP `same-origin` and COEP `require-corp` are set in `public/_headers`
   (Cloudflare), `nginx.conf` (Docker) and `vite.config.ts` (dev). ONNX Runtime needs them to use threads. Under
   COEP, any new cross-origin resource must send CORS headers, or the browser blocks it.
4. **ONNX only.** Never load pickle formats (`.pt`, `.pth`, `.bin`, `.ckpt`), in the app or in scripts: they can
   execute code.
5. **Preprocessing must match training exactly.** `src/lib/preprocess/` ports PIL, torchvision, OpenCV and Hugging
   Face tokenizers bit for bit. After any change there, compare with Python (README › Check a new model): the
   percentages must agree to 0.1%.
6. **A replaced model file needs a new cache key.** Browsers keep weights per URL + `version`, so change one of them.
   Convention: `version` is the first 12 hex digits of the file's SHA-256 (`sha256sum model.onnx | cut -c1-12`);
   `resnet50-6ch` still uses `"1"`.
7. **Honest wording.** Everything shown to users says scores are probabilities that can be wrong both ways. Keep the
   footer disclaimer and the legal pages (`/legal`, `/legal-en`).
8. **No personal information.** Never write a real name, a personal email, a local path or a token into code, docs,
   model files or commit metadata. Before committing, check that `git config user.name` and `git config user.email`
   return the identity meant for this public repository, not a personal one.

## Commands

| Command | What it does |
|---|---|
| `npm install` | Installs dependencies (Node 20 or later) |
| `npm run dev` | Dev server on http://localhost:8080, with the COOP/COEP headers |
| `npm run build` | Static site in `dist/` |
| `npm run typecheck`, `npm run lint` | Checks. There is no test suite: typecheck, lint, build, then try the page. |
| `node scripts/run-text-model.mjs public/models/<id> texts.json` | Runs a text model with the app's own runtime, without a browser |
| `cd extension && npm install && npm run build` | Extension for Chrome, Brave and Edge (also `build:firefox`, `zip`, `zip:firefox`) |

## Where things are

```
src/lib/types.ts            the model contract (ModelConfig, preprocessing ops): read it first
src/lib/registry.ts         loads and validates models/index.json and each config.json
src/lib/inference.ts        ONNX Runtime session (in a worker, one model at a time), inputs, softmax
src/lib/modelFiles.ts       downloads weights once, Cache Storage keyed by URL + version
src/lib/preprocess/         PIL-exact image ops, 6-channel forensic input, tokenizer
src/lib/forensics/          image and video forensic views (pure functions)
src/lib/links.ts            REPO_URL, the GitHub link in the site header and the extension (no link while empty)
src/components/             Detector, ImageForensics, VideoForensics, ui
src/pages/                  legal notice (FR, EN); routes are in src/main.tsx
public/models/              index.json (first entry = default model) and one folder per model
public/_headers             Cloudflare Pages response headers
extension/                  browser extension; imports src/ through the @site alias
```

## Models

- A model is a folder `public/models/<id>/` with a `config.json` (plus `tokenizer.json` for text), listed in
  `index.json`. Adding one needs no code, unless it needs a new preprocessing op. Full guide: README › Add a model.
- Weights are gitignored (`*.onnx`, `*.onnx_data`, `*.bin`) and live in the Hugging Face repo
  [Deckard618/imdet](https://huggingface.co/Deckard618/imdet). In `config.json`, `"model"` pins a commit:
  `https://huggingface.co/Deckard618/imdet/resolve/<commit>/<id>/model.onnx`. To update a model, upload it there,
  then put the new commit in its `config.json`. A relative `"model": "model.onnx"` reads a local copy instead, for
  offline work and testing.
- License: each detector keeps the license of the open model it is built on, Apache 2.0 for `pe_tiny` and
  `pe_small` (Meta's Perception Encoder) and BSD 3-Clause for `resnet50-6ch` (torchvision's ResNet-50). Keep
  `LICENSE-pe_*.txt` next to their configs (the legal pages link to it), and state the changes made wherever the
  weights are published: Apache 2.0 requires it.
- The reported metrics (README › The models) are the author's own. Don't present them as independent benchmarks.

## Deploying

- Cloudflare Pages: build command `npm run build`, output directory `dist`. A build from git contains no weights,
  which is intended.
- Limits: 25 MiB per file and 20,000 files. Never upload a `dist/` built while weights were in `public/models/`.
- Cloudflare serves `index.html` for unknown paths (SPA mode, which `/legal` relies on). A missing model or config
  therefore comes back as HTML with status 200, not a 404: a JSON or protobuf parse error usually means a wrong path.
- `Dockerfile`, `nginx.conf` and `nixpacks.toml` are for self-hosting with nginx. Cloudflare doesn't use them.

## Gotchas

- `src/lib/inference.ts` imports ONNX Runtime's `.wasm` by path from `node_modules` (the package doesn't export it),
  and keeps ONNX Runtime in its own chunk, because its worker threads re-import that chunk.
- Without cross-origin isolation, ONNX Runtime silently falls back to one thread (its warnings are hidden by
  `logLevel = "error"`).
- `modelFiles.ts` only replaces cached copies with the *same URL*. When a model's URL changes (a new commit), the old
  copy stays in visitors' Cache Storage until they click "delete downloaded models".
- The extension bundles a model only when its `config.json` uses a relative `"model"` path; with a URL, it downloads
  the model on first use. Its CSP in `wxt.config.ts` (`'wasm-unsafe-eval'`) and `keepImportMetaUrlInPages()` are
  required.
- Changes to `src/lib` or `src/components` also change the extension: rebuild and test both.
- The extension downloads the right-clicked image with the user's cookies (`download()` in
  `extension/entrypoints/sidepanel/Panel.tsx`). That response must stay inside the panel.

## Open items (October 2026)

- [ ] Document the training datasets and their licenses, in the README and in the model card.
- [ ] Choose a license for the source code (there is none yet).
- Ideas: verify a full SHA-256 from `config.json` in `modelFiles.ts` (`crypto.subtle.digest`); add a
  `Content-Security-Policy` to `public/_headers` with `connect-src 'self' https://huggingface.co https://*.hf.co`,
  then check that ONNX Runtime's worker still starts.
