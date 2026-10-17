/**
 * Model files are downloaded once and kept in Cache Storage, keyed by URL + version,
 * so later visits load them from disk. A new `version` in config.json replaces the old copy.
 */

const CACHE_NAME = "onnx-models";

function cacheKey(url: string, version: string) {
  return `${url}${url.includes("?") ? "&" : "?"}v=${encodeURIComponent(version)}`;
}

async function openCache(url: string): Promise<Cache | null> {
  // Cache Storage only holds http(s) responses (files inside the browser extension are on disk already),
  // only exists on secure origins (https, localhost) and can be blocked.
  if (!/^https?:/.test(url)) return null;
  try {
    return "caches" in window ? await caches.open(CACHE_NAME) : null;
  } catch {
    return null;
  }
}

export async function isModelFileCached(url: string, version: string): Promise<boolean> {
  const cache = await openCache(url);
  return !!(await cache?.match(cacheKey(url, version)));
}

export async function fetchModelFile(
  url: string,
  version: string,
  onProgress?: (loaded: number, total: number) => void,
): Promise<Uint8Array> {
  const cache = await openCache(url);
  const key = cacheKey(url, version);
  const hit = await cache?.match(key);
  if (hit) return new Uint8Array(await hit.arrayBuffer());

  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`Could not download ${url} (HTTP ${res.status})`);
  const bytes = await readBody(res, onProgress);

  if (cache) {
    try {
      await cache.delete(url, { ignoreSearch: true }); // older versions of this file
      await cache.put(key, new Response(bytes));
    } catch {
      // Quota exceeded or private browsing: the model still runs, it just isn't kept.
    }
  }
  return bytes;
}

export async function clearModelFiles(): Promise<void> {
  if ("caches" in window) await caches.delete(CACHE_NAME);
}

async function readBody(res: Response, onProgress?: (loaded: number, total: number) => void) {
  const total = Number(res.headers.get("content-length")) || 0;
  if (!res.body) return new Uint8Array(await res.arrayBuffer());

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress?.(loaded, total);
  }

  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
