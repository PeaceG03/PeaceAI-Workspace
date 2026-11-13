// Re-exports. The implementation is in nlparse.ts, which generate.ts already imports,
// so the protected-tool closure stays closed.
export {
  CANT_REASONS,
  UNDERSTAND_REASONS,
  impliedSourceFile,
  understandIssue,
  type CantReason,
  type StepFamily,
  type UnderstandInput,
  type UnderstandResult,
  type UnderstandStep,
} from "./nlparse.ts";
