/** Per-frame video views, drawn into a canvas the size of the frame. */
import type { OpenCV } from "../opencv";

export type VideoMode = "heatmap" | "histogram" | "edges" | "flow";

/** The frame, darkened, as a background for overlays. */
function background(ctx: CanvasRenderingContext2D, frame: ImageData, dim: number) {
  ctx.putImageData(frame, 0, 0);
  ctx.fillStyle = `rgba(0, 0, 0, ${dim})`;
  ctx.fillRect(0, 0, frame.width, frame.height);
}

/** Change from the previous frame: blue (none) → yellow → red (most), over the frame. */
export function drawMotionHeatmap(ctx: CanvasRenderingContext2D, curr: ImageData, prev: ImageData) {
  const { width, height, data } = curr;
  const p = prev.data;
  const diff = new Float32Array(width * height);
  let max = 1e-6;
  for (let k = 0, i = 0; k < diff.length; k++, i += 4) {
    diff[k] = (Math.abs(data[i] - p[i]) + Math.abs(data[i + 1] - p[i + 1]) + Math.abs(data[i + 2] - p[i + 2])) / 3;
    if (diff[k] > max) max = diff[k];
  }
  const heat = new ImageData(width, height);
  for (let k = 0; k < diff.length; k++) {
    const v = diff[k] / max;
    heat.data[4 * k] = 255 * v;
    heat.data[4 * k + 1] = 255 * Math.max(0, 1 - Math.abs(2 * v - 1));
    heat.data[4 * k + 2] = 255 * (1 - v);
    heat.data[4 * k + 3] = 170;
  }
  background(ctx, curr, 0.35);
  const layer = document.createElement("canvas");
  layer.width = width;
  layer.height = height;
  layer.getContext("2d")!.putImageData(heat, 0, 0);
  ctx.drawImage(layer, 0, 0); // blended, unlike putImageData
}

/** Sobel gradient magnitude. */
export function drawEdges(ctx: CanvasRenderingContext2D, frame: ImageData) {
  const { width: w, height: h, data } = frame;
  const gray = new Float32Array(w * h);
  for (let k = 0; k < gray.length; k++) gray[k] = (data[4 * k] + data[4 * k + 1] + data[4 * k + 2]) / 3;
  const out = new ImageData(w, h);
  for (let k = 3; k < out.data.length; k += 4) out.data[k] = 255;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      const gx = gray[p - w + 1] + 2 * gray[p + 1] + gray[p + w + 1] - gray[p - w - 1] - 2 * gray[p - 1] - gray[p + w - 1];
      const gy = gray[p + w - 1] + 2 * gray[p + w] + gray[p + w + 1] - gray[p - w - 1] - 2 * gray[p - w] - gray[p - w + 1];
      out.data[4 * p] = out.data[4 * p + 1] = out.data[4 * p + 2] = Math.hypot(gx, gy);
    }
  }
  ctx.putImageData(out, 0, 0);
}

/** R, G and B histograms of the frame. */
export function drawHistogram(ctx: CanvasRenderingContext2D, frame: ImageData) {
  const { width: W, height: H, data } = frame;
  const bins = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  for (let i = 0; i < data.length; i += 4) {
    bins[0][data[i]]++;
    bins[1][data[i + 1]]++;
    bins[2][data[i + 2]]++;
  }
  const max = Math.max(...bins.map((b) => Math.max(...b))) || 1;
  const unit = Math.max(1, W / 400);
  const top = 24 * unit, bottom = H - 10 * unit;
  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "#666";
  ctx.lineWidth = unit;
  ctx.beginPath();
  ctx.moveTo(0, bottom);
  ctx.lineTo(W, bottom);
  ctx.stroke();
  ["#ff6b6b", "#51cf66", "#74c0fc"].forEach((color, c) => {
    ctx.strokeStyle = color;
    ctx.beginPath();
    for (let x = 0; x < 256; x++) ctx.lineTo((x / 255) * W, bottom - (bins[c][x] / max) * (bottom - top));
    ctx.stroke();
  });
  ctx.fillStyle = "#ddd";
  ctx.font = `${12 * unit}px sans-serif`;
  ctx.fillText("RGB histogram", 8 * unit, 16 * unit);
}

/** Tracked corners, kept between frames while the video plays. */
export interface FlowState {
  points: OpenCV | null; // cv.Mat of float32 (x, y)
  frames: number;
}

export const newFlowState = (): FlowState => ({ points: null, frames: 0 });

export function resetFlow(state: FlowState) {
  state.points?.delete();
  state.points = null;
  state.frames = 0;
}

/**
 * Sparse Lucas–Kanade optical flow (OpenCV) on Shi–Tomasi corners: cyan lines show motion from
 * the previous frame (×2), yellow dots the tracked corners. Returns the number of vectors drawn.
 */
export function drawOpticalFlow(ctx: CanvasRenderingContext2D, cv: OpenCV, state: FlowState, curr: ImageData, prev: ImageData) {
  background(ctx, curr, 0.45);
  const toGray = (img: ImageData) => {
    const rgba = cv.matFromImageData(img);
    const gray = new cv.Mat();
    cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
    rgba.delete();
    return gray;
  };
  const g0 = toGray(prev), g1 = toGray(curr);
  const next = new cv.Mat(), status = new cv.Mat(), err = new cv.Mat();
  try {
    if (!state.points || state.points.rows < 50 || state.frames % 25 === 0) {
      state.points?.delete();
      state.points = new cv.Mat();
      const mask = new cv.Mat();
      cv.goodFeaturesToTrack(g0, state.points, 200, 0.02, 7, mask, 7, false, 0.04);
      mask.delete();
    }
    if (state.points.rows === 0) return 0;
    const criteria = new cv.TermCriteria(cv.TermCriteria_EPS | cv.TermCriteria_COUNT, 10, 0.03);
    cv.calcOpticalFlowPyrLK(g0, g1, state.points, next, status, err, new cv.Size(21, 21), 2, criteria);

    const a = state.points.data32F, b = next.data32F, ok = status.data;
    const kept: number[] = [];
    const unit = Math.max(1, curr.width / 640);
    ctx.lineWidth = 1.4 * unit;
    let drawn = 0;
    for (let i = 0; i < ok.length; i++) {
      if (ok[i] !== 1) continue;
      const [x0, y0, x1, y1] = [a[2 * i], a[2 * i + 1], b[2 * i], b[2 * i + 1]];
      kept.push(x1, y1);
      if (Math.hypot(x1 - x0, y1 - y0) < 0.2) continue;
      const [ex, ey] = [x0 + 2 * (x1 - x0), y0 + 2 * (y1 - y0)];
      ctx.strokeStyle = "#00d1ff";
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.fillStyle = "#ffec99";
      ctx.beginPath();
      ctx.arc(ex, ey, 3 * unit, 0, 2 * Math.PI);
      ctx.fill();
      drawn++;
    }
    state.points.delete();
    state.points = new cv.Mat(kept.length / 2, 1, cv.CV_32FC2);
    state.points.data32F.set(kept);
    state.frames++;
    return drawn;
  } finally {
    [g0, g1, next, status, err].forEach((m) => m.delete());
  }
}
