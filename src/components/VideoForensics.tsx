import { useEffect, useRef, useState } from "react";
import {
  drawEdges, drawHistogram, drawMotionHeatmap, drawOpticalFlow, newFlowState, resetFlow, type VideoMode,
} from "../lib/forensics/video";
import { downloadCanvas } from "../lib/dom";
import { loadOpenCV } from "../lib/opencv";
import { Button, Card, Choice, DropZone, Explain } from "./ui";

const MODES = [
  { value: "heatmap", label: "Motion heatmap", hint: "Change from the previous frame (1)" },
  { value: "histogram", label: "Histogram", hint: "RGB distribution of the frame (2)" },
  { value: "edges", label: "Edges", hint: "Sobel gradient magnitude (3)" },
  { value: "flow", label: "Optical flow", hint: "Lucas–Kanade tracking of corner features (4)" },
] as const;

interface Info {
  width: number;
  height: number;
  duration: number;
}

export function VideoForensics({ file, onFile }: { file: File | null; onFile: (file: File) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const output = useRef<HTMLCanvasElement>(null);
  const grabber = useRef<CanvasRenderingContext2D | null>(null);
  const previous = useRef<ImageData | null>(null);
  const flow = useRef(newFlowState());
  const [url, setUrl] = useState<string | null>(null);
  const [info, setInfo] = useState<Info | null>(null);
  const [fps, setFps] = useState(30);
  const [frame, setFrame] = useState(0);
  const [mode, setMode] = useState<VideoMode>("heatmap");
  const [playing, setPlaying] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState(""); // "<mode>:<frame>" currently drawn
  const total = info ? Math.max(1, Math.floor(info.duration * fps)) : 0;

  // Current values for the async frame loop and the keyboard handler.
  const live = useRef({ mode, fps, info, total, frame });
  live.current = { mode, fps, info, total, frame };

  useEffect(() => {
    if (!file) return;
    const u = URL.createObjectURL(file);
    setUrl(u);
    setInfo(null);
    setFrame(0);
    setPlaying(false);
    setError(null);
    previous.current = null;
    resetFlow(flow.current);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  function capture(): ImageData | null {
    const v = video.current;
    if (!v?.videoWidth) return null;
    let ctx = grabber.current;
    if (!ctx || ctx.canvas.width !== v.videoWidth || ctx.canvas.height !== v.videoHeight) {
      const c = document.createElement("canvas");
      c.width = v.videoWidth;
      c.height = v.videoHeight;
      ctx = grabber.current = c.getContext("2d", { willReadFrequently: true })!;
    }
    ctx.drawImage(v, 0, 0);
    return ctx.getImageData(0, 0, v.videoWidth, v.videoHeight);
  }

  async function render(curr: ImageData, prev: ImageData | null) {
    const c = output.current;
    if (!c) return;
    const m = live.current.mode;
    let cv = null;
    if (m === "flow" && prev) {
      setStatus("Loading OpenCV.js…");
      cv = await loadOpenCV();
    }
    c.width = curr.width;
    c.height = curr.height;
    const ctx = c.getContext("2d")!;
    if (m === "edges") drawEdges(ctx, curr);
    else if (m === "histogram") drawHistogram(ctx, curr);
    else if (!prev) ctx.putImageData(curr, 0, 0); // first frame: nothing to compare with yet
    else if (m === "heatmap") drawMotionHeatmap(ctx, curr, prev);
    else drawOpticalFlow(ctx, cv, flow.current, curr, prev);
  }

  function seek(t: number) {
    const v = video.current!;
    return new Promise<void>((resolve) => {
      v.addEventListener("seeked", () => resolve(), { once: true });
      v.currentTime = t;
    });
  }

  // Frame requests are coalesced: dragging the slider only renders the last position asked for.
  const wanted = useRef<number | null>(null);
  const running = useRef(false);

  async function show(n: number) {
    wanted.current = n;
    if (running.current) return;
    running.current = true;
    setPlaying(false);
    try {
      while (wanted.current !== null) {
        const { info, fps, total, mode } = live.current;
        const target = Math.max(0, Math.min(wanted.current, total - 1));
        wanted.current = null;
        if (!info) break;
        video.current?.pause();
        setStatus("Computing…");
        const time = (k: number) => Math.min((k + 0.5) / fps, info.duration - 1e-3); // middle of frame k
        let prev: ImageData | null = null;
        if (target > 0 && (mode === "heatmap" || mode === "flow")) {
          await seek(time(target - 1));
          prev = capture();
        }
        await seek(time(target));
        const curr = capture();
        if (curr) {
          resetFlow(flow.current);
          await render(curr, prev);
          previous.current = curr;
          setShown(`${mode}:${target}`);
        }
        setFrame(target);
      }
      setStatus(null);
    } catch (e) {
      setStatus(null);
      setError(e instanceof Error ? e.message : String(e));
    }
    running.current = false;
  }

  // First frame once the video is loaded; re-render when the mode changes.
  useEffect(() => {
    if (info) show(live.current.frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info, mode]);

  // Playback: analyse every presented frame (skipping frames when the analysis is slower).
  useEffect(() => {
    const v = video.current;
    if (!v || !playing) return;
    let stopped = false;
    const next = () => {
      if (stopped || v.paused || v.ended) return;
      if ("requestVideoFrameCallback" in v) v.requestVideoFrameCallback(() => step());
      else requestAnimationFrame(() => step());
    };
    const step = async () => {
      const curr = capture();
      if (curr && !stopped) {
        await render(curr, previous.current);
        previous.current = curr;
        const { fps, total, mode } = live.current;
        const n = Math.min(total - 1, Math.floor(v.currentTime * fps));
        setFrame(n);
        setShown(`${mode}:${n}`);
        setStatus(null);
      }
      next();
    };
    v.play().then(next, () => setPlaying(false));
    const ended = () => setPlaying(false);
    v.addEventListener("ended", ended);
    return () => {
      stopped = true;
      v.pause();
      v.removeEventListener("ended", ended);
    };
  }, [playing]);

  // Keyboard: ←/→ frame, PageUp/PageDown ±10, Home/End, Space play/pause, 1-4 modes.
  useEffect(() => {
    if (!info) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest?.("input, textarea, select, [contenteditable]")) return;
      const { frame, total } = live.current;
      const actions: Record<string, () => void> = {
        ArrowLeft: () => show(frame - 1),
        ArrowRight: () => show(frame + 1),
        PageUp: () => show(frame - 10),
        PageDown: () => show(frame + 10),
        Home: () => show(0),
        End: () => show(total - 1),
        " ": () => setPlaying((p) => !p),
        ...Object.fromEntries(MODES.map((m, i) => [String(i + 1), () => setMode(m.value)])),
      };
      const action = actions[e.key];
      if (action) {
        e.preventDefault();
        action();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info]);

  if (!file || !url) {
    return (
      <Card>
        <DropZone accept="video" onFile={onFile}>
          <span className="font-medium">Drop a video to inspect</span>
          <span className="text-muted">or click to choose one, or paste it · MP4, WebM, MOV (what your browser plays)</span>
        </DropZone>
      </Card>
    );
  }

  const busy = status !== null && !playing;

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Choice options={MODES} value={mode} onChange={setMode} />
          <label className="cursor-pointer text-sm text-muted underline hover:text-fg">
            Change video
            <input type="file" accept="video/*" className="sr-only" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
          </label>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-1">
            <video
              ref={video}
              src={url}
              muted
              playsInline
              preload="auto"
              onLoadedMetadata={(e) => {
                const v = e.currentTarget;
                setInfo({ width: v.videoWidth, height: v.videoHeight, duration: v.duration });
              }}
              onError={() => setError("This browser can't play this video format.")}
              className="aspect-video w-full rounded-lg bg-black"
            />
            <p className="text-xs text-muted">Video</p>
          </div>
          <div className="flex flex-col gap-1">
            <canvas ref={output} data-view={shown} className={`aspect-video w-full rounded-lg bg-black object-contain ${busy ? "opacity-60" : ""}`} />
            <p className="text-xs text-muted">{MODES.find((m) => m.value === mode)!.label}{status && !playing ? ` · ${status}` : ""}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={!info || frame <= 0} onClick={() => show(frame - 1)} title="Previous frame (←)">‹ Prev</Button>
          <Button primary disabled={!info} onClick={() => setPlaying((p) => !p)} className="w-20" title="Play / pause (Space)">
            {playing ? "Pause" : "Play"}
          </Button>
          <Button disabled={!info || frame >= total - 1} onClick={() => show(frame + 1)} title="Next frame (→)">Next ›</Button>
          <input
            type="range"
            min={0}
            max={Math.max(0, total - 1)}
            value={frame}
            disabled={!info}
            onChange={(e) => show(Number(e.target.value))}
            className="min-w-40 flex-1 accent-accent"
            aria-label="Frame"
          />
          <span className="w-24 text-right text-sm tabular-nums text-muted">{frame} / {Math.max(0, total - 1)}</span>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted">
          <span className="max-w-64 truncate" title={file.name}>{file.name}</span>
          <span>{(file.size / 1e6).toFixed(1)} MB</span>
          {info && <span>{info.width}×{info.height}</span>}
          {info && <span>{info.duration.toFixed(2)} s</span>}
          <label className="flex items-center gap-1" title="Browsers don't expose the frame rate: set it to step exactly one frame">
            <input
              type="number"
              min={1}
              max={240}
              value={fps}
              onChange={(e) => setFps(Math.max(1, Number(e.target.value) || 30))}
              className="w-14 rounded border border-border bg-bg px-1"
            />
            fps
          </label>
          <span className="ml-auto flex gap-2">
            <Button disabled={!info} onClick={() => { const f = capture(); if (f) downloadCanvas(grabber.current!.canvas, `frame-${frame}.png`); }}>
              Download frame
            </Button>
            <Button disabled={!info} onClick={() => downloadCanvas(output.current, `${mode}-frame-${frame}.png`)}>Download view</Button>
            <Button disabled={!info} onClick={() => output.current?.requestFullscreen()}>Fullscreen</Button>
          </span>
        </div>
        {error && <p className="text-sm text-fake">{error}</p>}
      </Card>

      <Explain>
        <p><b>Keyboard:</b> ←/→ one frame · Page Up/Down ten frames · Home/End first/last · Space play/pause · 1-4 modes · Esc leaves fullscreen.</p>
        <h4>Motion heatmap</h4>
        <p>Per-pixel change from the previous frame (t−1 → t): blue = none, yellow = medium, red = most. Look for a face that moves while hair and background stay static, a mouth that is over-animated while the eyes are too static or jerky, and motion that stops at the face boundary.</p>
        <h4>Histogram</h4>
        <p>RGB distribution of the frame. Look for sudden spikes or shifts from one frame to the next, and brightness or skin tones inconsistent with the scene.</p>
        <h4>Edges</h4>
        <p>Sharp transitions and boundaries. Look for face edges that are too sharp or too blurry, halos at the jaw or hairline, edges that flicker between frames, and missing fine detail (pores, eyelashes, uniform teeth).</p>
        <h4>Optical flow (Lucas–Kanade)</h4>
        <p>Corner features tracked from frame to frame: yellow dots are the tracked corners, cyan lines the motion from t−1 (drawn twice as long). Short or missing lines mean sub-pixel motion. Look for erratic isolated jitter, facial features drifting differently from the jaw and ears (mask effect), one side of the mouth or eyes moving differently, and vectors popping on static regions.</p>
        <p>OpenCV.js (11 MB) is downloaded the first time you use this view.</p>
      </Explain>
    </div>
  );
}
