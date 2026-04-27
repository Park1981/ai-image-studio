/**
 * generated-helpers — `generated.ts` (자동 생성) 의 자주 쓰이는 schema 를 친숙한 alias 로 re-export.
 *
 * Tier 3 (2026-04-27): OpenAPI 자동 타입 생성 도입.
 *
 * 사용 패턴:
 *   - 백엔드 schema 변경 → `npm run gen:types` → generated.ts 갱신 → tsc 가 사용처 drift 자동 검출
 *   - 새 endpoint 추가 시 손으로 타입 안 만들고 `Schemas["X"]` 또는 `Paths["/x/y"]["post"]["requestBody"]` 사용
 *   - 한글 주석이 가치 있는 narrow union (HistoryItem 의 mode 분기 / EditVisionAnalysis 의 도메인 분기 등)
 *     은 lib/api/types.ts 에 손으로 유지 — 자동 생성 + 손 편집 hybrid.
 *
 * 점진 마이그레이션:
 *   - 신규 코드는 가급적 Schemas["X"] 사용
 *   - 기존 inline cast (`as { task_id: string; stream_url: string }`) → `Schemas["TaskCreated"]` 로 교체
 *   - 한글 주석 / 의도적 narrow 가 필요한 타입은 types.ts 유지
 *
 * 참조: docs/progress-modal-display.md, docs/setup.md
 */

import type { components, paths } from "./generated";

/** 모든 OpenAPI components.schemas 한 줄 alias.
 *  사용 예: `const x: Schemas["TaskCreated"] = ...`
 */
export type Schemas = components["schemas"];

/** 모든 OpenAPI paths 한 줄 alias.
 *  사용 예: `type GenReq = Paths["/api/studio/generate"]["post"]["requestBody"]["content"]["application/json"]`
 */
export type Paths = paths;

/* ────────────────────────────────────────────────
 * 자주 쓰이는 schema friendly alias (편의)
 * ──────────────────────────────────────────────── */

/** POST /generate · /edit · /video · /vision-analyze · /compare-analyze 의 공통 응답.
 *  `{ task_id: string; stream_url: string }`. 여러 곳에서 inline cast 되던 패턴 통일.
 */
export type TaskCreated = Schemas["TaskCreated"];

/** POST /api/studio/generate request body. */
export type GenerateBody = Schemas["GenerateBody"];

/** POST /api/studio/upgrade-only request body. */
export type UpgradeOnlyBody = Schemas["UpgradeOnlyBody"];

/** POST /api/studio/research request body. */
export type ResearchBody = Schemas["ResearchBody"];

/** POST /api/studio/{ollama|comfyui}/start /stop 응답. */
export type ProcessAction = Schemas["ProcessAction"];
