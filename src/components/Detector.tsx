import { useEffect, useState } from "react";
import { isDownloaded, predict } from "../lib/inference";
import { clearModelFiles } from "../lib/modelFiles";
import { loadRegistry } from "../lib/registry";
import type { Model, Phase, Prediction, Step } from "../lib/types";
import { Card, DropZone } from "./ui";

type Status =
  | { kind: "idle" }
  | { kind: "busy"; phase: Phase }
  | { kind: "done"; result: Prediction }
  | { kind: "error"; message: string };

/** One detection tab: it lists the registry's models of its task. The input lives in App, so it survives tab changes. */
type Props =
  | { task: "image"; image: File | null; onImage: (file: File) => void }
  | { task: "text"; text: string; onText: (text: string) => void };

export function Detector(props: Props) {
  const { task } = props;
  const [models, setModels] = useState<Model[] | null>(null); // null while the registry loads
  const [configErrors, setConfigErrors] = useState<string[]>([]);
  const [modelId, setModelId] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [downloaded, setDownloaded] = useState(false);

  useEffect(() => {
    loadRegistry()
      .then(({ models, errors }) => {
        const ofTask = models.filter((m) => m.task === task);
        setModels(ofTask);
        setConfigErrors(errors);
        setModelId(ofTask[0]?.id ?? "");
      })
      .catch((e: Error) => {
        setModels([]);
        setConfigErrors([`Could not load models/index.json (${e.message})`]);
      });
  }, [task]);

  const model = models?.find((m) => m.id === modelId);
  const busy = status.kind === "busy";
  const image = props.task === "image" ? props.image : null;

  useEffect(() => {
    if (model && !busy) isDownloaded(model).then(setDownloaded);
  }, [model, busy]);

  useEffect(() => setStatus({ kind: "idle" }), [image]);

  const input = props.task === "image" ? props.image : props.text.trim() ? props.text : null;

  async function analyze() {
    if (!model || !input) return;
    setStatus({ kind: "busy", phase: { phase: "load" } });
    try {
      const result = await predict(model, input, (phase) => setStatus({ kind: "busy", phase }));
      setStatus({ kind: "done", result });
    } catch (e) {
      console.error(e);
      setStatus({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      {configErrors.length > 0 && (
        <div className="rounded-lg border border-fake/40 bg-fake/10 p-3 text-sm">
          {configErrors.map((e) => <p key={e}>{e}</p>)}
        </div>
      )}

      {model ? (
        <Card className="flex flex-col gap-4">
          {props.task === "image" ? (
            <DropZone accept="image" onFile={props.onImage} disabled={busy}>
              <ImagePreview file={props.image} />
            </DropZone>
          ) : (
            <div className="flex flex-col gap-1.5">
              <textarea
                value={props.text}
                disabled={busy}
                onChange={(e) => {
                  props.onText(e.target.value);
                  setStatus({ kind: "idle" });
                }}
                placeholder="Paste the text to analyze…"
                rows={10}
                className="w-full resize-y rounded-lg border border-border bg-bg p-3 text-sm"
              />
              <p className="text-xs text-muted">{textHint(model)}</p>
            </div>
          )}

          {/* What to analyze comes first. The model, its details and its cache come after, one line unless opened. */}
          <section className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <label htmlFor="model" className="font-medium">Model</label>
              <select
                id="model"
                value={modelId}
                disabled={busy}
                onChange={(e) => {
                  setModelId(e.target.value);
                  setStatus({ kind: "idle" });
                }}
                className="max-w-full rounded-md border border-border bg-bg px-2 py-1"
              >
                {models?.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </div>
            <p className="text-xs text-muted">
              {downloaded ? (
                <>
                  ✓ Downloaded, runs offline ·{" "}
                  <button className="underline hover:text-fg" disabled={busy} onClick={() => clearModelFiles().then(() => setDownloaded(false))}>
                    delete downloaded models
                  </button>
                </>
              ) : (
                "Downloaded on first use, then kept by the browser"
              )}
            </p>
            {model.description && (
              <details className="text-xs text-muted">
                <summary className="w-fit cursor-pointer hover:text-fg">About this model</summary>
                <p className="mt-1.5 text-sm">{model.description}</p>
              </details>
            )}
          </section>

          <button
            onClick={analyze}
            disabled={!input || busy}
            className="rounded-lg bg-accent px-4 py-2.5 font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Working…" : "Analyze"}
          </button>

          <div aria-live="polite">
            {status.kind === "busy" && <Progress phase={status.phase} />}
            {status.kind === "error" && <p className="text-sm text-fake">{status.message}</p>}
            {status.kind === "done" && <Result result={status.result} />}
          </div>
        </Card>
      ) : (
        configErrors.length === 0 && (
          <p className="text-sm text-muted">{models ? `No ${task} detection model is available yet.` : "Loading models…"}</p>
        )
      )}
    </div>
  );
}

/** What a text model reads, from its tokenize step. An English word is about 1.3 tokens. */
function textHint(model: Model) {
  const step = model.preprocess.find((s): s is Extract<Step, { op: "tokenize" }> => s.op === "tokenize");
  const reads = step?.max_length
    ? `Reads the first ${step.max_length} tokens, about ${Math.round((step.max_length * 0.75) / 50) * 50} words. `
    : "";
  return `${reads}Short texts give less reliable scores.`;
}

function ImagePreview({ file }: { file: File | null }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file) return setUrl(null);
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  if (!url) {
    return (
      <>
        <span className="font-medium">Drop an image here</span>
        <span className="text-muted">or click to choose one, or paste it</span>
      </>
    );
  }
  return (
    <>
      <img src={url} alt="Selected image" className="max-h-72 rounded-md object-contain" />
      <span className="text-xs text-muted">{file?.name} · click, drop or paste to change</span>
    </>
  );
}

export function Progress({ phase }: { phase: Phase }) {
  const mb = (bytes: number) => (bytes / 1e6).toFixed(0);
  let label = "Analyzing…";
  let fraction: number | null = null;
  if (phase.phase === "download") {
    label = phase.total ? `Downloading model · ${mb(phase.loaded)} of ${mb(phase.total)} MB` : `Downloading model · ${mb(phase.loaded)} MB`;
    fraction = phase.total ? Math.min(phase.loaded / phase.total, 1) : null;
  } else if (phase.phase === "load") {
    label = "Loading model…";
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted">{label}</p>
      <div className="h-1.5 overflow-hidden rounded-full bg-border">
        <div
          className={`h-full rounded-full bg-accent transition-[width] ${fraction === null ? "w-full animate-pulse" : ""}`}
          style={fraction === null ? undefined : { width: `${fraction * 100}%` }}
        />
      </div>
    </div>
  );
}

const FAKE_LABEL = /fake|generated|synthetic|manipulated|machine|^ai$/i;
const REAL_LABEL = /real|human|authentic|pristine/i;

function tone(label: string) {
  return FAKE_LABEL.test(label) ? "fake" : REAL_LABEL.test(label) ? "real" : "accent";
}

export function Result({ result }: { result: Prediction }) {
  const top = result.scores.reduce((a, b) => (b.p > a.p ? b : a));
  const color = { fake: "text-fake", real: "text-real", accent: "text-accent" };
  const bar = { fake: "bg-fake", real: "bg-real", accent: "bg-accent" };
  return (
    <div className="flex flex-col gap-3">
      <p className={`text-2xl font-semibold capitalize ${color[tone(top.label)]}`}>
        {top.label} <span className="font-normal">· {(top.p * 100).toFixed(1)}%</span>
      </p>
      {result.scores.map((s) => (
        <div key={s.label} className="flex items-center gap-3 text-sm">
          <span className="w-24 shrink-0 capitalize">{s.label}</span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-border">
            <div className={`h-full rounded-full ${bar[tone(s.label)]}`} style={{ width: `${s.p * 100}%` }} />
          </div>
          <span className="w-14 text-right tabular-nums">{(s.p * 100).toFixed(1)}%</span>
        </div>
      ))}
      <p className="text-xs text-muted">Analyzed in {Math.round(result.ms)} ms on this device.</p>
    </div>
  );
}
