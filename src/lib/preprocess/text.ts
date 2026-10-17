import type { Tokenizer } from "@huggingface/tokenizers";
import { getJson } from "../registry";
import type { Model } from "../types";

const tokenizers = new Map<string, Promise<Tokenizer>>();

/** tokenizer.json + tokenizer_config.json from the model folder (as saved by tokenizer.save_pretrained). */
export function loadTokenizer(model: Model): Promise<Tokenizer> {
  let tokenizer = tokenizers.get(model.url);
  if (!tokenizer) {
    tokenizer = Promise.all([
      import("@huggingface/tokenizers"),
      getJson<object>(model.url + "tokenizer.json"),
      getJson<object>(model.url + "tokenizer_config.json").catch(() => ({})),
    ]).then(([{ Tokenizer }, json, config]) => new Tokenizer(json, config));
    tokenizer.catch(() => tokenizers.delete(model.url));
    tokenizers.set(model.url, tokenizer);
  }
  return tokenizer;
}

/**
 * Token ids like Python's tokenizer(text, truncation=True, max_length=maxLength):
 * special tokens ([CLS] … [SEP], <s> … </s>) are kept, the text in between is cut.
 */
export function encode(tokenizer: Tokenizer, text: string, maxLength?: number): number[] {
  const ids = tokenizer.encode(text).ids;
  if (!maxLength || ids.length <= maxLength) return ids;

  const body = tokenizer.encode(text, { add_special_tokens: false }).ids;
  const specials = ids.length - body.length;
  let start = 0; // where the text starts inside `ids`, after the leading special tokens
  while (start < specials && !body.every((id, i) => ids[start + i] === id)) start++;
  return [
    ...ids.slice(0, start),
    ...body.slice(0, Math.max(maxLength - specials, 0)),
    ...ids.slice(start + body.length),
  ];
}
