/**
 * Manual image forensics: each function takes RGBA pixels and returns an RGBA visualisation.
 * Pure functions (no DOM), except errorLevel which needs the browser's JPEG encoder.
 */
import { fft2LogMagnitude, fftFriendlySize } from "../fft";
import { decodeImage, type RGBAImage } from "../preprocess/image";

export interface Pixels {
  data: Uint8ClampedArray<ArrayBuffer>; // what ImageData accepts
  width: number;
  height: number;
}

function pixels(width: number, height: number): Pixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  return { data, width, height };
}

/** One value per pixel → grayscale image (values clamped to 0-255). */
function grayImage(values: ArrayLike<number>, width: number, height: number): Pixels {
  const out = pixels(width, height);
  for (let p = 0; p < values.length; p++) out.data[4 * p] = out.data[4 * p + 1] = out.data[4 * p + 2] = values[p];
  return out;
}

/** Luma, BT.601. */
function luma({ data, width, height }: RGBAImage): Float64Array {
  const y = new Float64Array(width * height);
  for (let p = 0; p < y.length; p++) y[p] = 0.299 * data[4 * p] + 0.587 * data[4 * p + 1] + 0.114 * data[4 * p + 2];
  return y;
}

// --- Color channels --------------------------------------------------------------------------

export type ColorChannel = "red" | "green" | "blue" | "hue" | "saturation" | "value";

export function colorChannel(img: RGBAImage, channel: ColorChannel): Pixels {
  const { data, width, height } = img;
  const out = pixels(width, height);
  const o = out.data;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (channel === "red") o[i] = r;
    else if (channel === "green") o[i + 1] = g;
    else if (channel === "blue") o[i + 2] = b;
    else {
      const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
      let v = max;
      if (channel === "saturation") v = max === 0 ? 0 : (d / max) * 255;
      if (channel === "hue") {
        let h = 0;
        if (d !== 0) {
          h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
          h = Math.round(h * 60);
          if (h < 0) h += 360;
        }
        v = (h / 360) * 255;
      }
      o[i] = o[i + 1] = o[i + 2] = v;
    }
  }
  return out;
}

// --- Noise -----------------------------------------------------------------------------------

/** Error level analysis: re-save as JPEG, show the per-channel difference amplified. */
export async function errorLevel(img: RGBAImage, quality = 0.9, gain = 8): Promise<Pixels> {
  const { width, height, data } = img;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  if (!blob) throw new Error("JPEG re-encoding failed");
  const jpeg = await decodeImage(blob);

  const out = pixels(width, height);
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) out.data[i + c] = Math.abs(data[i + c] - jpeg.data[i + c]) * gain;
  }
  return out;
}

/** Deviation of each pixel from its 8×8 block mean. */
export function localVariance(img: RGBAImage, block = 8, gain = 5): Pixels {
  const { data, width: w, height: h } = img;
  const gray = new Float64Array(w * h);
  for (let p = 0; p < gray.length; p++) gray[p] = (data[4 * p] + data[4 * p + 1] + data[4 * p + 2]) / 3;
  const out = new Float64Array(w * h);
  for (let by = 0; by < h; by += block) {
    for (let bx = 0; bx < w; bx += block) {
      const yEnd = Math.min(by + block, h), xEnd = Math.min(bx + block, w);
      let sum = 0;
      for (let y = by; y < yEnd; y++) for (let x = bx; x < xEnd; x++) sum += gray[y * w + x];
      const mean = sum / ((yEnd - by) * (xEnd - bx));
      for (let y = by; y < yEnd; y++) for (let x = bx; x < xEnd; x++) out[y * w + x] = Math.abs(gray[y * w + x] - mean) * gain;
    }
  }
  return grayImage(out, w, h);
}

/** Difference between each pixel and its 3×3 neighbourhood mean. */
export function highFrequency(img: RGBAImage, gain = 10): Pixels {
  const { data, width: w, height: h } = img;
  const gray = new Float64Array(w * h);
  for (let p = 0; p < gray.length; p++) gray[p] = (data[4 * p] + data[4 * p + 1] + data[4 * p + 2]) / 3;
  const out = new Float64Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      let sum = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) sum += gray[(y + dy) * w + x + dx];
      out[y * w + x] = Math.abs(gray[y * w + x] - sum / 9) * gain;
    }
  }
  return grayImage(out, w, h);
}

/**
 * Sensor-noise-like residual (demo): image minus a 5×5 box blur, amplified; 64×64 blocks whose
 * mean departs from the global mean are outlined in red. Not real PRNU camera matching.
 */
export function prnu(img: RGBAImage): { image: Pixels; snr: number; flagged: number } {
  const { data, width: w, height: h } = img;
  const radius = 2;
  const blurred = boxBlur(boxBlur(data, w, h, radius, true), w, h, radius, false);

  const enhanced = new Float64Array(w * h);
  let sum = 0, sumSq = 0;
  for (let p = 0; p < w * h; p++) {
    const i = 4 * p;
    const r = clamp8(128 + data[i] - blurred[i]) - 128;
    const g = clamp8(128 + data[i + 1] - blurred[i + 1]) - 128;
    const b = clamp8(128 + data[i + 2] - blurred[i + 2]) - 128;
    enhanced[p] = clamp8(128 + (r * 0.299 + g * 0.587 + b * 0.114) * 3);
    sum += r;
    sumSq += r * r;
  }
  const n = w * h;
  const mean = sum / n;
  const std = Math.sqrt(Math.max(0, sumSq / n - mean * mean));
  const snr = std > 0 && mean !== 0 ? 20 * Math.log10(Math.abs(mean) / std) : 0;

  const image = grayImage(enhanced, w, h);
  let global = 0;
  for (const v of enhanced) global += v;
  global /= n;
  let flagged = 0;
  const block = 64;
  for (let by = 0; by < h; by += block) {
    for (let bx = 0; bx < w; bx += block) {
      const yEnd = Math.min(by + block, h), xEnd = Math.min(bx + block, w);
      let s = 0;
      for (let y = by; y < yEnd; y++) for (let x = bx; x < xEnd; x++) s += enhanced[y * w + x];
      if (Math.abs(s / ((yEnd - by) * (xEnd - bx)) - global) > 20) {
        outline(image, bx, by, xEnd - bx, yEnd - by);
        flagged++;
      }
    }
  }
  return { image, snr, flagged };
}

function clamp8(v: number) {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

/** Running-sum box blur along x or y; the window shrinks at the borders. Rounded to uint8. */
function boxBlur(src: ArrayLike<number>, w: number, h: number, radius: number, horizontal: boolean) {
  const out = new Uint8ClampedArray(w * h * 4);
  if (horizontal) {
    for (let y = 0; y < h; y++) {
      for (let c = 4 * y * w; c < 4 * y * w + 3; c++) {
        let sum = 0, count = 0;
        for (let k = 0; k <= radius && k < w; k++, count++) sum += src[c + 4 * k];
        for (let x = 0; x < w; x++) {
          out[c + 4 * x] = sum / count;
          if (x - radius >= 0) {
            sum -= src[c + 4 * (x - radius)];
            count--;
          }
          if (x + radius + 1 < w) {
            sum += src[c + 4 * (x + radius + 1)];
            count++;
          }
        }
      }
    }
    return out;
  }
  // Vertical: one running sum per column and channel, updated row by row (cache friendly).
  const sums = new Float64Array(4 * w);
  const addRow = (y: number, sign: number) => {
    for (let i = 0, row = 4 * y * w; i < 4 * w; i++) sums[i] += sign * src[row + i];
  };
  let count = 0;
  for (let y = 0; y <= radius && y < h; y++, count++) addRow(y, 1);
  for (let y = 0; y < h; y++) {
    for (let i = 0, row = 4 * y * w; i < 4 * w; i++) out[row + i] = sums[i] / count;
    if (y - radius >= 0) {
      addRow(y - radius, -1);
      count--;
    }
    if (y + radius + 1 < h) {
      addRow(y + radius + 1, 1);
      count++;
    }
  }
  return out;
}

/** 2-px red rectangle outline, drawn into the image. */
function outline(img: Pixels, x0: number, y0: number, rw: number, rh: number) {
  const set = (x: number, y: number) => {
    const i = 4 * (y * img.width + x);
    img.data[i] = 255;
    img.data[i + 1] = img.data[i + 2] = 0;
  };
  for (let t = 0; t < 2; t++) {
    for (let x = x0; x < x0 + rw; x++) {
      set(x, y0 + t);
      set(x, y0 + rh - 1 - t);
    }
    for (let y = y0; y < y0 + rh; y++) {
      set(x0 + t, y);
      set(x0 + rw - 1 - t, y);
    }
  }
}

// --- Edges -----------------------------------------------------------------------------------

export type EdgeMethod = "canny" | "sobel" | "laplacian";

export function edges(img: RGBAImage, method: EdgeMethod, threshold: number): Pixels {
  const { width: w, height: h } = img;
  const gray = luma(img);
  if (method === "sobel") {
    const mag = magnitude(sobel(gray, w, h));
    for (let p = 0; p < mag.length; p++) mag[p] = mag[p] > threshold ? 255 : 0;
    return grayImage(mag, w, h);
  }
  if (method === "laplacian") {
    // Laplacian of Gaussian: light blur, then the 4-neighbour Laplacian.
    const g = gaussianBlur(gray, w, h, 1);
    const out = new Float64Array(w * h);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const p = y * w + x;
        out[p] = Math.abs(4 * g[p] - g[p - 1] - g[p + 1] - g[p - w] - g[p + w]) * 4;
      }
    }
    return grayImage(out, w, h);
  }
  return grayImage(canny(gray, w, h, threshold), w, h);
}

/** 3×3 Sobel gradients (zero on the border). */
function sobel(gray: Float64Array, w: number, h: number) {
  const gx = new Float64Array(w * h);
  const gy = new Float64Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      gx[p] = gray[p - w + 1] + 2 * gray[p + 1] + gray[p + w + 1] - gray[p - w - 1] - 2 * gray[p - 1] - gray[p + w - 1];
      gy[p] = gray[p + w - 1] + 2 * gray[p + w] + gray[p + w + 1] - gray[p - w - 1] - 2 * gray[p - w] - gray[p - w + 1];
    }
  }
  return { gx, gy };
}

function magnitude({ gx, gy }: { gx: Float64Array; gy: Float64Array }): Float64Array {
  const mag = new Float64Array(gx.length);
  for (let p = 0; p < mag.length; p++) mag[p] = Math.sqrt(gx[p] * gx[p] + gy[p] * gy[p]);
  return mag;
}

/** Separable Gaussian blur, edges clamped. Both passes walk the image row by row. */
function gaussianBlur(src: Float64Array, w: number, h: number, sigma: number): Float64Array {
  const r = Math.ceil(2 * sigma);
  const k = Array.from({ length: 2 * r + 1 }, (_, i) => Math.exp(-((i - r) ** 2) / (2 * sigma * sigma)));
  const total = k.reduce((a, b) => a + b, 0);
  const kernel = Float64Array.from(k, (v) => v / total);
  const K = kernel.length;
  const clamp = (v: number, max: number) => (v < 0 ? 0 : v > max ? max : v);

  const tmp = new Float64Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let s = 0;
      if (x >= r && x < w - r) for (let t = 0; t < K; t++) s += src[row + x + t - r] * kernel[t];
      else for (let t = 0; t < K; t++) s += src[row + clamp(x + t - r, w - 1)] * kernel[t];
      tmp[row + x] = s;
    }
  }
  const out = new Float64Array(w * h);
  const rows = new Int32Array(K);
  for (let y = 0; y < h; y++) {
    for (let t = 0; t < K; t++) rows[t] = clamp(y + t - r, h - 1) * w;
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let t = 0; t < K; t++) s += tmp[rows[t] + x] * kernel[t];
      out[y * w + x] = s;
    }
  }
  return out;
}

/** Canny: Gaussian blur, Sobel, non-maximum suppression, hysteresis (low = high / 2). */
function canny(gray: Float64Array, w: number, h: number, high: number): Uint8Array {
  const { gx, gy } = sobel(gaussianBlur(gray, w, h, 1.4), w, h);
  const mag = magnitude({ gx, gy });
  const thin = new Float64Array(w * h);
  const TAN_22_5 = Math.SQRT2 - 1, TAN_67_5 = Math.SQRT2 + 1;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      // Neighbours along the gradient direction (0°, 45°, 90° or 135°).
      const ax = Math.abs(gx[p]), ay = Math.abs(gy[p]);
      const d = ay <= ax * TAN_22_5 ? 1 : ay >= ax * TAN_67_5 ? w : gx[p] * gy[p] > 0 ? w + 1 : w - 1;
      const m = mag[p];
      if (m >= mag[p + d] && m >= mag[p - d]) thin[p] = m;
    }
  }
  const low = high / 2;
  const out = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let p = 0; p < w * h; p++) {
    if (thin[p] >= high && !out[p]) {
      out[p] = 255;
      stack.push(p);
      while (stack.length) {
        const q = stack.pop()!;
        const qx = q % w, qy = (q - qx) / w;
        for (let ny = Math.max(qy - 1, 0); ny <= Math.min(qy + 1, h - 1); ny++) {
          for (let nx = Math.max(qx - 1, 0); nx <= Math.min(qx + 1, w - 1); nx++) {
            const n = ny * w + nx;
            if (!out[n] && thin[n] >= low) {
              out[n] = 255;
              stack.push(n);
            }
          }
        }
      }
    }
  }
  return out;
}

// --- Frequency -------------------------------------------------------------------------------

/**
 * Centred log-magnitude spectrum of the luma. Large or awkward sizes use the central region
 * (at most 2048 px per side, with an FFT-friendly size), so every image is fast.
 */
export function fftSpectrum(img: RGBAImage, maxSize = 2048): { image: Pixels; region: [number, number] } {
  const { width: w, height: h } = img;
  const cw = fftFriendlySize(Math.min(w, maxSize)), ch = fftFriendlySize(Math.min(h, maxSize));
  const x0 = (w - cw) >> 1, y0 = (h - ch) >> 1;
  const full = luma(img);
  const gray = new Float64Array(cw * ch);
  for (let y = 0; y < ch; y++) gray.set(full.subarray((y + y0) * w + x0, (y + y0) * w + x0 + cw), y * cw);
  return { image: grayImage(normalize(fft2LogMagnitude(gray, cw, ch)), cw, ch), region: [cw, ch] };
}

/** 8×8 block DCT (the JPEG grid): each block shows log |coefficients|, DC top-left. */
export function blockDct(img: RGBAImage): Pixels {
  const w = img.width & ~7, h = img.height & ~7;
  const gray = luma(img);
  // Orthonormal DCT-II basis, C[u·8 + x]
  const C = Float64Array.from({ length: 64 }, (_, i) => {
    const u = i >> 3, x = i & 7;
    return (u === 0 ? Math.SQRT1_2 : 1) * 0.5 * Math.cos(((2 * x + 1) * u * Math.PI) / 16);
  });
  const out = new Float64Array(w * h);
  const t = new Float64Array(64);
  for (let by = 0; by < h; by += 8) {
    for (let bx = 0; bx < w; bx += 8) {
      for (let y = 0; y < 8; y++) {
        const row = (by + y) * img.width + bx;
        for (let u = 0; u < 8; u++) {
          let s = 0;
          for (let x = 0; x < 8; x++) s += C[u * 8 + x] * (gray[row + x] - 128);
          t[y * 8 + u] = s;
        }
      }
      for (let v = 0; v < 8; v++) {
        for (let u = 0; u < 8; u++) {
          let s = 0;
          for (let y = 0; y < 8; y++) s += C[v * 8 + y] * t[y * 8 + u];
          out[(by + v) * w + bx + u] = Math.log1p(Math.abs(s));
        }
      }
    }
  }
  return grayImage(normalize(out), w, h);
}

/** Min-max to 0-255, in place. */
function normalize(values: Float64Array): Float64Array {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < values.length; i++) {
    if (values[i] < lo) lo = values[i];
    if (values[i] > hi) hi = values[i];
  }
  const range = hi - lo || 1;
  for (let i = 0; i < values.length; i++) values[i] = ((values[i] - lo) / range) * 255;
  return values;
}

// --- Principal components of the RGB colour cloud ----------------------------------------------

export type PcaView = "pc1" | "pc2" | "pc3" | "rgb";

export interface PcaBasis {
  mean: number[];
  vectors: number[][]; // principal axes, largest variance first
  variances: number[];
  minAbs: number[];
  maxAbs: number[];
}

export function pcaBasis(img: RGBAImage): PcaBasis {
  const { data } = img;
  const n = data.length / 4;
  const stride = Math.max(1, Math.floor(n / 500000)); // sample very large images
  const mean = [0, 0, 0];
  let count = 0;
  for (let p = 0; p < n; p += stride, count++) for (let c = 0; c < 3; c++) mean[c] += data[4 * p + c];
  for (let c = 0; c < 3; c++) mean[c] /= count;

  const cov = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let p = 0; p < n; p += stride) {
    const d = [0, 1, 2].map((c) => data[4 * p + c] - mean[c]);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) cov[i][j] += d[i] * d[j];
  }
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) cov[i][j] /= Math.max(1, count - 1);
  const { values, vectors } = eigenSymmetric3(cov);

  const minAbs = [Infinity, Infinity, Infinity], maxAbs = [0, 0, 0];
  for (let p = 0; p < n; p++) {
    for (let k = 0; k < 3; k++) {
      const a = Math.abs(project(data, p, mean, vectors[k]));
      if (a < minAbs[k]) minAbs[k] = a;
      if (a > maxAbs[k]) maxAbs[k] = a;
    }
  }
  return { mean, vectors, variances: values, minAbs, maxAbs: maxAbs.map((m, k) => (m === minAbs[k] ? m + 1 : m)) };
}

export function pcaProject(img: RGBAImage, basis: PcaBasis, view: PcaView): Pixels {
  const { data, width, height } = img;
  const out = pixels(width, height);
  const scaled = (p: number, k: number) =>
    ((Math.abs(project(data, p, basis.mean, basis.vectors[k])) - basis.minAbs[k]) / (basis.maxAbs[k] - basis.minAbs[k])) * 255;
  for (let p = 0; p < width * height; p++) {
    const i = 4 * p;
    if (view === "rgb") for (let k = 0; k < 3; k++) out.data[i + k] = scaled(p, k);
    else out.data[i] = out.data[i + 1] = out.data[i + 2] = scaled(p, Number(view[2]) - 1);
  }
  return out;
}

function project(data: ArrayLike<number>, p: number, mean: number[], v: number[]) {
  return v[0] * (data[4 * p] - mean[0]) + v[1] * (data[4 * p + 1] - mean[1]) + v[2] * (data[4 * p + 2] - mean[2]);
}

/** Jacobi eigen-decomposition of a symmetric 3×3 matrix; eigenpairs sorted by decreasing value. */
function eigenSymmetric3(m: number[][]): { values: number[]; vectors: number[][] } {
  const A = m.map((row) => [...row]);
  const V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let iter = 0; iter < 32; iter++) {
    let p = 0, q = 1;
    if (Math.abs(A[0][2]) > Math.abs(A[p][q])) [p, q] = [0, 2];
    if (Math.abs(A[1][2]) > Math.abs(A[p][q])) [p, q] = [1, 2];
    if (Math.abs(A[p][q]) < 1e-10) break;
    const tau = (A[q][q] - A[p][p]) / (2 * A[p][q]);
    const t = (tau >= 0 ? 1 : -1) / (Math.abs(tau) + Math.sqrt(1 + tau * tau));
    const c = 1 / Math.sqrt(1 + t * t), s = t * c;
    for (let k = 0; k < 3; k++) [A[p][k], A[q][k]] = [c * A[p][k] - s * A[q][k], s * A[p][k] + c * A[q][k]];
    for (let k = 0; k < 3; k++) [A[k][p], A[k][q]] = [c * A[k][p] - s * A[k][q], s * A[k][p] + c * A[k][q]];
    for (let k = 0; k < 3; k++) [V[k][p], V[k][q]] = [c * V[k][p] - s * V[k][q], s * V[k][p] + c * V[k][q]];
  }
  const order = [0, 1, 2].sort((i, j) => A[j][j] - A[i][i]);
  return { values: order.map((i) => A[i][i]), vectors: order.map((i) => [V[0][i], V[1][i], V[2][i]]) };
}
