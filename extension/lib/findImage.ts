/** Finds the image the user right-clicked. Runs in the page, as part of the content script. */

const MIN_SIDE = 16; // smaller images are spacers or icons (some sites cover photos with a transparent 1×1 GIF)
const MIN_BACKGROUND = 48; // smaller CSS backgrounds are icons and sprites

export interface FoundImage {
  src: string;
  element: Element;
}

/**
 * The image under the point, even when the site covers it with transparent layers (Instagram does),
 * in which case the browser itself sees no image there.
 */
export function findImageAt(x: number, y: number): FoundImage | null {
  for (const element of elementsAt(x, y, document)) {
    if (element === document.body || element === document.documentElement) break; // a page background isn't "an image"
    const src = sourceOf(element);
    if (src) return { src, element };
  }
  // elementsFromPoint skips elements with pointer-events: none, which some sites set on their images.
  return imageCovering(x, y);
}

/**
 * An address the extension can download. blob: URLs only work inside the page that made them
 * (WhatsApp Web, Telegram…), so their content is read here and passed on as a data: URL.
 */
export async function fetchableSource({ src, element }: FoundImage): Promise<string> {
  if (!src.startsWith("blob:")) return src;
  try {
    return await asDataUrl(await (await fetch(src)).blob());
  } catch {
    if (!(element instanceof HTMLImageElement)) throw new Error("Couldn't read this image from the page.");
    // The page may not let the content script fetch its blobs: copy the pixels instead.
    const canvas = document.createElement("canvas");
    canvas.width = element.naturalWidth;
    canvas.height = element.naturalHeight;
    canvas.getContext("2d")!.drawImage(element, 0, 0);
    return canvas.toDataURL("image/png");
  }
}

/** elementsFromPoint, including inside open shadow roots. Topmost first. */
function elementsAt(x: number, y: number, root: Document | ShadowRoot): Element[] {
  const found: Element[] = [];
  for (const element of root.elementsFromPoint(x, y)) {
    if (root instanceof ShadowRoot && !root.contains(element)) continue; // the host's side is listed by the caller
    if (element.shadowRoot) found.push(...elementsAt(x, y, element.shadowRoot));
    found.push(element);
  }
  return found;
}

function sourceOf(element: Element): string | null {
  if (element instanceof HTMLImageElement) {
    return element.naturalWidth >= MIN_SIDE && element.naturalHeight >= MIN_SIDE ? largestSource(element) : null;
  }
  if (element instanceof SVGImageElement) return absolute(element.href.baseVal);
  const box = element.getBoundingClientRect();
  if (box.width < MIN_BACKGROUND || box.height < MIN_BACKGROUND) return null;
  // Computed styles hold absolute URLs: url("https://…")
  const url = /url\(\s*(["']?)(.*?)\1\s*\)/.exec(getComputedStyle(element).backgroundImage)?.[2];
  return url || null;
}

/** The smallest visible image whose box contains the point. */
function imageCovering(x: number, y: number): FoundImage | null {
  let best: { image: HTMLImageElement; area: number } | null = null;
  for (const image of Array.from(document.images)) {
    if (image.naturalWidth < MIN_SIDE || image.naturalHeight < MIN_SIDE) continue;
    const box = image.getBoundingClientRect();
    if (x < box.left || x > box.right || y < box.top || y > box.bottom) continue;
    if (!image.checkVisibility({ visibilityProperty: true })) continue;
    const area = box.width * box.height;
    if (!best || area <= best.area) best = { image, area };
  }
  return best && { src: largestSource(best.image), element: best.image };
}

/** The biggest version the page offers in srcset: the closest to the original file. */
function largestSource(image: HTMLImageElement): string {
  let best = { url: image.currentSrc || image.src, size: 0 };
  for (const candidate of parseSrcset(image.srcset)) {
    if (candidate.size > best.size) best = { url: absolute(candidate.url), size: candidate.size };
  }
  return best.url;
}

/** "a.jpg 640w, b.jpg 1080w" → sizes are the w (or x) descriptors. URLs may contain commas (Cloudinary). */
function parseSrcset(srcset: string): { url: string; size: number }[] {
  const candidates: { url: string; size: number }[] = [];
  let rest = srcset;
  for (;;) {
    rest = rest.replace(/^[\s,]+/, "");
    if (!rest) return candidates;
    let url = /^\S+/.exec(rest)![0];
    rest = rest.slice(url.length);
    let descriptor = "";
    if (url.endsWith(",")) {
      url = url.replace(/,+$/, "");
    } else {
      const end = rest.indexOf(",");
      descriptor = (end < 0 ? rest : rest.slice(0, end)).trim();
      rest = end < 0 ? "" : rest.slice(end + 1);
    }
    const size = /^(\d+(?:\.\d+)?)[wx]$/.exec(descriptor)?.[1];
    candidates.push({ url, size: size ? Number(size) : 1 });
  }
}

function absolute(url: string) {
  return new URL(url, document.baseURI).href;
}

function asDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
