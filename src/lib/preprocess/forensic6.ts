import { fft2LogMagnitude } from "../fft";
import type { RGBAImage, Tensor } from "./image";

/**
 * 6-channel forensic input — same values as the Python training preprocessing (OpenCV/SciPy/NumPy),
 * on an image already resized by "resize":
 *
 *   0-2  R, G, B / 255
 *   3    HSV saturation (cv2 COLOR_RGB2HSV) / 255
 *   4    SRM noise residual: 5×5 high-pass on gray (cv2 COLOR_RGB2GRAY) / 255,
 *        zero padding (scipy.ndimage.convolve), + 0.5, clipped to [0, 1]
 *   5    log1p(|fftshift(fft2(gray))|), min-max normalised to [0, 1]
 */
export function forensic6(img: RGBAImage): Tensor {
  const { data, width: w, height: h } = img;
  const n = w * h;
  const out = new Float32Array(6 * n);
  const gray = new Float64Array(n);

  for (let i = 0; i < n; i++) {
    const r = data[4 * i], g = data[4 * i + 1], b = data[4 * i + 2];
    out[i] = r / 255;
    out[n + i] = g / 255;
    out[2 * n + i] = b / 255;
    // OpenCV's 8-bit fixed-point conversions, bit for bit.
    const v = Math.max(r, g, b);
    const saturation = ((v - Math.min(r, g, b)) * SAT_DIV[v] + (1 << 11)) >> 12;
    out[3 * n + i] = saturation / 255;
    gray[i] = Math.fround(((r * 9798 + g * 19235 + b * 3735 + (1 << 14)) >> 15) / 255);
  }

  srm(gray, w, h, out.subarray(4 * n, 5 * n));

  const mag = fft2LogMagnitude(gray, w, h);
  let lo = Infinity, hi = -Infinity;
  for (const v of mag) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const fft = out.subarray(5 * n, 6 * n);
  for (let i = 0; i < n; i++) fft[i] = (mag[i] - lo) / (hi - lo + 1e-8);

  return { data: out, dims: [6, h, w] };
}

/** OpenCV's saturation table: round((255 << 12) / v). */
const SAT_DIV = Int32Array.from({ length: 256 }, (_, v) => (v === 0 ? 0 : Math.round((255 << 12) / v)));

const SRM_KERNEL = [
  -1, -1, -1, -1, -1,
  -1,  2,  2,  2, -1,
  -1,  2,  8,  2, -1,
  -1,  2,  2,  2, -1,
  -1, -1, -1, -1, -1,
].map((v) => v / 16);

function srm(gray: Float64Array, w: number, h: number, out: Float32Array) {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0; // summed in float64 in kernel order, like scipy
      for (let ky = -2; ky <= 2; ky++) {
        const yy = y + ky;
        if (yy < 0 || yy >= h) continue;
        for (let kx = -2; kx <= 2; kx++) {
          const xx = x + kx;
          if (xx < 0 || xx >= w) continue;
          s += gray[yy * w + xx] * SRM_KERNEL[(ky + 2) * 5 + kx + 2];
        }
      }
      const v = Math.fround(Math.fround(s) + 0.5);
      out[y * w + x] = v < 0 ? 0 : v > 1 ? 1 : v;
    }
  }
}
