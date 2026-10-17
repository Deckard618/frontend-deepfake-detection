import react from "@vitejs/plugin-react-swc";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { defineConfig } from "wxt";
import type { GeneratedPublicFile, CopiedPublicFile } from "wxt";

// The extension is built from the website's code (src/lib, src/components) and models (public/models).
const repo = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig({
  imports: false,
  manifestVersion: 3, // Firefox too (WXT defaults to MV2 there)
  outDir: "dist", // WXT's default, .output, is hidden in file pickers ("Load unpacked")
  alias: { "@site": `${repo}src` },
  manifest: ({ browser }) => ({
    name: "AI Detection & Forensics Lab",
    description:
      "Right-click any image to check whether it is AI-generated. The models run on your device: nothing is uploaded.",
    permissions: ["contextMenus", "storage", "scripting"],
    // To read the image you right-click from whichever site serves it (CORS blocks most of them otherwise).
    host_permissions: ["<all_urls>"],
    action: { default_title: "Check an image for AI" },
    // ONNX Runtime is WebAssembly, which the default extension CSP doesn't allow (WXT only adds it in dev).
    content_security_policy: { extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';" },
    ...(browser === "firefox" && {
      browser_specific_settings: {
        gecko: {
          id: "{463ff5de-a8e4-46e5-8894-38dd12c9e483}",
          strict_min_version: "140.0",
          data_collection_permissions: { required: ["none"] },
        },
        gecko_android: { strict_min_version: "142.0" }, // first version with data_collection_permissions
      },
    }),
  }),
  vite: () => ({
    plugins: [react(), keepImportMetaUrlInPages()],
    resolve: {
      // src/lib/inference.ts imports ONNX Runtime's .wasm by path from the website's node_modules.
      alias: [{ find: /^\/node_modules\//, replacement: `${repo}node_modules/` }],
    },
    server: { fs: { allow: [repo] } },
  }),
  hooks: {
    "build:publicAssets": (_wxt, files) => {
      files.push(...modelFiles());
    },
  },
  zip: {
    // Firefox reviewers get the website code too, since the extension is built from it.
    sourcesRoot: repo,
    excludeSources: [
      "dist/**",
      "public/**/*.onnx",
      "public/**/*.wasm",
      "public/opencv/**",
      "scripts/**",
      "extension/dist/**",
      "extension/.wxt/**",
    ],
  },
});

/**
 * WXT replaces import.meta.url with self.location.href everywhere, for its scripts built as IIFE (background,
 * content script). Pages are ES modules and need the real value: ONNX Runtime starts its worker from it.
 */
function keepImportMetaUrlInPages(): Plugin {
  return {
    name: "keep-import-meta-url-in-pages",
    enforce: "post", // after WXT's own define
    config(config) {
      if (!config.build?.lib) delete config.define?.["import.meta.url"];
    },
  };
}

/**
 * Model folders copied into the extension, so it works offline from the first click.
 * EXT_MODELS=pe_tiny,pe_small picks some (the first is the default), otherwise every image model the website lists
 * (the panel checks images, not text). A model whose config.json points to an absolute URL is downloaded on first
 * use instead.
 */
function modelFiles(): (GeneratedPublicFile | CopiedPublicFile)[] {
  const config = (id: string) => JSON.parse(readFileSync(`${repo}public/models/${id}/config.json`, "utf8"));
  const listed: string[] = JSON.parse(readFileSync(`${repo}public/models/index.json`, "utf8"));
  const ids = process.env.EXT_MODELS?.split(",").map((id) => id.trim()).filter(Boolean)
    ?? listed.filter((id) => config(id).task === "image");
  const unknown = ids.filter((id) => !listed.includes(id));
  if (unknown.length) throw new Error(`EXT_MODELS: ${unknown.join(", ")} not listed in public/models/index.json`);
  const text = ids.filter((id) => config(id).task !== "image");
  if (text.length) throw new Error(`EXT_MODELS: ${text.join(", ")} not an image model, the extension only checks images`);

  const files: (GeneratedPublicFile | CopiedPublicFile)[] = [{ relativeDest: "models/index.json", contents: JSON.stringify(ids) }];
  for (const id of ids) {
    const dir = `${repo}public/models/${id}/`;
    const { model = "model.onnx" } = config(id);
    const remote = /^https?:\/\//.test(model);
    if (!remote && !existsSync(dir + model)) {
      throw new Error(`public/models/${id}/${model} is missing: copy the weights there (see README) or leave it out with EXT_MODELS`);
    }
    for (const name of readdirSync(dir)) {
      if (remote && /\.(onnx|onnx_data|bin)$/.test(name)) continue; // a local copy of weights that load from the URL
      if (statSync(dir + name).isFile()) files.push({ absoluteSrc: dir + name, relativeDest: `models/${id}/${name}` });
    }
  }
  return files;
}
