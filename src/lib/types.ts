/**
 * The model contract — the only thing a model needs to be usable by the app.
 *
 *   public/models/index.json              ["resnet50-6ch", "my-new-model", ...]
 *   public/models/<id>/config.json        a ModelConfig (below)
 *   public/models/<id>/model.onnx         the network (or an absolute URL in `model`)
 *   public/models/<id>/tokenizer.json     text models only (+ tokenizer_config.json)
 *
 * Inputs:  image models get one float32 tensor [1, C, H, W] (the model's first input).
 *          text models get int64 input_ids / attention_mask / token_type_ids [1, seq].
 * Output:  the model's first output, one score per label (see `output`).
 */

export type ResizeFilter = "bilinear" | "bicubic" | "lanczos";

/**
 * Preprocessing steps, applied in order. They reproduce PIL / torchvision / Hugging Face
 * exactly, so a Python eval transform can be translated line by line. Sizes are [h, w].
 */
export type Step =
  /** transforms.Resize — a number resizes the shorter side, [h, w] resizes to exactly that. */
  | { op: "resize"; size: number | [number, number]; filter?: ResizeFilter }
  /** transforms.CenterCrop */
  | { op: "center_crop"; size: number | [number, number] }
  /** transforms.ToTensor — RGB → float32 [3, H, W] in [0, 1] */
  | { op: "to_tensor" }
  /** transforms.Normalize */
  | { op: "normalize"; mean: number[]; std: number[] }
  /** 6-channel forensic input: RGB, HSV saturation, SRM noise residual, FFT magnitude → [6, H, W] */
  | { op: "forensic6" }
  /** tokenizer(text, truncation=True, max_length=...) using tokenizer.json from the model folder */
  | { op: "tokenize"; max_length?: number };

export interface ModelConfig {
  name: string;
  description?: string;
  task: "image" | "text";
  /** Change it whenever you replace the model file: browsers re-download on a new version. */
  version?: string;
  /** ONNX file, relative to the model folder or an absolute URL. Default: "model.onnx". */
  model?: string;
  /** Class names, in the order of the model's output. */
  labels: string[];
  /**
   * How to read the output. Default "logits".
   *   logits  — one raw score per label, softmax is applied
   *   probs   — one probability per label, used as is
   *   sigmoid — a single raw score, sigmoid gives P(labels[1])
   */
  output?: "logits" | "probs" | "sigmoid";
  preprocess: Step[];
}

/** A model from the registry: its config plus where it lives. */
export interface Model extends ModelConfig {
  id: string;
  /** Absolute URL of the model folder, ending with "/". */
  url: string;
}

export interface Prediction {
  /** One entry per label, in output order. */
  scores: { label: string; p: number }[];
  ms: number;
}

/** Progress reported while a prediction runs. */
export type Phase =
  | { phase: "download"; loaded: number; total: number }
  | { phase: "load" }
  | { phase: "run" };
