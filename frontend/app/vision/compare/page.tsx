/**
 * /vision/compare — 비전 비교 메뉴 (사용자가 임의로 고른 두 이미지 5축 비교).
 * 2026-04-24 신설 · 2026-04-27 (C2-P1-1) 분해 — 좌 패널/뷰어/분석 패널 추출.
 *
 * 레이아웃:
 *   400px 좌 패널 (CompareLeftPanel)
 *   1fr 우 패널 (CompareViewer + CompareAnalysisPanel)
 *
 * 데이터:
 *   - useVisionCompareStore (완전 휘발 · DB 저장 X · 페이지 떠나면 모두 사라짐)
 *   - 비전 모델은 useSettingsStore.visionModel (설정 드로어 공용 · 페이지에 노출 X)
 *
 * 백엔드:
 *   - POST /api/studio/compare-analyze · meta.context="compare"
 *   - analyze_pair_generic 호출 (Edit 코드 경로 무영향)
 */

"use client";

import { useEffect, useState } from "react";
import AppHeader from "@/components/chrome/AppHeader";
import ProgressModal from "@/components/studio/ProgressModal";
import CompareAnalysisPanel from "@/components/studio/compare/CompareAnalysisPanel";
import CompareLeftPanel from "@/components/studio/compare/CompareLeftPanel";
import CompareViewer from "@/components/studio/compare/CompareViewer";
import {
  StudioLeftPanel,
  StudioPage,
  StudioRightPanel,
  StudioWorkspace,
} from "@/components/studio/StudioLayout";
import {
  useVisionCompareStore,
  type VisionCompareImage,
} from "@/stores/useVisionCompareStore";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { useProcessStore } from "@/stores/useProcessStore";
import { usePromptHistoryStore } from "@/stores/usePromptHistoryStore";
import { compareAnalyze } from "@/lib/api/compare";
import { useImagePasteTarget } from "@/hooks/useImagePasteTarget";
import { toast } from "@/stores/useToastStore";
import type { VisionCompareAnalysis } from "@/lib/api/types";

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
  const viewerMode = useVisionCompareStore((s) => s.viewerMode);
  const setImageA = useVisionCompareStore((s) => s.setImageA);
  const setImageB = useVisionCompareStore((s) => s.setImageB);
  const swapImages = useVisionCompareStore((s) => s.swapImages);
  const setHint = useVisionCompareStore((s) => s.setHint);
  const setRunning = useVisionCompareStore((s) => s.setRunning);
  const setAnalysis = useVisionCompareStore((s) => s.setAnalysis);
  const setViewerMode = useVisionCompareStore((s) => s.setViewerMode);
  // Phase 6 (2026-04-27): 진행 모달 통일 — stage 이벤트 store 누적
  const pushStage = useVisionCompareStore((s) => s.pushStage);
  const resetStages = useVisionCompareStore((s) => s.resetStages);
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

      // compare context 응답은 VisionCompareAnalysis 5축
      const a = rawAnalysis as VisionCompareAnalysis;
      setAnalysis(a);

      if (a.fallback) {
        toast.warn("비교 분석 fallback", a.summary_ko || "비전 응답 부족");
      } else {
        toast.success("비교 분석 완료", `종합 ${a.overall}%`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error("비교 분석 실패", msg);
    } finally {
      setRunning(false);
    }
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
          <CompareViewer
            imageA={imageA}
            imageB={imageB}
            mode={viewerMode}
            onModeChange={setViewerMode}
          />
          <CompareAnalysisPanel running={running} analysis={analysis} />
        </StudioRightPanel>
      </StudioWorkspace>
    </StudioPage>
  );
}
