/**
 * lib/api/edit.ts — 수정 모드 스트림 (multipart 업로드 + SSE 4단계).
 * 2026-04-23 Opus S3.
 */

import {
  STUDIO_BASE,
  USE_MOCK,
  normalizeItem,
  parseSSE,
} from "./client";
import type { TaskCreated } from "./generated-helpers";
import { mockEditStream } from "./mocks/edit";
import type {
  EditRequest,
  EditStage,
  HistoryItem,
} from "./types";

/* ─────────────────────────────────
   Edit stream — Mock vs Real 분기
   ───────────────────────────────── */

export async function* editImageStream(
  req: EditRequest,
): AsyncGenerator<EditStage, void, unknown> {
  if (USE_MOCK) {
    yield* mockEditStream(req);
    return;
  }
  yield* realEditStream(req);
}

async function* realEditStream(
  req: EditRequest,
): AsyncGenerator<EditStage, void, unknown> {
  // multipart: image 파일 + meta JSON
  const form = new FormData();
  if (typeof req.sourceImage === "string") {
    // 문자열 source 종류:
    //  1) "data:image/..." — 업로드 직후 FileReader 결과
    //  2) "http://..." or "/images/..." — 히스토리에서 선택한 서버 이미지
    //  3) "mock-seed://..." — Mock 결과 (실 백엔드에선 에러)
    const src = req.sourceImage;
    if (src.startsWith("mock-seed://")) {
      throw new Error(
        "Mock 결과 이미지는 수정에 사용 불가. 실제 생성 후 재시도해줘.",
      );
    }
    // data:/blob:/ http(s): 모두 fetch 로 통일해 blob 변환.
    // 히스토리 이미지(/images/studio/... 절대 URL)는 백엔드의 ensure_cors_for_static_images
    // 미들웨어가 Access-Control-Allow-Origin 을 주입해주므로 CORS 통과.
    try {
      const res = await fetch(src);
      if (!res.ok) {
        throw new Error(`image fetch ${res.status}: ${src.slice(0, 80)}`);
      }
      const blob = await res.blob();
      // 파일명 추출 (history URL 이면 basename, data URL 이면 "upload.png")
      const guessedName = src.startsWith("data:")
        ? "upload.png"
        : src.split("/").pop()?.split("?")[0] || "source.png";
      form.append("image", blob, guessedName);
    } catch (err) {
      throw new Error(
        `원본 이미지 로드 실패: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  } else {
    form.append("image", req.sourceImage);
  }

  // Multi-reference (2026-04-27): reference_image 추가 (옵션)
  // Codex 리뷰: res.ok 체크 누락 fix — edit.ts 의 source image fetch 패턴과 동일.
  if (req.useReferenceImage && req.referenceImage) {
    if (typeof req.referenceImage === "string") {
      try {
        const res = await fetch(req.referenceImage);
        if (!res.ok) {
          throw new Error(
            `image fetch ${res.status}: ${req.referenceImage.slice(0, 80)}`,
          );
        }
        const blob = await res.blob();
        form.append("reference_image", blob, "reference.png");
      } catch (err) {
        throw new Error(
          `참조 이미지 로드 실패: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    } else {
      form.append("reference_image", req.referenceImage);
    }
  }

  form.append(
    "meta",
    JSON.stringify({
      prompt: req.prompt,
      lightning: req.lightning,
      ollamaModel: req.ollamaModel,
      visionModel: req.visionModel,
      // Multi-reference (Phase 3 신규)
      useReferenceImage: req.useReferenceImage ?? false,
      referenceRole: req.useReferenceImage ? req.referenceRole : undefined,
      // v8 라이브러리 plan (2026-04-28) — Codex 2차/3차 리뷰 fix.
      // referenceRef 는 프론트 디버그/호환용. backend DB 저장은 referenceTemplateId 조회가 권위.
      referenceRef: req.useReferenceImage ? req.referenceRef : undefined,
      referenceTemplateId: req.useReferenceImage
        ? req.referenceTemplateId
        : undefined,
      // Phase 2 (2026-05-01) — gemma4 보강 모드. 백엔드 default 가 fast 이므로 미전달 OK.
      promptMode: req.promptMode,
    }),
  );

  const createRes = await fetch(`${STUDIO_BASE}/api/studio/edit`, {
    method: "POST",
    body: form,
  });
  if (!createRes.ok) {
    throw new Error(`edit create failed: ${createRes.status}`);
  }
  // Tier 3 (2026-04-27): generated OpenAPI 타입 사용
  const { stream_url } = (await createRes.json()) as TaskCreated;

  const streamRes = await fetch(`${STUDIO_BASE}${stream_url}`, {
    headers: { accept: "text/event-stream" },
  });
  if (!streamRes.ok) {
    throw new Error(`edit stream failed: ${streamRes.status}`);
  }

  for await (const evt of parseSSE(streamRes)) {
    if (evt.event === "error") {
      const payload = evt.data as { message?: string };
      throw new Error(payload.message || "pipeline error");
    }
    if (evt.event === "done") {
      const payload = evt.data as {
        item: HistoryItem;
        savedToHistory?: boolean;
      };
      yield {
        type: "done",
        item: normalizeItem(payload.item),
        savedToHistory: payload.savedToHistory ?? true,
      };
      return;
    }
    // Phase 4 (2026-04-27 진행 모달 store 통일 · 정리):
    //   백엔드가 더 이상 "step" event 보내지 않음 (transitional 종료).
    //   detail 정보는 모두 "stage" event 의 payload extra 필드로 도착.
    if (evt.event === "stage") {
      const payload = evt.data as {
        type: string;
        progress: number;
        stageLabel: string;
        samplingStep?: number | null;
        samplingTotal?: number | null;
      } & Record<string, unknown>;
      // Phase 2 (2026-04-27 진행 모달 store 통일):
      //   백엔드 stage emit payload 의 모든 필드 (description / finalPrompt /
      //   finalPromptKo / provider / editVisionAnalysis 등) 를 그대로 통과.
      //   PipelineTimeline.StageDef.renderDetail 이 stageHistory[].payload 에서 사용.
      const {
        type: rawType,
        progress: _p,
        stageLabel: _sl,
        samplingStep: _ss,
        samplingTotal: _st,
        ...extra
      } = payload;
      void _p;
      void _sl;
      void _ss;
      void _st;
      // 전체 파이프라인 진행률 (ProgressModal 상단 바용) + 임의 payload 흡수.
      yield {
        type: "stage",
        stageType: payload.type,
        progress: payload.progress,
        stageLabel: payload.stageLabel,
        samplingStep: payload.samplingStep ?? undefined,
        samplingTotal: payload.samplingTotal ?? undefined,
        ...extra,
      };
      // ComfyUI 샘플링일 때 추가로 샘플러 스텝 표시용 "sampling" 이벤트도 방출
      if (rawType === "comfyui-sampling") {
        yield {
          type: "sampling",
          progress: payload.progress ?? 0,
          samplingStep: payload.samplingStep ?? null,
          samplingTotal: payload.samplingTotal ?? null,
        };
      }
    }
  }
}

