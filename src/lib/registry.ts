import type { Model, ModelConfig, Step } from "./types";

const MODELS_URL = new URL(`${import.meta.env.BASE_URL}models/`, window.location.href).href;

const IMAGE_OPS = ["resize", "center_crop", "to_tensor", "normalize", "forensic6"];
const TEXT_OPS = ["tokenize"];

export async function getJson<T>(url: string): Promise<T> {
  // no-cache: always revalidate, so an edited config is picked up on the next visit.
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

let registry: Promise<{ models: Model[]; errors: string[] }> | undefined;

/** Loads every model listed in public/models/index.json, once. A broken config doesn't hide the others. */
export function loadRegistry() {
  registry ??= load().catch((e) => {
    registry = undefined; // retry next time
    throw e;
  });
  return registry;
}

async function load(): Promise<{ models: Model[]; errors: string[] }> {
  const ids = await getJson<string[]>(MODELS_URL + "index.json");
  const results = await Promise.allSettled(ids.map(loadModel));
  const models: Model[] = [];
  const errors: string[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") models.push(r.value);
    else errors.push(r.reason instanceof Error ? r.reason.message : String(r.reason));
  }
  return { models, errors };
}

async function loadModel(id: string): Promise<Model> {
  const url = `${MODELS_URL}${id}/`;
  const config = await getJson<ModelConfig>(url + "config.json");
  const problem = validate(config);
  if (problem) throw new Error(`models/${id}/config.json: ${problem}`);
  return { ...config, id, url };
}

function validate(c: ModelConfig): string | null {
  if (!c.name) return `"name" is missing`;
  if (c.task !== "image" && c.task !== "text") return `"task" must be "image" or "text"`;
  if (!Array.isArray(c.labels) || c.labels.length === 0) return `"labels" must list the output classes`;
  if (c.output && !["logits", "probs", "sigmoid"].includes(c.output)) return `"output" must be logits, probs or sigmoid`;
  if (c.output === "sigmoid" && c.labels.length !== 2) return `"output": "sigmoid" needs exactly 2 labels`;
  if (!Array.isArray(c.preprocess) || c.preprocess.length === 0) return `"preprocess" must list at least one step`;
  const allowed = c.task === "image" ? IMAGE_OPS : TEXT_OPS;
  const bad = c.preprocess.find((s: Step) => !allowed.includes(s.op));
  if (bad) return `"${bad.op}" is not a valid op for ${c.task} models (use: ${allowed.join(", ")})`;
  return null;
}
