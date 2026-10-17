import { useEffect, useRef, useState } from "react";
import {
  blockDct, colorChannel, edges, errorLevel, fftSpectrum, highFrequency, localVariance, pcaBasis, pcaProject, prnu,
  type ColorChannel, type EdgeMethod, type PcaBasis, type PcaView, type Pixels,
} from "../lib/forensics/image";
import { downloadCanvas, nextPaint } from "../lib/dom";
import { decodeImage, type RGBAImage } from "../lib/preprocess/image";
import { Button, Card, Choice, DropZone, Explain } from "./ui";

const MODES = [
  { value: "noise", label: "Noise" },
  { value: "color", label: "Color channels" },
  { value: "edges", label: "Edges" },
  { value: "frequency", label: "Frequency" },
  { value: "pca", label: "PCA" },
  { value: "metadata", label: "Metadata" },
] as const;
type Mode = (typeof MODES)[number]["value"];

const OPTIONS = {
  noise: [
    { value: "ela", label: "Error level (ELA)", hint: "Re-saves as JPEG and shows the per-channel difference" },
    { value: "variance", label: "Local variance", hint: "Deviation from the local 8×8 block mean" },
    { value: "highfreq", label: "High frequency", hint: "Rapid intensity changes: splices, resampling" },
    { value: "prnu", label: "PRNU pattern (demo)", hint: "Noise residual; not real camera fingerprint matching" },
  ],
  color: [
    { value: "red", label: "Red" }, { value: "green", label: "Green" }, { value: "blue", label: "Blue" },
    { value: "hue", label: "Hue" }, { value: "saturation", label: "Saturation" }, { value: "value", label: "Value" },
  ],
  edges: [
    { value: "canny", label: "Canny", hint: "Thin edges: blur, gradient, non-maximum suppression, hysteresis" },
    { value: "sobel", label: "Sobel", hint: "Gradient magnitude above the threshold" },
    { value: "laplacian", label: "Laplacian of Gaussian", hint: "Second derivative after light smoothing" },
  ],
  frequency: [
    { value: "fft", label: "FFT spectrum", hint: "Centred log-magnitude 2-D spectrum" },
    { value: "dct", label: "8×8 block DCT", hint: "JPEG-grid DCT coefficients of each block" },
  ],
  pca: [
    { value: "pc1", label: "PC1" }, { value: "pc2", label: "PC2" }, { value: "pc3", label: "PC3" },
    { value: "rgb", label: "PCs → RGB" },
  ],
} as const;
type Options = { [M in keyof typeof OPTIONS]: (typeof OPTIONS)[M][number]["value"] };

interface Result {
  image: Pixels;
  note?: string;
  view?: string; // which settings produced it
}

const viewOf = (mode: Mode, options: Options, threshold: number) =>
  mode === "metadata" ? mode : `${mode}:${options[mode]}${mode === "edges" ? `:${threshold}` : ""}`;

export function ImageForensics({ image, onImage }: { image: File | null; onImage: (file: File) => void }) {
  const [pixels, setPixels] = useState<RGBAImage | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("noise");
  const [options, setOptions] = useState<Options>({ noise: "ela", color: "red", edges: "canny", frequency: "fft", pca: "pc1" });
  const [threshold, setThreshold] = useState(50);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pca = useRef<PcaBasis | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const view = viewOf(mode, options, threshold);
  const ready = result?.view === view; // otherwise the canvas still shows the previous view

  useEffect(() => {
    if (!image) return;
    let cancelled = false;
    const url = URL.createObjectURL(image);
    setPreview(url);
    setPixels(null);
    setResult(null);
    setError(null);
    pca.current = null;
    decodeImage(image).then(
      (p) => !cancelled && setPixels(p),
      () => !cancelled && setError("This image can't be decoded by the browser."),
    );
    return () => {
      cancelled = true;
      URL.revokeObjectURL(url);
    };
  }, [image]);

  useEffect(() => {
    if (!pixels || mode === "metadata") return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      await nextPaint();
      if (cancelled) return;
      setError(null);
      try {
        const r = await analyze(pixels, mode, options, threshold, pca);
        if (!cancelled) setResult({ ...r, view: viewOf(mode, options, threshold) });
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    }, mode === "edges" ? 150 : 0); // the threshold slider fires often
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [pixels, mode, options, threshold]);

  useEffect(() => {
    const c = canvas.current;
    if (!c || !result) return;
    c.width = result.image.width;
    c.height = result.image.height;
    c.getContext("2d")!.putImageData(new ImageData(result.image.data, result.image.width, result.image.height), 0, 0);
  }, [result, mode]);

  if (!image) {
    return (
      <Card>
        <DropZone accept="image" onFile={onImage}>
          <span className="font-medium">Drop an image to inspect</span>
          <span className="text-muted">or click to choose one, or paste it</span>
        </DropZone>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Choice options={MODES} value={mode} onChange={setMode} />
          <label className="cursor-pointer text-sm text-muted underline hover:text-fg">
            Change image
            <input type="file" accept="image/*" className="sr-only" onChange={(e) => e.target.files?.[0] && onImage(e.target.files[0])} />
          </label>
        </div>
        {mode !== "metadata" && (
          <Choice
            options={OPTIONS[mode]}
            value={options[mode]}
            onChange={(v) => setOptions((o) => ({ ...o, [mode]: v }))}
          />
        )}
        {mode === "edges" && options.edges !== "laplacian" && (
          <label className="flex items-center gap-3 text-sm">
            Threshold
            <input type="range" min={0} max={255} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} className="w-56 accent-accent" />
            <span className="w-8 tabular-nums text-muted">{threshold}</span>
          </label>
        )}
        {error && <p className="text-sm text-fake">{error}</p>}
      </Card>

      {mode === "metadata" ? (
        <Metadata file={image} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <Card className="flex flex-col gap-2">
            <p className="text-sm font-medium">Original</p>
            {preview && <img src={preview} alt="Original" className="w-full rounded-lg" />}
          </Card>
          <Card className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium">{ready ? label(mode, options) : error ? "Could not compute this view" : "Processing…"}</p>
              <Button disabled={!ready} onClick={() => downloadCanvas(canvas.current, `${mode}-${Date.now()}.png`)}>
                Download
              </Button>
            </div>
            <canvas ref={canvas} data-view={result?.view} className={`w-full rounded-lg border border-border ${ready ? "" : "opacity-40"}`} />
            {ready && result.note && <p className="text-xs text-muted">{result.note}</p>}
          </Card>
        </div>
      )}

      <Help mode={mode} />
    </div>
  );
}

function label(mode: Mode, options: Options) {
  if (mode === "metadata") return "";
  return OPTIONS[mode].find((o) => o.value === options[mode])!.label;
}

async function analyze(
  img: RGBAImage, mode: Exclude<Mode, "metadata">, options: Options, threshold: number,
  pca: { current: PcaBasis | null },
): Promise<Result> {
  switch (mode) {
    case "color":
      return { image: colorChannel(img, options.color as ColorChannel) };
    case "edges":
      return { image: edges(img, options.edges as EdgeMethod, threshold) };
    case "noise":
      if (options.noise === "ela") return { image: await errorLevel(img) };
      if (options.noise === "variance") return { image: localVariance(img) };
      if (options.noise === "highfreq") return { image: highFrequency(img) };
      {
        const r = prnu(img);
        return { image: r.image, note: `Residual SNR ${r.snr.toFixed(2)} dB · ${r.flagged} inconsistent 64×64 block(s) outlined in red` };
      }
    case "frequency":
      if (options.frequency === "dct") return { image: blockDct(img) };
      {
        const r = fftSpectrum(img);
        const [w, h] = r.region;
        return { image: r.image, note: w === img.width && h === img.height ? undefined : `Spectrum of the central ${w}×${h} region.` };
      }
    case "pca": {
      pca.current ??= pcaBasis(img);
      const v = pca.current.variances, total = v[0] + v[1] + v[2] || 1;
      return {
        image: pcaProject(img, pca.current, options.pca as PcaView),
        note: `Variance explained: PC1 ${((v[0] / total) * 100).toFixed(1)}%, PC2 ${((v[1] / total) * 100).toFixed(1)}%, PC3 ${((v[2] / total) * 100).toFixed(1)}%`,
      };
    }
  }
}

function Metadata({ file }: { file: File }) {
  const [rows, setRows] = useState<[string, string][] | null>(null);
  const [basic, setBasic] = useState<[string, string][]>([]);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    decodeImage(file).then(({ width, height }) => {
      if (cancelled) return;
      setBasic([
        ["File", file.name],
        ["Type", file.type || "unknown"],
        ["Size", `${(file.size / 1e6).toFixed(2)} MB`],
        ["Dimensions", `${width} × ${height} (aspect ${(width / height).toFixed(2)})`],
        ["Last modified", new Date(file.lastModified).toISOString()],
      ]);
    }, () => {});
    import("exifr")
      .then(({ default: exifr }) =>
        exifr.parse(file, { tiff: true, exif: true, gps: true, interop: true, xmp: true, icc: true, iptc: true, jfif: true, ihdr: true }),
      )
      .catch(() => null)
      .then((meta: Record<string, unknown> | null | undefined) => {
        if (cancelled) return;
        const entries = Object.entries(meta ?? {}).sort(([a], [b]) => a.localeCompare(b));
        setRows(entries.map(([k, v]) => [k, show(v)]));
      });
    return () => {
      cancelled = true;
    };
  }, [file]);

  return (
    <Card className="flex flex-col gap-3 text-sm">
      <table className="w-full">
        <tbody>
          {basic.map(([k, v]) => (
            <tr key={k} className="border-b border-border align-top">
              <td className="w-48 py-1.5 pr-3 font-medium">{k}</td>
              <td className="py-1.5 break-all">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows === null ? (
        <p className="text-muted">Reading EXIF / XMP / IPTC…</p>
      ) : rows.length === 0 ? (
        <p className="rounded-lg border border-border bg-bg p-3 text-muted">
          No embedded EXIF/XMP/IPTC metadata: it was stripped, or this is a screenshot or an export. The original file usually has more.
        </p>
      ) : (
        <table className="w-full text-xs">
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k} className="border-b border-border align-top">
                <td className="w-48 py-1.5 pr-3 font-medium">{k}</td>
                <td className="whitespace-pre-wrap py-1.5 break-all">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function show(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  if (v instanceof Uint8Array) return `(${v.length} bytes)`;
  if (Array.isArray(v)) return `[${v.map(show).join(", ")}]`;
  if (v && typeof v === "object") {
    try {
      return JSON.stringify(v, (_k, x) => (x instanceof Date ? x.toISOString() : x), 2);
    } catch {
      return String(v);
    }
  }
  return String(v);
}

function Help({ mode }: { mode: Mode }) {
  switch (mode) {
    case "noise":
      return (
        <Explain>
          <p>Digital noise is the “grain” present in every digital image. Manipulated areas often have noise patterns different from the rest of the image.</p>
          <h4>Error level analysis (ELA)</h4>
          <p>The image is re-saved as JPEG (quality 90) and the per-channel difference is amplified. Edited areas are often at a different compression level than the rest: look for bright patches or sharp differences.</p>
          <ul>
            <li><b>Edges:</b> similar edges should have similar brightness; low-contrast edges almost as bright as high-contrast ones.</li>
            <li><b>Textures:</b> similar textures should have similar coloring; detailed textures respond more.</li>
            <li><b>Surfaces:</b> flat, uniform surfaces should look alike whatever their visible color.</li>
          </ul>
          <p>High-detail regions (text, sharp edges) are naturally brighter. Very low-quality JPEGs can look very dark; downscaling boosts high-contrast edges; Adobe products often sharpen on save.</p>
          <h4>Local variance</h4>
          <p>How much each pixel departs from its 8×8 block average. Cloned areas can repeat variance patterns; heavily smoothed areas look too uniform.</p>
          <h4>High frequency</h4>
          <p>Fine detail and texture. Look for sudden transitions from detail to no detail, or unnaturally smooth areas.</p>
          <h4>PRNU pattern (demo)</h4>
          <p>A noise residual (image minus a light blur), enhanced. A weak cue for inconsistencies, not a substitute for real camera fingerprint matching.</p>
        </Explain>
      );
    case "color":
      return (
        <Explain>
          <h4>RGB</h4>
          <p>Authentic images show natural, consistent patterns in all three channels. Look for one channel that looks drastically different around a suspected region: a pasted person can look right to the eye while the blue channel reveals a different light source.</p>
          <h4>HSV</h4>
          <p>Hue is the color type, saturation its intensity, value the brightness. Look for unnatural transitions or patches, especially in saturation (beauty filters, sky replacements, boosted sunsets).</p>
        </Explain>
      );
    case "edges":
      return (
        <Explain>
          <p>Edges are boundaries between areas of the image.</p>
          <h4>Canny</h4>
          <p>Clean, thin lines for the main edges. Authentic images show continuous, natural edge flows; manipulated ones often have broken edges or unnaturally sharp cut lines. The slider sets the strong-edge threshold.</p>
          <h4>Sobel</h4>
          <p>Gradient magnitude above the threshold. Edge strength should be consistent with the lighting.</p>
          <h4>Laplacian of Gaussian</h4>
          <p>Second-derivative response after light smoothing: fine details and subtle transitions. Look for double edges or halos around pasted objects.</p>
        </Explain>
      );
    case "frequency":
      return (
        <Explain>
          <p>Low frequencies are smooth areas and lighting; high frequencies are textures, fine details, sharp edges and noise. The FFT view is the centred log-magnitude spectrum (zero frequency in the middle).</p>
          <ul>
            <li><b>Periodic patterns:</b> bright dots or grids away from the centre, typical of upsampling (GANs, diffusion decoders) and of cloning.</li>
            <li><b>Unnatural smoothness:</b> little high-frequency energy (over-filtering, some AI images).</li>
            <li><b>Inconsistent distribution:</b> rich texture next to unnaturally smooth regions.</li>
          </ul>
          <h4>8×8 block DCT</h4>
          <p>Each 8×8 block (the JPEG grid) is replaced by its DCT coefficients: DC top-left, highest frequencies bottom-right. Compression removes high frequencies (dark bottom-right). Blocks that look different from their neighbours can reveal recompression or splicing.</p>
        </Explain>
      );
    case "pca":
      return (
        <Explain>
          <p>PCA decomposes the image's RGB color cloud into three orthogonal axes of variation.</p>
          <ul>
            <li><b>PC1, the lighting axis</b> (often 40-60% of the variance): brightness, lighting and main shapes. Look for abrupt boundaries (splicing) and mismatched shadows.</li>
            <li><b>PC2, the detection axis</b> (often 20-30%): colors far from the natural gamut. Mostly dark in natural images; white teeth/eyes (whitening), bright face patches (beauty filters), glowing edges (splicing) and saturated skies (replacement) stand out.</li>
            <li><b>PC3, the noise/detail axis</b> (often 10-20%): fine color variations and camera noise. Too smooth (AI), inconsistent across regions (splicing) or blocky (recompression) is suspicious.</li>
            <li><b>PCs → RGB:</b> the three components as a color image, to compare with the original.</li>
          </ul>
          <p>Suggested workflow: check the variance shares, look for bright regions in PC2, cross-check boundaries in PC1, confirm with textures in PC3. Colors that lie close to the PC2 axis stay dark even when edited: a dark area is inconclusive, not proof of authenticity.</p>
        </Explain>
      );
    case "metadata":
      return (
        <Explain>
          <p>EXIF, XMP and IPTC can reveal the camera, lens, settings, GPS position, timestamps and editing software. Screenshots, exports and social-media downloads usually have none, and metadata is easy to strip or forge: treat it as a clue, never as proof.</p>
        </Explain>
      );
  }
}
