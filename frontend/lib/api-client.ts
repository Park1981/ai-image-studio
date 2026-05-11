/**
 * lib/api-client.ts — Deprecated barrel (2026-04-27 후 active 호출 0건).
 * 2026-04-23 Opus S3: 715줄 단일 파일을 lib/api/* 6 파일로 분할한 뒤
 * 기존 `@/lib/api-client` import 경로 보존을 위한 re-export 만 유지.
 *
 * 2026-04-27 (C2-P1-3): active frontend 코드의 24 사용처 모두 직접 import 로 전환됨.
 *   - hooks/use*.ts (5)         lib/api/{generate,edit,video,vision,compare}
 *   - app/[route]/page.tsx (2)  lib/api/{compare,types}
 *   - components/[...] (16)     lib/api/{types,client,history,process}
 *   - stores/useHistoryStore    lib/api/types
 *
 * @deprecated 신규 코드는 lib/api/{generate, edit, video, vision, compare,
 * history, process, client, types} 에서 직접 import 할 것.
 * 이 barrel 은 외부 호환만 위해 유지됨 — 다음 정리 라운드에서 삭제 예정.
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
  ComparisonScoresLegacy,
  ComparisonCommentsLegacy,
  ComparisonSlotEntry,
  ComparisonAnalysis,
  VisionCompareAnalysisV4,
  CompareCategoryDiffJSON,
  CompareKeyAnchorJSON,
  PromptFavorite,
  PromptFavoriteMode,
} from "./api/types";

export { USE_MOCK, STUDIO_BASE } from "./api/client";

export { upgradeOnly, researchPrompt, generateImageStream } from "./api/generate";
export { editImageStream } from "./api/edit";
export { videoImageStream } from "./api/video";
export { analyzeImage, type AnalyzeImageOptions } from "./api/vision";
export { listHistory, deleteHistoryItem, clearHistory } from "./api/history";
export {
  listPromptFavorites,
  createPromptFavorite,
  deletePromptFavorite,
} from "./api/prompt-favorites";
export {
  fetchProcessStatus,
  interruptCurrent,
  setProcessStatus,
  listOllamaModels,
} from "./api/process";
export {
  compareAnalyze,
  type CompareAnalyzeRequest,
  type CompareAnalyzeResponse,
} from "./api/compare";
