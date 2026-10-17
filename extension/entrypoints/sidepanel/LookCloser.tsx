import { useEffect, useRef, useState } from "react";
import { Choice } from "@site/components/ui";
import { nextPaint } from "@site/lib/dom";
import { errorLevel, fftSpectrum, highFrequency, pcaBasis, pcaProject, type PcaBasis, type Pixels } from "@site/lib/forensics/image";
import { decodeImage, type RGBAImage } from "@site/lib/preprocess/image";
import { AI_SOURCE_TYPES, OTHER_SOURCE_TYPES, readProvenance, type Provenance } from "@/lib/provenance";

const VIEWS = [
  { value: "ela", label: "Error level" },
  { value: "noise", label: "Noise" },
  { value: "spectrum", label: "Spectrum" },
  { value: "colors", label: "Colors" },
] as const;
type View = (typeof VIEWS)[number]["value"];

const GUIDE: Record<View, { look: string; mislead: string }> = {
  ela: {
    look: "The image is re-saved as JPEG and the difference is amplified. An edited area often stands out: brighter or darker than similar surfaces next to it.",
    mislead: "Edges, text and fine textures are always bright. Images re-saved many times (social networks) look evenly dark.",
  },
  noise: {
    look: "Fine detail and grain. A camera photo has grain everywhere: look for areas that are unnaturally smooth (skin, sky, background), or a sharp line where the grain changes.",
    mislead: "Blur, compression, noise reduction and beauty filters smooth images too, and blurred backgrounds are smooth in real photos.",
  },
  spectrum: {
    look: "The image's frequencies: smooth areas in the centre, fine detail towards the edges. Bright dots or a grid away from the centre can come from upscaling, which AI image generators do.",
    mislead: "Resizing, JPEG compression and regular patterns (fabric, windows, tiles) create dots too. A clean spectrum doesn't prove the image is real.",
  },
  colors: {
    look: "The image's second axis of color variation (PCA), mostly dark in natural photos. Bright teeth or eyes, glowing patches or outlines can reveal retouching or pasted elements.",
    mislead: "Colorful scenes light up naturally, and a dark result proves nothing: some edits stay invisible here.",
  },
};

/** File facts and forensic views under the score, so that people check the image for themselves. */
export function LookCloser({ image }: { image: Blob }) {
  const [pixels, setPixels] = useState<RGBAImage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPixels(null);
    setError(null);
    decodeImage(image).then(
      (p) => !cancelled && setPixels(p),
      () => !cancelled && setError("This image can't be decoded by the browser."),
    );
    return () => {
      cancelled = true;
    };
  }, [image]);

  return (
    <section className="flex flex-col gap-3 border-t border-border pt-4">
      <div>
        <h2 className="font-semibold">Look closer</h2>
        <p className="text-xs text-muted">
          The score is one opinion, and it can be wrong. Check for yourself: no single clue is proof, so look for several
          that agree, and for where the image first appeared.
        </p>
      </div>
      <FileFacts image={image} pixels={pixels} />
      {error ? <p className="text-sm text-fake">{error}</p> : <Views image={image} pixels={pixels} />}
    </section>
  );
}

// --- What the file says about itself ---------------------------------------------------------

interface Facts {
  provenance: Provenance;
  /** The fields worth a glance: camera, date, software, location. */
  main: [string, string][];
  /** Every field exifr could read. */
  all: [string, string][];
}

function FileFacts({ image, pixels }: { image: Blob; pixels: RGBAImage | null }) {
  const [facts, setFacts] = useState<Facts | null>(null);

  useEffect(() => {
    let cancelled = false;
    setFacts(null);
    readFacts(image).then((f) => !cancelled && setFacts(f));
    return () => {
      cancelled = true;
    };
  }, [image]);

  const kind = image.type.replace(/^image\//, "").toUpperCase() || "Image";
  const size = image.size > 1e6 ? `${(image.size / 1e6).toFixed(1)} MB` : `${Math.ceil(image.size / 1e3)} KB`;
  const header = [kind, pixels && `${pixels.width} × ${pixels.height}`, size].filter(Boolean).join(" · ");

  if (!facts) return <p className="text-xs text-muted">{header} · reading the file…</p>;
  const { provenance: p, main, all } = facts;
  const aiType = p.sourceType ? AI_SOURCE_TYPES[p.sourceType] : undefined;
  const otherType = p.sourceType && !aiType ? OTHER_SOURCE_TYPES[p.sourceType] ?? p.sourceType : undefined;
  const labelled = !!(p.sourceType || p.c2pa !== undefined || p.generation.length);

  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="text-xs text-muted">{header}</p>

      {aiType && (
        <p className="rounded-md border border-fake/40 bg-fake/10 p-2">
          The file says it was <b>{aiType}</b>.
        </p>
      )}
      {otherType && <p>The file says it is <b>{otherType}</b>.</p>}
      {p.c2pa !== undefined && (
        <p>
          It carries <b>Content Credentials</b> (C2PA){p.c2pa && <> from <b>{p.c2pa}</b></>}: a signed record of how it was
          made. This panel doesn't check the signature,{" "}
          <a href="https://contentcredentials.org/verify" target="_blank" rel="noopener noreferrer" className="underline">
            contentcredentials.org/verify
          </a>{" "}
          does.
        </p>
      )}
      {p.generation.map(([keyword, text]) => (
        <details key={keyword} className="rounded-md border border-fake/40 bg-fake/10 p-2">
          <summary className="cursor-pointer">
            It holds <b>AI generation settings</b> ({keyword})
          </summary>
          <p className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all text-xs">{text.slice(0, 2000)}</p>
        </details>
      ))}
      {labelled && <p className="text-xs text-muted">These labels are written by software: they can be removed or faked.</p>}

      {main.length > 0 && <Fields rows={main} />}
      {!labelled && main.length === 0 && (
        <p className="text-muted">
          No camera, software or origin data in this file. Most websites remove it, and screenshots or copy-paste lose
          it, so its absence proves nothing.
        </p>
      )}
      {all.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted hover:text-fg">All metadata ({all.length} fields)</summary>
          <div className="mt-1 max-h-72 overflow-auto">
            <Fields rows={all} />
          </div>
        </details>
      )}
    </div>
  );
}

function Fields({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="font-medium">{k}</dt>
          <dd className="whitespace-pre-wrap break-all text-muted">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

async function readFacts(image: Blob): Promise<Facts> {
  const [provenance, meta] = await Promise.all([
    image.arrayBuffer().then((b) => readProvenance(new Uint8Array(b))),
    import("exifr")
      .then(({ default: exifr }) =>
        exifr.parse(image, { tiff: true, exif: true, gps: true, interop: true, xmp: true, icc: true, iptc: true, jfif: true, ihdr: true }),
      )
      .then((m: Record<string, unknown> | undefined) => m ?? {})
      .catch(() => ({}) as Record<string, unknown>),
  ]);

  // XMP namespaces exifr doesn't know end up in nested objects.
  const pick = (key: string): unknown =>
    meta[key] ?? Object.values(meta).find((v): v is Record<string, unknown> => !!v && typeof v === "object" && key in v)?.[key];
  const make = pick("Make"), model = pick("Model");
  const camera = model ? (make && !String(model).startsWith(String(make)) ? `${make} ${model}` : String(model)) : make;
  const taken = pick("DateTimeOriginal") ?? pick("CreateDate");
  const { latitude, longitude } = meta as { latitude?: number; longitude?: number };
  const main: [string, unknown][] = [
    ["Camera", camera],
    ["Lens", pick("LensModel")],
    ["Taken", taken instanceof Date ? taken.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : taken],
    ["Software", pick("Software") ?? pick("CreatorTool")],
    ["Credit", pick("Credit")],
    ["Location", typeof latitude === "number" && typeof longitude === "number" ? `${latitude.toFixed(5)}, ${longitude.toFixed(5)}` : undefined],
  ];
  return {
    provenance,
    main: main.filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, display(v)]),
    all: Object.entries(meta).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, display(v)]),
  };
}

function display(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  if (v instanceof Uint8Array) return `(${v.length} bytes)`;
  if (Array.isArray(v)) return `[${v.map(display).join(", ")}]`;
  if (v && typeof v === "object") {
    try {
      return JSON.stringify(v, (_k, x) => (x instanceof Date ? x.toISOString() : x), 1);
    } catch {
      return String(v);
    }
  }
  return String(v);
}

// --- Forensic views --------------------------------------------------------------------------

interface Shown {
  image: Pixels;
  note?: string;
  // what produced it: the canvas keeps the previous view until the new one is ready
  pixels: RGBAImage;
  view: View;
}

function Views({ image, pixels }: { image: Blob; pixels: RGBAImage | null }) {
  // No view until one is picked: computing them on every right-click would slow the score down.
  const [view, setView] = useState<View | null>(null);
  const [shown, setShown] = useState<Shown | null>(null);
  const [original, setOriginal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const pca = useRef<{ pixels: RGBAImage; basis: PcaBasis } | null>(null);
  const ready = !!shown && shown.pixels === pixels && shown.view === view;

  useEffect(() => {
    const u = URL.createObjectURL(image);
    setUrl(u);
    setOriginal(false);
    return () => URL.revokeObjectURL(u);
  }, [image]);

  useEffect(() => {
    if (!pixels || !view) return;
    let cancelled = false;
    setError(null);
    (async () => {
      await nextPaint(); // show "Computing…" first
      if (cancelled) return;
      try {
        const r = await compute(pixels, view, image.type, pca);
        if (!cancelled) setShown({ ...r, pixels, view });
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pixels, view, image.type]);

  useEffect(() => {
    const c = canvas.current;
    if (!c || !shown) return;
    c.width = shown.image.width;
    c.height = shown.image.height;
    c.getContext("2d")!.putImageData(new ImageData(shown.image.data, shown.image.width, shown.image.height), 0, 0);
  }, [shown]);

  const label = VIEWS.find((v) => v.value === view)?.label;

  return (
    <div className="flex flex-col gap-2">
      <Choice
        options={VIEWS}
        value={view}
        disabled={!pixels}
        onChange={(v) => {
          setView(v);
          setOriginal(false);
        }}
      />
      {!view && <p className="text-xs text-muted">Pick a view to see what the eye misses.</p>}
      {view && (
        <>
          <button
            type="button"
            onClick={() => setOriginal((o) => !o)}
            title="Click to compare with the original"
            className="overflow-hidden rounded-md border border-border"
          >
            <canvas ref={canvas} className={`block w-full ${original ? "hidden" : ""} ${ready ? "" : "opacity-40"}`} />
            {original && url && <img src={url} alt="Original" className="block w-full" />}
          </button>
          <p className="text-xs text-muted">
            {original ? "Original" : ready ? label : error ? "Could not compute this view" : "Computing…"} · click the image to
            compare
          </p>
          {error && <p className="text-sm text-fake">{error}</p>}
          {ready && shown.note && <p className="text-xs text-muted">{shown.note}</p>}
          <p className="text-sm">{GUIDE[view].look}</p>
          <p className="text-xs text-muted">
            <b className="text-fg">Can mislead:</b> {GUIDE[view].mislead}
          </p>
        </>
      )}
    </div>
  );
}

async function compute(
  img: RGBAImage, view: View, type: string, pca: { current: { pixels: RGBAImage; basis: PcaBasis } | null },
): Promise<{ image: Pixels; note?: string }> {
  switch (view) {
    case "ela":
      return {
        image: await errorLevel(img),
        note: type === "image/jpeg" ? undefined : "Error level is meant for JPEG files: on other formats, it mostly shows edges.",
      };
    case "noise":
      return { image: highFrequency(img) };
    case "spectrum": {
      const r = fftSpectrum(img);
      const [w, h] = r.region;
      return { image: r.image, note: w === img.width && h === img.height ? undefined : `Spectrum of the central ${w}×${h} region.` };
    }
    case "colors":
      if (pca.current?.pixels !== img) pca.current = { pixels: img, basis: pcaBasis(img) };
      return { image: pcaProject(img, pca.current.basis, "pc2") };
  }
}
