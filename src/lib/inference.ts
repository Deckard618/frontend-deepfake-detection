import type * as OrtModule from "onnxruntime-web";
// The package doesn't export its .wasm files, so this one is imported by path. Vite fingerprints it.
import wasmUrl from "/node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm?url";
import { nextPaint } from "./dom";
import { fetchModelFile, isModelFileCached } from "./modelFiles";
import { decodeImage, preprocessImage } from "./preprocess/image";
import { encode, loadTokenizer } from "./preprocess/text";
import type { Model, Phase, Prediction, Step } from "./types";

type Ort = typeof OrtModule;
type Session = OrtModule.InferenceSession;

let ortModule: Promise<Ort> | undefined;

/**
 * ONNX Runtime (WebAssembly build) is loaded on first use and kept in its own chunk:
 * its worker threads re-import that chunk, so it must not contain app code.
 */
function loadOrt(): Promise<Ort> {
  ortModule ??= import("onnxruntime-web/wasm").then(
    (ort) => {
      ort.env.wasm.wasmPaths = { wasm: wasmUrl };
      ort.env.wasm.proxy = true; // inference runs in a worker, the page stays responsive
      ort.env.logLevel = "error"; // hide harmless warnings such as "Unknown CPU vendor"
      return ort;
    },
    (error) => {
      ortModule = undefined;
      throw error;
    },
  );
  return ortModule;
}

export function modelFileUrl(model: Model) {
  return new URL(model.model ?? "model.onnx", model.url).href;
}

export function isDownloaded(model: Model): Promise<boolean> {
  return isModelFileCached(modelFileUrl(model), model.version ?? "1");
}

// One session at a time: switching model releases the previous one (models can be big).
let active: { key: string; session: Promise<Session> } | undefined;

function getSession(model: Model, onPhase: (p: Phase) => void): Promise<Session> {
  const key = `${model.url}@${model.version ?? "1"}`;
  if (active?.key !== key) {
    active?.session.then((s) => s.release()).catch(() => {});
    const session = createSession(model, onPhase);
    session.catch(() => {
      if (active?.session === session) active = undefined; // allow a retry
    });
    active = { key, session };
  }
  return active.session;
}

async function createSession(model: Model, onPhase: (p: Phase) => void): Promise<Session> {
  const ort = await loadOrt();
  const bytes = await fetchModelFile(modelFileUrl(model), model.version ?? "1", (loaded, total) =>
    onPhase({ phase: "download", loaded, total }),
  );
  onPhase({ phase: "load" });
  return ort.InferenceSession.create(bytes, { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
}

/** Runs a model on an image file or a text, entirely in the browser. */
export async function predict(model: Model, input: Blob | string, onPhase: (p: Phase) => void = () => {}): Promise<Prediction> {
  const ort = await loadOrt();
  const session = await getSession(model, onPhase);
  onPhase({ phase: "run" });
  await nextPaint(); // show "Analyzing…" before the synchronous preprocessing

  const start = performance.now();
  const feeds =
    model.task === "image"
      ? await imageFeeds(ort, session, model, input as Blob)
      : await textFeeds(ort, session, model, input as string);
  const outputs = await session.run(feeds);
  const raw = Array.from(outputs[session.outputNames[0]].data as ArrayLike<number | bigint>, Number);

  const probs = toProbabilities(raw, model.output ?? "logits");
  if (probs.length !== model.labels.length) {
    throw new Error(`The model returns ${probs.length} scores but config.json lists ${model.labels.length} labels`);
  }
  return { scores: model.labels.map((label, i) => ({ label, p: probs[i] })), ms: performance.now() - start };
}

async function imageFeeds(ort: Ort, session: Session, model: Model, file: Blob) {
  const tensor = preprocessImage(await decodeImage(file), model.preprocess);
  return { [session.inputNames[0]]: new ort.Tensor("float32", tensor.data, [1, ...tensor.dims]) };
}

async function textFeeds(ort: Ort, session: Session, model: Model, text: string) {
  const step = model.preprocess.find((s): s is Extract<Step, { op: "tokenize" }> => s.op === "tokenize");
  const ids = encode(await loadTokenizer(model), text, step?.max_length);
  const n = ids.length;
  const inputs: Record<string, BigInt64Array> = {
    input_ids: BigInt64Array.from(ids, (id) => BigInt(id)),
    attention_mask: new BigInt64Array(n).fill(1n),
    token_type_ids: new BigInt64Array(n),
  };
  const feeds: Record<string, OrtModule.Tensor> = {};
  for (const name of session.inputNames) {
    if (!inputs[name]) throw new Error(`Text model input "${name}" is not supported (use input_ids, attention_mask, token_type_ids)`);
    feeds[name] = new ort.Tensor("int64", inputs[name], [1, n]);
  }
  return feeds;
}

function toProbabilities(raw: number[], output: NonNullable<Model["output"]>): number[] {
  if (output === "probs") return raw;
  if (output === "sigmoid") {
    if (raw.length !== 1) throw new Error(`"output": "sigmoid" expects one score, the model returns ${raw.length}`);
    const p = 1 / (1 + Math.exp(-raw[0]));
    return [1 - p, p];
  }
  const max = Math.max(...raw);
  const exps = raw.map((v) => Math.exp(v - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((v) => v / sum);
}
