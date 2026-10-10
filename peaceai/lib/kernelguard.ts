// M6 (Auditor): proves the Actions kernel bundle cannot reach a teacher or any outside model.
// Checks esbuild's metafile (which modules went in, which imports stayed external) and the bundle text.
// Reports only rule names and module basenames, never bundle content (the bundle is core code).

/** Core modules removed in M6. None may be an input of the bundle. */
export const REMOVED_MODULES = ["NeuralModelRegistry", "PeaceAIFirstRouting", "Phi4Benchmark", "Phi4MiniOnnx", "ProductionTeachingAndReuse", "TeachingAndReuse"] as const;

/** Imports the bundle may leave external: node built-ins used by the kernel and the TypeScript compiler. */
export const ALLOWED_EXTERNALS = new Set([
  "fs",
  "path",
  "os",
  "crypto",
  "perf_hooks",
  "inspector",
  "source-map-support",
  "node:fs",
  "node:path",
  "node:os",
  "node:crypto",
]);

/** Outside-model endpoints, model ids and SDKs, and the removed teacher-route identifiers. */
export const OUTSIDE_MODEL_RULES: readonly (readonly [string, RegExp])[] = [
  ["hosted-model-endpoint", /huggingface\.co|api\.openai\.com|api\.anthropic\.com|api\.x\.ai|generativelanguage\.googleapis\.com|\/v1\/chat\/completions|\/v1\/messages\b/i],
  ["model-sdk", /\b(?:openai|@anthropic-ai|@huggingface|@xenova|onnxruntime(?:-node|-web)?|ollama|llama\.cpp|node-llama-cpp)\b/i],
  ["model-identifier", /\bphi-?4|Phi4Mini|\bgpt-[0-9]|\bclaude-[0-9]|\bgemini-[0-9]|\bmistral-[0-9a-z]|\bllama-?[0-9]/i],
  ["model-weights", /\.(?:onnx|safetensors|gguf)\b/i],
  [
    "teacher-route",
    /TeachingAndReuse|TeacherReuseOrchestrator|ExternalTeacherResult|CODEX_TEACHER|CODEX_TRANSLATOR|createCodexTeachOneGapHandoff|createCodexTranslationContract|PeaceAIFirstRouting|PEACEAI_FIRST_ROUTING|deriveAssistedSpec|teachAndReuse|ExternalAssistanceLedger/,
  ],
  ["codex", /codex/i],
];

export interface Metafile {
  inputs: Record<string, { imports?: { path: string; external?: boolean }[] }>;
}

export interface GuardResult {
  ok: boolean;
  violations: string[];
  inputs: number;
}

export function checkKernelBundle(bundle: string, meta: Metafile): GuardResult {
  const violations: string[] = [];
  const inputs = Object.keys(meta.inputs ?? {});
  if (inputs.length === 0) violations.push("metafile: no inputs");
  for (const input of inputs) {
    const base = input.split("/").pop()!.replace(/\.[cm]?[jt]sx?$/, "");
    if ((REMOVED_MODULES as readonly string[]).includes(base)) violations.push(`removed-module-bundled: ${base}`);
  }
  const externals = new Set<string>();
  for (const value of Object.values(meta.inputs ?? {})) for (const imp of value.imports ?? []) if (imp.external) externals.add(imp.path);
  for (const ext of [...externals].sort()) if (!ALLOWED_EXTERNALS.has(ext)) violations.push(`external-import: ${ext}`);
  for (const [rule, pattern] of OUTSIDE_MODEL_RULES) if (pattern.test(bundle)) violations.push(`bundle-text: ${rule}`);
  return { ok: violations.length === 0, violations, inputs: inputs.length };
}
