import type { ResizeFilter, Step } from "../types";
import { forensic6 } from "./forensic6";

/** RGBA pixels, row by row (what canvas getImageData returns). Alpha is ignored. */
export interface RGBAImage {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

/** float32 tensor without the batch dimension, e.g. dims [3, 224, 224]. */
export interface Tensor {
  data: Float32Array;
  dims: number[];
}

/** Raw file pixels, like PIL's Image.open(f).convert("RGB") (no color-profile conversion). */
export async function decodeImage(file: Blob): Promise<RGBAImage> {
  const bitmap = await createImageBitmap(file, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

export function preprocessImage(image: RGBAImage, steps: Step[]): Tensor {
  let x: RGBAImage | Tensor = image;
  for (const step of steps) {
    switch (step.op) {
      case "resize":
        x = resize(asImage(x, step.op), step.size, step.filter ?? "bilinear");
        break;
      case "center_crop":
        x = centerCrop(asImage(x, step.op), step.size);
        break;
      case "to_tensor":
        x = toTensor(asImage(x, step.op));
        break;
      case "forensic6":
        x = forensic6(asImage(x, step.op));
        break;
      case "normalize":
        x = normalize(asTensor(x, step.op), step.mean, step.std);
        break;
      default:
        throw new Error(`"${(step as Step).op}" is not an image preprocessing op`);
    }
  }
  if (!("dims" in x)) throw new Error(`preprocess must end with a tensor: add "to_tensor" or "forensic6"`);
  return x;
}

function asImage(x: RGBAImage | Tensor, op: string): RGBAImage {
  if ("dims" in x) throw new Error(`"${op}" works on pixels, put it before "to_tensor" / "forensic6"`);
  return x;
}

function asTensor(x: RGBAImage | Tensor, op: string): Tensor {
  if (!("dims" in x)) throw new Error(`"${op}" works on a tensor, put "to_tensor" before it`);
  return x;
}

// --- transforms.Resize → PIL Image.resize ------------------------------------------------
// Port of Pillow's libImaging/Resample.c (8-bit path): separable filtering with antialiasing,
// fixed-point weights, horizontal pass then vertical pass, both rounded to uint8. It gives the
// very same pixels as PIL, so the model sees what it saw during training.

const PRECISION_BITS = 32 - 8 - 2;
const HALF = 1 << (PRECISION_BITS - 1);

const FILTERS: Record<ResizeFilter, { support: number; kernel: (x: number) => number }> = {
  bilinear: { support: 1, kernel: (x) => ((x = Math.abs(x)) < 1 ? 1 - x : 0) },
  bicubic: { support: 2, kernel: bicubic },
  lanczos: { support: 3, kernel: (x) => (x >= -3 && x < 3 ? sinc(x) * sinc(x / 3) : 0) },
};

function bicubic(x: number) {
  const a = -0.5;
  x = Math.abs(x);
  if (x < 1) return ((a + 2) * x - (a + 3)) * x * x + 1;
  if (x < 2) return (((x - 5) * x + 8) * x - 4) * a;
  return 0;
}

function sinc(x: number) {
  if (x === 0) return 1;
  x *= Math.PI;
  return Math.sin(x) / x;
}

export function resize(img: RGBAImage, size: number | [number, number], filter: ResizeFilter): RGBAImage {
  const { width: w, height: h } = img;
  let outW: number, outH: number;
  if (typeof size === "number") {
    // Shorter side → size, longer side scaled and truncated (torchvision semantics).
    if (w <= h) [outW, outH] = [size, Math.trunc((size * h) / w)];
    else [outW, outH] = [Math.trunc((size * w) / h), size];
  } else {
    [outH, outW] = size;
  }
  if (!FILTERS[filter]) throw new Error(`resize: unknown filter "${filter}" (bilinear, bicubic, lanczos)`);

  let out = img;
  if (outW !== w) out = resample(out, outW, coefficients(w, outW, FILTERS[filter]), true);
  if (outH !== h) out = resample(out, outH, coefficients(h, outH, FILTERS[filter]), false);
  return out;
}

interface Coefficients {
  ksize: number;
  bounds: Int32Array; // per output pixel: first input pixel, number of input pixels
  weights: Int32Array; // fixed-point, ksize per output pixel
}

function coefficients(inSize: number, outSize: number, filter: (typeof FILTERS)[ResizeFilter]): Coefficients {
  const scale = inSize / outSize;
  const filterscale = Math.max(scale, 1);
  const support = filter.support * filterscale;
  const ksize = Math.ceil(support) * 2 + 1;
  const bounds = new Int32Array(outSize * 2);
  const weights = new Int32Array(outSize * ksize);
  const k = new Float64Array(ksize);

  for (let xx = 0; xx < outSize; xx++) {
    const center = (xx + 0.5) * scale;
    const ss = 1 / filterscale;
    const xmin = Math.max(Math.trunc(center - support + 0.5), 0);
    const xmax = Math.min(Math.trunc(center + support + 0.5), inSize) - xmin;
    let ww = 0;
    for (let x = 0; x < xmax; x++) {
      k[x] = filter.kernel((x + xmin - center + 0.5) * ss);
      ww += k[x];
    }
    for (let x = 0; x < xmax; x++) {
      const v = (ww !== 0 ? k[x] / ww : k[x]) * (1 << PRECISION_BITS);
      weights[xx * ksize + x] = Math.trunc(v < 0 ? v - 0.5 : v + 0.5);
    }
    bounds[xx * 2] = xmin;
    bounds[xx * 2 + 1] = xmax;
  }
  return { ksize, bounds, weights };
}

/** One resampling pass along x (horizontal) or y, keeping the other dimension. */
function resample(img: RGBAImage, outSize: number, c: Coefficients, horizontal: boolean): RGBAImage {
  const { data, width: w, height: h } = img;
  const outW = horizontal ? outSize : w;
  const outH = horizontal ? h : outSize;
  const out = new Uint8ClampedArray(outW * outH * 4);
  const step = horizontal ? 4 : w * 4; // distance between two consecutive input taps

  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const i = horizontal ? x : y; // output index along the resampled axis
      const first = c.bounds[i * 2];
      const taps = c.bounds[i * 2 + 1];
      const k0 = i * c.ksize;
      let p = horizontal ? (y * w + first) * 4 : (first * w + x) * 4;
      let r = HALF, g = HALF, b = HALF;
      for (let t = 0; t < taps; t++, p += step) {
        const k = c.weights[k0 + t];
        r += data[p] * k;
        g += data[p + 1] * k;
        b += data[p + 2] * k;
      }
      const o = (y * outW + x) * 4;
      out[o] = clip8(r);
      out[o + 1] = clip8(g);
      out[o + 2] = clip8(b);
      out[o + 3] = 255;
    }
  }
  return { data: out, width: outW, height: outH };
}

function clip8(v: number) {
  v >>= PRECISION_BITS;
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

// --- transforms.CenterCrop -----------------------------------------------------------------

export function centerCrop(img: RGBAImage, size: number | [number, number]): RGBAImage {
  const [ch, cw] = typeof size === "number" ? [size, size] : size;
  const { data, width: w, height: h } = img;
  // Like torchvision: pad with black when the crop is larger, then offsets rounded half-to-even.
  const padTop = ch > h ? Math.floor((ch - h) / 2) : 0;
  const padLeft = cw > w ? Math.floor((cw - w) / 2) : 0;
  const top = roundHalfEven((Math.max(h, ch) - ch) / 2) - padTop;
  const left = roundHalfEven((Math.max(w, cw) - cw) / 2) - padLeft;

  const out = new Uint8ClampedArray(cw * ch * 4);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const sy = y + top, sx = x + left;
      const o = (y * cw + x) * 4;
      out[o + 3] = 255;
      if (sy < 0 || sy >= h || sx < 0 || sx >= w) continue;
      const p = (sy * w + sx) * 4;
      out[o] = data[p];
      out[o + 1] = data[p + 1];
      out[o + 2] = data[p + 2];
    }
  }
  return { data: out, width: cw, height: ch };
}

/** Python's round(): halves go to the even neighbour. */
function roundHalfEven(x: number) {
  const r = Math.round(x);
  return r - x === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

// --- transforms.ToTensor / transforms.Normalize ---------------------------------------------

export function toTensor(img: RGBAImage): Tensor {
  const { data, width: w, height: h } = img;
  const n = w * h;
  const out = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    out[i] = data[4 * i] / 255;
    out[n + i] = data[4 * i + 1] / 255;
    out[2 * n + i] = data[4 * i + 2] / 255;
  }
  return { data: out, dims: [3, h, w] };
}

export function normalize(t: Tensor, mean: number[], std: number[]): Tensor {
  const channels = t.dims[0];
  if (mean?.length !== channels || std?.length !== channels) {
    throw new Error(`normalize: "mean" and "std" need ${channels} values (one per channel)`);
  }
  const n = t.data.length / channels;
  const out = new Float32Array(t.data.length);
  for (let c = 0; c < channels; c++) {
    const m = Math.fround(mean[c]), s = Math.fround(std[c]); // float32, like torch
    for (let i = c * n; i < (c + 1) * n; i++) out[i] = Math.fround(t.data[i] - m) / s;
  }
  return { data: out, dims: t.dims };
}
