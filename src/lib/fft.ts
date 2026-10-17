/**
 * DFT of any length: recursive mixed-radix Cooley–Tukey (224 = 2⁵·7 needs no padding),
 * with an iterative radix-2 path for powers of two.
 */
export class FFT {
  private cos: Float64Array;
  private sin: Float64Array;
  private tRe: Float64Array;
  private tIm: Float64Array;
  private bitReversed: Uint32Array | null = null;

  constructor(private n: number) {
    this.cos = new Float64Array(n);
    this.sin = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      this.cos[k] = Math.cos((-2 * Math.PI * k) / n);
      this.sin[k] = Math.sin((-2 * Math.PI * k) / n);
    }
    this.tRe = new Float64Array(n);
    this.tIm = new Float64Array(n);
    if (n > 1 && (n & (n - 1)) === 0) {
      const bits = Math.log2(n);
      this.bitReversed = Uint32Array.from({ length: n }, (_, i) => {
        let r = 0;
        for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
        return r;
      });
    }
  }

  /** out = DFT(in). Input and output must be different arrays. */
  transform(inRe: Float64Array, inIm: Float64Array, outRe: Float64Array, outIm: Float64Array) {
    const { n, cos, sin, bitReversed } = this;
    if (!bitReversed) return this.step(inRe, inIm, 0, 1, n, outRe, outIm, 0);
    for (let i = 0; i < n; i++) {
      outRe[bitReversed[i]] = inRe[i];
      outIm[bitReversed[i]] = inIm[i];
    }
    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1, stride = n / len;
      for (let start = 0; start < n; start += len) {
        for (let k = 0; k < half; k++) {
          const a = start + k, b = a + half, wr = cos[k * stride], wi = sin[k * stride];
          const br = outRe[b] * wr - outIm[b] * wi, bi = outRe[b] * wi + outIm[b] * wr;
          outRe[b] = outRe[a] - br;
          outIm[b] = outIm[a] - bi;
          outRe[a] += br;
          outIm[a] += bi;
        }
      }
    }
  }

  /** DFT of the n values in[off + j·stride] into out[o .. o+n). */
  private step(inRe: Float64Array, inIm: Float64Array, off: number, stride: number, n: number,
               outRe: Float64Array, outIm: Float64Array, o: number) {
    if (n === 1) {
      outRe[o] = inRe[off];
      outIm[o] = inIm[off];
      return;
    }
    let p = 2;
    while (n % p !== 0) p++; // smallest prime factor
    const m = n / p;
    // p interleaved sub-sequences, each transformed into its own block of m outputs.
    for (let r = 0; r < p; r++) {
      if (m === 1) {
        outRe[o + r] = inRe[off + r * stride];
        outIm[o + r] = inIm[off + r * stride];
      } else {
        this.step(inRe, inIm, off + r * stride, stride * p, m, outRe, outIm, o + r * m);
      }
    }

    // Combine: X[k + q·m] = Σ_r W_p^(r·q) · W_n^(r·k) · Y_r[k]    (W_n^e = cos/sin[e · N/n])
    const { cos, sin, tRe, tIm } = this;
    const N = this.n, s = N / n;
    if (p === 2) {
      // Radix-2 butterfly: X[k] = Y0[k] + W^k·Y1[k], X[k+m] = Y0[k] − W^k·Y1[k]
      for (let k = 0; k < m; k++) {
        const i0 = o + k, i1 = i0 + m, wr = cos[k * s], wi = sin[k * s];
        const br = outRe[i1] * wr - outIm[i1] * wi, bi = outRe[i1] * wi + outIm[i1] * wr;
        const ar = outRe[i0], ai = outIm[i0];
        outRe[i0] = ar + br;
        outIm[i0] = ai + bi;
        outRe[i1] = ar - br;
        outIm[i1] = ai - bi;
      }
      return;
    }
    for (let k = 0; k < m; k++) {
      for (let r = 0; r < p; r++) {
        const e = (r * k * s) % N, a = outRe[o + r * m + k], b = outIm[o + r * m + k];
        tRe[r] = a * cos[e] - b * sin[e];
        tIm[r] = a * sin[e] + b * cos[e];
      }
      for (let q = 0; q < p; q++) {
        let sumRe = 0, sumIm = 0;
        for (let r = 0; r < p; r++) {
          const e = (r * q * m * s) % N;
          sumRe += tRe[r] * cos[e] - tIm[r] * sin[e];
          sumIm += tRe[r] * sin[e] + tIm[r] * cos[e];
        }
        outRe[o + k + q * m] = sumRe;
        outIm[o + k + q * m] = sumIm;
      }
    }
  }
}

/**
 * log1p(|fftshift(fft2(x))|) of a w×h real image (row-major), like NumPy:
 * zero frequency at the centre. Returns the magnitudes, not normalised.
 */
export function fft2LogMagnitude(x: Float64Array, w: number, h: number): Float64Array {
  const re = new Float64Array(w * h);
  const im = new Float64Array(w * h);

  // 2-D DFT = 1-D DFT of every row, then of every column.
  const rows = new FFT(w);
  const zeros = new Float64Array(w);
  const rowRe = new Float64Array(w), rowIm = new Float64Array(w);
  for (let y = 0; y < h; y++) {
    rows.transform(x.subarray(y * w, (y + 1) * w), zeros, rowRe, rowIm);
    re.set(rowRe, y * w);
    im.set(rowIm, y * w);
  }
  const cols = h === w ? rows : new FFT(h);
  const inRe = new Float64Array(h), inIm = new Float64Array(h);
  const colRe = new Float64Array(h), colIm = new Float64Array(h);
  for (let c = 0; c < w; c++) {
    for (let y = 0; y < h; y++) {
      inRe[y] = re[y * w + c];
      inIm[y] = im[y * w + c];
    }
    cols.transform(inRe, inIm, colRe, colIm);
    for (let y = 0; y < h; y++) {
      re[y * w + c] = colRe[y];
      im[y * w + c] = colIm[y];
    }
  }

  const out = new Float64Array(w * h);
  const sy = h >> 1, sx = w >> 1;
  for (let y = 0; y < h; y++) {
    for (let c = 0; c < w; c++) {
      const src = ((y - sy + h) % h) * w + ((c - sx + w) % w);
      out[y * w + c] = Math.log1p(Math.sqrt(re[src] * re[src] + im[src] * im[src]));
    }
  }
  return out;
}

/** Largest n' ≤ n whose prime factors are all ≤ 7, so the FFT stays fast on any image size. */
export function fftFriendlySize(n: number): number {
  for (let m = n; m > 1; m--) {
    let r = m;
    for (const p of [2, 3, 5, 7]) while (r % p === 0) r /= p;
    if (r === 1) return m;
  }
  return 1;
}
