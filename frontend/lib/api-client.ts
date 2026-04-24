/**
 * lib/api-client.ts — Backward-compat barrel.
 * 2026-04-23 Opus S3: 715줄 단일 파일을 lib/api/* 6 파일로 분할한 뒤
 * 기존 `@/lib/api-client` import 경로 보존을 위한 re-export 만 유지.
 *
 * 신규 코드는 이 경로 대신 구체 모듈 (lib/api/{generate, edit, history,
 * process, client, types}) 에서 직접 import 하는 것을 권장.
 */

export type {
  HistoryItem,
  GenerateRequest,
  UpgradeOnlyResult,
  EditRequest,
  GenStage,
  EditStage,
  OllamaModel,
  ProcessStatusSnapshot,
  VramSnapshot,
  VideoRequest,
  VideoStage,
  VisionAnalysisResponse,
  ComparisonScores,
  ComparisonComments,
  ComparisonAnalysis,
} from "./api/types";

export { USE_MOCK, STUDIO_BASE } from "./api/client";

export { upgradeOnly, researchPrompt, generateImageStream } from "./api/generate";
export { editImageStream } from "./api/edit";
export { videoImageStream } from "./api/video";
export { analyzeImage, type AnalyzeImageOptions } from "./api/vision";
export { listHistory, deleteHistoryItem, clearHistory } from "./api/history";
export {
  fetchProcessStatus,
  interruptCurrent,
  setProcessStatus,
  listOllamaModels,
} from "./api/process";
