/**
 * What an image file says about its own origin, read from its bytes. These labels are written by the
 * software that made the file and removed by most websites, so their absence proves nothing.
 *
 *   IPTC digital source type   XMP, or the actions of a C2PA manifest (OpenAI, Google, Adobe, Meta…)
 *   C2PA Content Credentials   a signed manifest; its claim generator names the software
 *   PNG text chunks            generation settings written by Stable Diffusion tools (A1111, ComfyUI…)
 */

export interface Provenance {
  /** IPTC code, e.g. "trainedAlgorithmicMedia". */
  sourceType?: string;
  /** Content Credentials found: the claim generator, or "" when it can't be read. */
  c2pa?: string;
  /** PNG text chunks that hold generation settings: [keyword, beginning of the text]. */
  generation: [string, string][];
}

/** IPTC digital source types (cv.iptc.org/newscodes/digitalsourcetype) that mean AI took part. */
export const AI_SOURCE_TYPES: Record<string, string> = {
  trainedAlgorithmicMedia: "made by a generative AI model",
  compositeWithTrainedAlgorithmicMedia: "partly made or edited with generative AI",
  algorithmicMedia: "made by an algorithm, without a camera",
  compositeSynthetic: "a composite that includes synthetic elements",
  algorithmicallyEnhanced: "enhanced by an algorithm",
};

export const OTHER_SOURCE_TYPES: Record<string, string> = {
  digitalCapture: "a photo from a digital camera",
  computationalCapture: "a photo processed by the camera (phones)",
  negativeFilm: "a scanned film negative",
  positiveFilm: "a scanned slide",
  print: "a scanned print",
  screenCapture: "a screenshot",
  digitalArt: "made by a person with software",
  composite: "a composite of several images",
  minorHumanEdits: "a photo with minor edits",
  humanEdits: "a photo edited by a person",
};

// Keywords of the PNG text chunks that image generators write.
const GENERATION_KEYS = /^(parameters|prompt|workflow|invokeai_metadata|invokeai_graph|sd-metadata|dream|generation_data)$/i;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function readProvenance(bytes: Uint8Array): Provenance {
  // "latin1" (windows-1252) maps every byte to one character: string positions are byte positions.
  const text = new TextDecoder("latin1").decode(bytes);
  // A C2PA manifest can list several (a camera photo, then an AI edit): the AI one matters.
  const types = Array.from(text.matchAll(/digitalsourcetype\/([A-Za-z]+)/gi), (m) => m[1]);
  const sourceType = types.find((t) => t in AI_SOURCE_TYPES) ?? types[0];
  const c2pa = text.includes("jumb") && text.includes("c2pa") ? claimGenerator(bytes, text) : undefined;
  return { sourceType, c2pa, generation: pngGeneration(bytes) };
}

/** C2PA claims are CBOR: the key "claim_generator" (v1) or "claim_generator_info" → "name" (v2), then a text string. */
function claimGenerator(bytes: Uint8Array, text: string): string {
  const v1 = text.indexOf("\x6fclaim_generator");
  if (v1 >= 0) return cborText(bytes, v1 + 16) ?? "";
  const v2 = text.indexOf("\x74claim_generator_info");
  const name = v2 >= 0 ? text.indexOf("\x64name", v2) : -1;
  return name >= 0 && name - v2 < 64 ? cborText(bytes, name + 5) ?? "" : "";
}

function cborText(bytes: Uint8Array, at: number): string | undefined {
  const head = bytes[at];
  if (head >> 5 !== 3) return undefined; // not a text string
  const info = head & 31;
  const [length, start] = info < 24 ? [info, at + 1] : info === 24 ? [bytes[at + 1], at + 2] : [-1, 0];
  if (length < 0 || start + length > bytes.length) return undefined;
  return new TextDecoder().decode(bytes.subarray(start, start + length));
}

function pngGeneration(bytes: Uint8Array): [string, string][] {
  if (!PNG_SIGNATURE.every((b, i) => bytes[i] === b)) return [];
  const found: [string, string][] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let at = 8; at + 12 <= bytes.length; ) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    const data = bytes.subarray(at + 8, Math.min(at + 8 + length, bytes.length));
    if (type === "tEXt" || type === "iTXt") {
      const end = data.indexOf(0);
      const keyword = new TextDecoder("latin1").decode(data.subarray(0, end));
      if (end > 0 && GENERATION_KEYS.test(keyword)) found.push([keyword, chunkText(type, data.subarray(end + 1))]);
    }
    if (type === "IEND") break;
    at += 12 + length;
  }
  return found;
}

function chunkText(type: string, rest: Uint8Array): string {
  if (type === "tEXt") return new TextDecoder("latin1").decode(rest);
  // iTXt: compression flag, method, language\0, translated keyword\0, text
  if (rest[0] !== 0) return "(compressed)";
  const language = rest.indexOf(0, 2);
  const translated = rest.indexOf(0, language + 1);
  return new TextDecoder().decode(rest.subarray(translated + 1));
}
