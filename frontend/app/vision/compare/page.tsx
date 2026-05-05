/**
 * /vision/compare — 비전 비교 메뉴 V4 (2-stage observe + diff_synthesize).
 * 2026-04-24 신설 · 2026-04-27 분해 · 2026-05-05 V4 wiring (Phase 8 Task 30).
 *
 * 레이아웃:
 *   400px 좌 패널 (CompareLeftPanel · VisionModelSelector 포함)
 *   1fr 우 패널 (CompareAnalysisPanel V4 — Phase 7 컴포넌트 7개 통합)
 *
 * 데이터:
 *   - useVisionCompareStore V4 (완전 휘발 · DB 저장 X · perImagePrompt 캐시)
 *   - 비전 모델 useSettingsStore.visionModel (좌패널 카드 세그먼트로 노출)
 *
 * 백엔드:
 *   - POST /api/studio/compare-analyze · meta.context="compare" → V4 5 stage SSE
 *   - POST /api/studio/compare-analyze/per-image-prompt · on-demand t2i 합성
 */

"use client";

import { useEffect, useState } from "react";
import AppHeader from "@/components/chrome/AppHeader";
import ProgressModal from "@/components/studio/ProgressModal";
import StudioResultHeader from "@/components/studio/StudioResultHeader";
import CompareAnalysisPanel from "@/components/studio/compare/CompareAnalysisPanel";
import CompareLeftPanel from "@/components/studio/compare/CompareLeftPanel";
import {
  StudioLeftPanel,
  StudioPage,
  StudioRightPanel,
  StudioWorkspace,
} from "@/components/studio/StudioLayout";
import {
  useVisionCompareStore,
  type VisionCompareImage,
  type PerImageWhich,
} from "@/stores/useVisionCompareStore";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { useProcessStore } from "@/stores/useProcessStore";
import { usePromptHistoryStore } from "@/stores/usePromptHistoryStore";
import {
  compareAnalyze,
  compareAnalyzePerImagePrompt,
} from "@/lib/api/compare";
import { useImagePasteTarget } from "@/hooks/useImagePasteTarget";
import { toast } from "@/stores/useToastStore";
import type { VisionCompareAnalysisV4 } from "@/lib/api/types";

/* ──────────────────────────────────────────────────────────────────────
 * 파일 → VisionCompareImage 로더 (paste fallback 용)
 * CompareImageSlot.handleFiles 와 동일 로직. 페이지 paste 핸들러 재사용.
 * ──────────────────────────────────────────────────────────────────── */
function loadCompareImageFromFile(
  file: File,
  onLoad: (img: VisionCompareImage) => void,
) {
  if (!file.type.startsWith("image/")) {
    toast.error("이미지 파일만 업로드 가능합니다.");
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = reader.result as string;
    const img = new Image();
    img.onload = () => {
      onLoad({
        dataUrl,
        label: file.name,
        width: img.naturalWidth,
        height: img.naturalHeight,
      });
    };
    img.onerror = () => toast.error("이미지 로드 실패");
    img.src = dataUrl;
  };
  reader.onerror = () => toast.error("파일 읽기 실패");
  reader.readAsDataURL(file);
}

export default function VisionComparePage() {
  const imageA = useVisionCompareStore((s) => s.imageA);
  const imageB = useVisionCompareStore((s) => s.imageB);
  const hint = useVisionCompareStore((s) => s.hint);
  const running = useVisionCompareStore((s) => s.running);
  const analysis = useVisionCompareStore((s) => s.analysis);
  const setImageA = useVisionCompareStore((s) => s.setImageA);
  const setImageB = useVisionCompareStore((s) => s.setImageB);
  const swapImages = useVisionCompareStore((s) => s.swapImages);
  const setHint = useVisionCompareStore((s) => s.setHint);
  const setRunning = useVisionCompareStore((s) => s.setRunning);
  const setAnalysis = useVisionCompareStore((s) => s.setAnalysis);
  // Phase 6 (2026-04-27): 진행 모달 통일 — stage 이벤트 store 누적
  const pushStage = useVisionCompareStore((s) => s.pushStage);
  const resetStages = useVisionCompareStore((s) => s.resetStages);
  // V4 perImagePrompt — on-demand t2i 합성 캐시 + 전역 직렬화
  const perImagePrompt = useVisionCompareStore((s) => s.perImagePrompt);
  const setPerImagePrompt = useVisionCompareStore((s) => s.setPerImagePrompt);
  const setPerImageInFlight = useVisionCompareStore((s) => s.setPerImageInFlight);
  const clearPerImagePrompts = useVisionCompareStore((s) => s.clearPerImagePrompts);
  const addPromptHistory = usePromptHistoryStore((s) => s.add);

  const visionModel = useSettingsStore((s) => s.visionModel);
  const ollamaModel = useSettingsStore((s) => s.ollamaModel);
  const ollamaOn = useProcessStore((s) => s.ollama) === "running";

  useEffect(() => {
    setHint("");
  }, [setHint]);

  /* ── Ctrl+V 페이지 레벨 fallback (2026-04-25 · 2026-04-27 hook 위임) ──
   * 정책: 호버 슬롯이 있으면 그 슬롯 우선 (CompareImageSlot 내부 처리 + e.preventDefault).
   *       호버 슬롯 없으면 → A 비면 A, B 비면 B, 둘 다 차면 토스트 안내.
   * 충돌 가드: 슬롯이 paste 처리하면 e.preventDefault() → 여기선 defaultPrevented 로 skip.
   *           textarea/input focus 시는 텍스트 paste 보존 위해 skip. */
  useImagePasteTarget({
    shouldSkip: ({ event, activeIsInput }) => event.defaultPrevented || activeIsInput,
    onImage: (file) => {
      if (!imageA) {
        loadCompareImageFromFile(file, setImageA);
      } else if (!imageB) {
        loadCompareImageFromFile(file, setImageB);
      } else {
        toast.warn(
          "두 슬롯이 모두 채워졌습니다",
          "교체할 슬롯에 마우스를 올린 뒤 Ctrl+V 를 누르세요.",
        );
      }
    },
  });

  /* ── 진행 모달 open 상태 ── */
  const [progressOpen, setProgressOpen] = useState(false);
  const [prevRunning, setPrevRunning] = useState(running);
  if (prevRunning !== running) {
    setPrevRunning(running);
    if (running) setProgressOpen(true);
  }

  useEffect(() => {
    if (running) return;
    if (!progressOpen) return;
    const t = setTimeout(() => setProgressOpen(false), 1000);
    return () => clearTimeout(t);
  }, [running, progressOpen]);

  /* ── 분석 실행 ── */
  const runAnalyze = async () => {
    if (!imageA || !imageB || running) return;
    if (!ollamaOn) {
      toast.warn("Ollama 정지", "설정에서 Ollama 를 시작해 주세요.");
      return;
    }

    setRunning(true);
    setAnalysis(null);
    resetStages();
    clearPerImagePrompts(); // 새 분석 시작 시 휘발 캐시 초기화
    addPromptHistory("compare", hint);

    try {
      const { analysis: rawAnalysis } = await compareAnalyze({
        source: imageA.dataUrl, // IMAGE_A
        result: imageB.dataUrl, // IMAGE_B
        editPrompt: "", // compare context 에선 사용 X
        context: "compare",
        compareHint: hint,
        visionModel,
        ollamaModel,
        onStage: (e) => {
          pushStage({
            type: e.type,
            label: e.stageLabel,
            progress: e.progress,
            arrivedAt: Date.now(),
            payload: e.extra,
          });
        },
        // historyItemId 미전송 → 백엔드가 DB 저장 자동 스킵 = 완전 휘발 보장
      });

      // compare context 응답은 V4 (2-stage observe + diff_synthesize)
      const a = rawAnalysis as VisionCompareAnalysisV4;
      setAnalysis(a);

      if (a.fallback) {
        toast.warn("비교 분석 fallback", a.summaryKo || "비전 응답 부족");
      } else {
        const meta = a.fidelityScore !== null ? `유사도 ${a.fidelityScore}%` : a.domainMatch;
        toast.success("비교 분석 완료", meta);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error("비교 분석 실패", msg);
    } finally {
      setRunning(false);
    }
  };

  /* ── On-demand t2i prompt 합성 (per-image · 전역 직렬화) ── */
  const onPerImagePromptRequest = async (which: PerImageWhich) => {
    if (!analysis || analysis.fallback) return;
    if (perImagePrompt.inFlight !== null) {
      // 전역 직렬화 — UI 단에서 disabled 처리하지만 안전망
      return;
    }
    const observation = which === "image1" ? analysis.observation1 : analysis.observation2;
    if (!observation || Object.keys(observation).length === 0) {
      toast.warn("observation 없음", "메인 분석을 먼저 실행해 주세요");
      return;
    }
    setPerImageInFlight(which);
    try {
      const result = await compareAnalyzePerImagePrompt(observation, ollamaModel);
      setPerImagePrompt(which, result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error("프롬프트 합성 실패 — 다시 시도해주세요", msg);
      setPerImageInFlight(null);
    }
  };

  const onPerImagePromptReset = (which: PerImageWhich) => {
    // 캐시만 비우는 것이 아니라 새 합성을 트리거 (재합성 UX)
    if (which === "image1") {
      useVisionCompareStore.setState((s) => ({
        perImagePrompt: { ...s.perImagePrompt, image1: null },
      }));
    } else {
      useVisionCompareStore.setState((s) => ({
        perImagePrompt: { ...s.perImagePrompt, image2: null },
      }));
    }
    void onPerImagePromptRequest(which);
  };

  const canRun = !!imageA && !!imageB && !running;

  return (
    <StudioPage>
      {progressOpen && (
        <ProgressModal mode="compare" onClose={() => setProgressOpen(false)} />
      )}
      <AppHeader />

      <StudioWorkspace>
        <StudioLeftPanel>
          <CompareLeftPanel
            imageA={imageA}
            imageB={imageB}
            hint={hint}
            running={running}
            canRun={canRun}
            setImageA={setImageA}
            setImageB={setImageB}
            swapImages={swapImages}
            setHint={setHint}
            onAnalyze={runAnalyze}
          />
        </StudioLeftPanel>

        <StudioRightPanel>
          {/* V5 결과 헤더 (Generate/Edit/Vision/Video 와 통일) — V4 fidelity 표시 */}
          <StudioResultHeader
            title="비교 결과"
            titleEn="Comparison"
            meta={
              <>
                {imageA && (
                  <span className="ais-result-pill ais-pill-violet mono">
                    A · {imageA.width} × {imageA.height}
                  </span>
                )}
                {imageB && (
                  <span className="ais-result-pill ais-pill-violet mono">
                    B · {imageB.width} × {imageB.height}
                  </span>
                )}
                {analysis && !analysis.fallback && analysis.fidelityScore !== null && (
                  <span className="ais-result-pill ais-pill-amber mono">
                    유사도 {analysis.fidelityScore}%
                  </span>
                )}
                {analysis && !analysis.fallback && (
                  <span className="ais-result-pill mono">
                    {analysis.domainMatch === "person"
                      ? "PERSON"
                      : analysis.domainMatch === "object_scene"
                      ? "OBJECT/SCENE"
                      : "MIXED"}
                  </span>
                )}
              </>
            }
          />

          <CompareAnalysisPanel
            running={running}
            analysis={analysis}
            image1Url={imageA?.dataUrl ?? null}
            image2Url={imageB?.dataUrl ?? null}
            perImageInFlight={perImagePrompt.inFlight}
            perImagePromptImage1={perImagePrompt.image1}
            perImagePromptImage2={perImagePrompt.image2}
            onPerImagePromptRequest={onPerImagePromptRequest}
            onPerImagePromptReset={onPerImagePromptReset}
          />
        </StudioRightPanel>
      </StudioWorkspace>
    </StudioPage>
  );
}
