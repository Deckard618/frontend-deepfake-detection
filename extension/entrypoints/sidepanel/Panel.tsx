import { useCallback, useEffect, useRef, useState } from "react";
import { browser, type Browser } from "wxt/browser";
import { Progress, Result } from "@site/components/Detector";
import { DropZone } from "@site/components/ui";
import { isDownloaded, modelFileUrl, predict } from "@site/lib/inference";
import { REPO_URL } from "@site/lib/links";
import { loadRegistry } from "@site/lib/registry";
import type { Model, Phase, Prediction } from "@site/lib/types";
import { requestKey, type CheckRequest } from "@/lib/messages";
import { LookCloser } from "./LookCloser";

const MAX_AGE = 5 * 60_000; // an older request was meant for a panel that never opened
const COPY_HINT = "Copy it instead (right-click → Copy image) and paste it here.";

type Status =
  | { kind: "idle" }
  | { kind: "fetching" }
  | { kind: "busy"; phase: Phase }
  | { kind: "done"; result: Prediction }
  | { kind: "error"; message: string };

/** The image being checked, and the page it came from. */
interface Picture {
  image: Blob;
  pageUrl?: string;
}

export function Panel() {
  const [models, setModels] = useState<Model[]>([]);
  const [configErrors, setConfigErrors] = useState<string[]>([]);
  const [modelId, setModelId] = useState("");
  const [picture, setPicture] = useState<Picture | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [downloaded, setDownloaded] = useState(false);
  // Pictures and runs can overlap (a right-click while the previous image is still running): the newest wins.
  const latest = useRef(0);
  const queue = useRef(Promise.resolve());

  useEffect(() => {
    loadRegistry()
      .then(({ models, errors }) => {
        setModels(models);
        setConfigErrors(errors);
        const saved = readSetting("model");
        setModelId(models.find((m) => m.id === saved)?.id ?? models[0]?.id ?? "");
      })
      .catch((e: Error) => setConfigErrors([`Could not load models/index.json (${e.message})`]));
  }, []);

  const model = models.find((m) => m.id === modelId);
  const bundled = !!model && modelFileUrl(model).startsWith(location.origin);
  const busy = status.kind === "busy";

  useEffect(() => {
    if (model && !bundled && !busy) isDownloaded(model).then(setDownloaded);
  }, [model, bundled, busy]);

  const fail = useCallback((e: unknown) => {
    ++latest.current;
    setPicture(null);
    setStatus({ kind: "error", message: e instanceof Error ? e.message : String(e) });
  }, []);

  const show = useCallback(
    async (next: Picture | Promise<Picture>) => {
      const id = ++latest.current;
      setStatus({ kind: "fetching" });
      try {
        const picture = await next;
        if (id !== latest.current) return;
        setPicture(picture);
        setStatus({ kind: "idle" });
      } catch (e) {
        if (id === latest.current) fail(e);
      }
    },
    [fail],
  );

  // Every new picture or model runs right away, one at a time (runs share one ONNX session).
  useEffect(() => {
    if (!model || !picture) return;
    const id = ++latest.current;
    const report = (s: Status) => {
      if (id === latest.current) setStatus(s);
    };
    report({ kind: "busy", phase: { phase: "load" } });
    queue.current = queue.current.then(async () => {
      if (id !== latest.current) return; // replaced while waiting
      try {
        report({ kind: "done", result: await predict(model, picture.image, (phase) => report({ kind: "busy", phase })) });
      } catch (e) {
        console.error(e);
        report({ kind: "error", message: e instanceof Error ? e.message : String(e) });
      }
    });
  }, [model, picture]);

  // Right-clicks: the background leaves a request for this window's panel in session storage.
  useEffect(() => {
    let active = true;
    let key: string | undefined;
    const take = (request: CheckRequest) => {
      if (!active || !key) return;
      void browser.storage.session.remove(key);
      if ("error" in request) fail(new Error(request.error));
      else void show(download(request.src, request.pageUrl));
    };
    const onChanged = (changes: Record<string, Browser.storage.StorageChange>, area: string) => {
      const request = key && area === "session" ? (changes[key]?.newValue as CheckRequest | undefined) : undefined;
      if (request) take(request);
    };
    browser.storage.onChanged.addListener(onChanged);
    void browser.windows.getCurrent().then(async ({ id }) => {
      key = requestKey(id!);
      const pending = (await browser.storage.session.get(key))[key] as CheckRequest | undefined;
      if (pending && Date.now() - pending.at < MAX_AGE) take(pending);
    });
    return () => {
      active = false;
      browser.storage.onChanged.removeListener(onChanged);
    };
  }, [show, fail]);

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = e.clipboardData?.files[0];
      if (file?.type.startsWith("image/")) void show({ image: file });
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [show]);

  return (
    <div className="flex min-h-screen flex-col gap-4 p-4">
      <header className="flex items-center gap-2.5">
        <img src="/icon/48.png" alt="" className="h-8 w-8" />
        <div>
          <h1 className="font-semibold leading-tight">AI image check</h1>
          <p className="text-xs text-muted">Runs on this device. Nothing is uploaded.</p>
        </div>
      </header>

      <DropZone accept="image" onFile={(file) => void show({ image: file })} onUrl={(url) => void show(download(url))}>
        <Preview picture={picture} />
      </DropZone>

      <div aria-live="polite">
        {status.kind === "fetching" && <p className="text-sm text-muted">Getting the image…</p>}
        {status.kind === "busy" && (
          // Bundled models are read from disk: "Downloading" would be misleading.
          <Progress phase={bundled && status.phase.phase === "download" ? { phase: "load" } : status.phase} />
        )}
        {status.kind === "error" && <p className="text-sm text-fake">{status.message}</p>}
        {status.kind === "done" && <Result result={status.result} />}
      </div>

      {picture && <LookCloser image={picture.image} />}

      {configErrors.length > 0 && (
        <div className="rounded-lg border border-fake/40 bg-fake/10 p-3 text-sm">
          {configErrors.map((e) => <p key={e}>{e}</p>)}
        </div>
      )}

      {model && (
        <section className="flex flex-col gap-1.5 border-t border-border pt-4">
          <label htmlFor="model" className="text-xs font-medium uppercase tracking-wide text-muted">Model</label>
          <select
            id="model"
            value={modelId}
            onChange={(e) => {
              setModelId(e.target.value);
              writeSetting("model", e.target.value);
            }}
            className="rounded-md border border-border bg-bg px-2 py-1.5 text-sm"
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
          <p className="text-xs text-muted">
            {bundled
              ? "Included in the extension, works offline"
              : downloaded
                ? "✓ Downloaded, works offline"
                : "Downloaded on first use, then kept by the browser"}
          </p>
        </section>
      )}

      <footer className="mt-auto flex flex-col gap-2 border-t border-border pt-3 text-xs text-muted">
        <p>
          Scores are probabilities, not proof. Every detector makes mistakes, especially on compressed or edited images
          and on images from the newest AI generators.
        </p>
        {REPO_URL && (
          <p className="[&_a:hover]:text-fg [&_a]:underline">
            <a href={REPO_URL} target="_blank" rel="noopener noreferrer">Source code</a>
          </p>
        )}
      </footer>
    </div>
  );
}

function Preview({ picture }: { picture: Picture | null }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!picture) return setUrl(null);
    const u = URL.createObjectURL(picture.image);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [picture]);

  if (!picture || !url) {
    return (
      <>
        <span className="font-medium">Right-click an image on any page</span>
        <span className="text-muted">and choose “Check image for AI”. You can also drop, paste or choose one here.</span>
      </>
    );
  }
  return (
    <>
      <img src={url} alt="Image being checked" className="max-h-64 rounded-md object-contain" />
      <span className="text-xs text-muted">
        {picture.pageUrl && `From ${new URL(picture.pageUrl).hostname} · `}drop, paste or click to change
      </span>
    </>
  );
}

/** Downloads an image with the extension's access to every site, which CORS would otherwise block. */
async function download(src: string, pageUrl?: string): Promise<Picture> {
  let res: Response;
  try {
    res = await fetch(src, { credentials: "include" }); // with cookies, for images behind a sign-in
  } catch {
    // Without access to that site (it can be revoked in the browser's settings), only an anonymous request passes CORS.
    res = await fetch(src).catch(() => {
      throw new Error(`Couldn't download this image. ${COPY_HINT}`);
    });
  }
  if (!res.ok) throw new Error(`The site refused to send this image (HTTP ${res.status}). ${COPY_HINT}`);
  const image = await res.blob();
  if (image.type === "image/svg+xml") throw new Error("This is a vector drawing (SVG), not a picture the models can check.");
  if (image.type.startsWith("text/")) throw new Error(`The site sent a web page instead of the image. ${COPY_HINT}`);
  return { image, pageUrl };
}

function readSetting(name: string) {
  try {
    return localStorage.getItem(name);
  } catch {
    return null;
  }
}

function writeSetting(name: string, value: string) {
  try {
    localStorage.setItem(name, value);
  } catch {
    // not kept, the default model is used next time
  }
}
