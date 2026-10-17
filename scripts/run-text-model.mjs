// Runs a text model folder with the app's own runtime (onnxruntime-web WebAssembly + tokenizers.js), the way
// src/lib/inference.ts and src/lib/preprocess/text.ts do, to check an export before opening the page.
//
//   node scripts/run-text-model.mjs public/models/<id> texts.json [out.json]
//
// texts.json is a JSON array of strings. Prints P(label) per text; out.json gets the full results.
// The Python detector the model was exported from must give the same probabilities (to ~1e-5).
import fs from "node:fs";
import path from "node:path";
import * as ort from "onnxruntime-web";
import { Tokenizer } from "@huggingface/tokenizers";

const [folder, textsFile, outFile] = process.argv.slice(2);
if (!folder || !textsFile) {
  console.error("usage: node scripts/run-text-model.mjs <model folder> <texts.json> [out.json]");
  process.exit(1);
}
const read = (name) => JSON.parse(fs.readFileSync(path.join(folder, name), "utf8"));
const config = read("config.json");
let tokCfg = {};
try {
  tokCfg = read("tokenizer_config.json");
} catch {
  // optional, as in the page
}
const tokenizer = new Tokenizer(read("tokenizer.json"), tokCfg);

// Same as encode() in src/lib/preprocess/text.ts
function encode(text, maxLength) {
  const ids = tokenizer.encode(text).ids;
  if (!maxLength || ids.length <= maxLength) return ids;
  const body = tokenizer.encode(text, { add_special_tokens: false }).ids;
  const specials = ids.length - body.length;
  let start = 0;
  while (start < specials && !body.every((id, i) => ids[start + i] === id)) start++;
  return [...ids.slice(0, start), ...body.slice(0, Math.max(maxLength - specials, 0)), ...ids.slice(start + body.length)];
}

// Same as toProbabilities() in src/lib/inference.ts
function toProbabilities(raw, output) {
  if (output === "probs") return raw;
  if (output === "sigmoid") {
    const p = 1 / (1 + Math.exp(-raw[0]));
    return [1 - p, p];
  }
  const max = Math.max(...raw);
  const exps = raw.map((v) => Math.exp(v - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((v) => v / sum);
}

ort.env.logLevel = "error";
const session = await ort.InferenceSession.create(fs.readFileSync(path.join(folder, config.model ?? "model.onnx")), {
  executionProviders: ["wasm"],
  graphOptimizationLevel: "all",
});
const maxLength = config.preprocess.find((s) => s.op === "tokenize")?.max_length;
const results = [];
for (const text of JSON.parse(fs.readFileSync(textsFile, "utf8"))) {
  const ids = encode(text, maxLength);
  const n = ids.length;
  const inputs = {
    input_ids: BigInt64Array.from(ids, (id) => BigInt(id)),
    attention_mask: new BigInt64Array(n).fill(1n),
    token_type_ids: new BigInt64Array(n),
  };
  const feeds = {};
  for (const name of session.inputNames) feeds[name] = new ort.Tensor("int64", inputs[name], [1, n]);
  const out = await session.run(feeds);
  const probs = toProbabilities(Array.from(out[session.outputNames[0]].data, Number), config.output ?? "logits");
  results.push({ tokens: n, probs });
  console.log(config.labels.map((l, i) => `${l} ${(probs[i] * 100).toFixed(1)}%`).join("  "), `(${n} tokens)`);
}
if (outFile) fs.writeFileSync(outFile, JSON.stringify({ labels: config.labels, results }));
