/**
 * useGeneratePipeline — Generate 페이지의 실행 로직 일괄 캡슐화.
 * 2026-04-23 Opus F6: generate/page.tsx 에서 파이프라인/업그레이드 모달/조사 단독
 * 실행 로직(~135줄) 을 훅으로 이동. 페이지는 스토어 + 훅 조합만 담당.
 *
 * 반환:
 *   - generate(): handleGenerate 진입점 (조건 체크 + showUpgradeStep 분기).
 *   - upgrade: { open, loading, result, confirm(), rerun(), cancel() } — 모달 상태.
 *   - researchNow(): 조사만 단독 실행 (토스트 힌트).
 *
 * 훅 내부에서 다음 스토어 구독:
 *   useGenerateStore · useSettingsStore · useHistoryStore · useProcessStore ·
 *   useToastStore(toast).
 */

"use client";

import { useState } from "react";
import {
  generateImageStream,
  researchPrompt,
  upgradeOnly,
  type UpgradeOnlyResult,
} from "@/lib/api-client";
import { GENERATE_MODEL } from "@/lib/model-presets";
import { useGenerateStore } from "@/stores/useGenerateStore";
import { useHistoryStore } from "@/stores/useHistoryStore";
import { useProcessStore } from "@/stores/useProcessStore";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { toast } from "@/stores/useToastStore";

export interface UseGeneratePipeline {
  /** [생성] 버튼 진입점 — showUpgradeStep 이면 모달 경유, 아니면 바로 스트림. */
  generate: () => Promise<void>;
  /** 업그레이드 확인 모달 상태 + 핸들러 번들 */
  upgrade: {
    open: boolean;
    loading: boolean;
    result: UpgradeOnlyResult | null;
    confirm: (p: { finalPrompt: string; researchHints: string[] }) => Promise<void>;
    rerun: () => Promise<void>;
    cancel: () => void;
  };
  /** "조사 필요" 배너의 "미리보기" — 단독 조사 실행 */
  researchNow: () => Promise<void>;
}

export function useGeneratePipeline(): UseGeneratePipeline {
  // 입력값 (스토어)
  const prompt = useGenerateStore((s) => s.prompt);
  const aspect = useGenerateStore((s) => s.aspect);
  const width = useGenerateStore((s) => s.width);
  const height = useGenerateStore((s) => s.height);
  const steps = useGenerateStore((s) => s.steps);
  const cfg = useGenerateStore((s) => s.cfg);
  const seed = useGenerateStore((s) => s.seed);
  const lightning = useGenerateStore((s) => s.lightning);
  const research = useGenerateStore((s) => s.research);
  // 실행 상태
  const generating = useGenerateStore((s) => s.generating);
  const setRunning = useGenerateStore((s) => s.setRunning);
  const resetRunning = useGenerateStore((s) => s.resetRunning);
  const pushStage = useGenerateStore((s) => s.pushStage);
  const setSampling = useGenerateStore((s) => s.setSampling);
  // 히스토리
  const addItem = useHistoryStore((s) => s.add);
  // 설정
  const showUpgradeStep = useSettingsStore((s) => s.showUpgradeStep);
  const ollamaModelSel = useSettingsStore((s) => s.ollamaModel);
  const visionModelSel = useSettingsStore((s) => s.visionModel);
  // 프로세스 상태 (ComfyUI 정지 경고용)
  const comfyuiStatus = useProcessStore((s) => s.comfyui);

  // 업그레이드 모달 로컬 상태
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [upgradeLoading, setUpgradeLoading] = useState(false);
  const [upgradeResult, setUpgradeResult] = useState<UpgradeOnlyResult | null>(
    null,
  );

  /* ── 실제 스트림 소비 루프 ── */
  const runStream = async (
    preUpgraded?: string,
    preResearchHints?: string[],
  ) => {
    setRunning(true, 0, "초기화");
    try {
      for await (const evt of generateImageStream({
        prompt,
        aspect,
        width,
        height,
        steps,
        cfg,
        seed,
        lightning,
        research,
        ollamaModel: ollamaModelSel,
        visionModel: visionModelSel,
        preUpgradedPrompt: preUpgraded,
        preResearchHints,
      })) {
        if (evt.type === "done") {
          addItem(evt.item);
          resetRunning();
          toast.success(
            "생성 완료",
            `${evt.item.width}×${evt.item.height} · seed ${evt.item.seed}`,
          );
          if (evt.item.comfyError) {
            toast.error(
              "ComfyUI 오류 (Mock 폴백 적용)",
              evt.item.comfyError.slice(0, 160),
            );
          } else if (evt.item.promptProvider === "fallback") {
            toast.warn(
              "gemma4 업그레이드 실패",
              "원본 프롬프트로 생성됨. Ollama 상태 확인 또는 설정에서 재시작해봐.",
            );
          }
          if (!evt.savedToHistory) {
            toast.warn(
              "히스토리 DB 저장 실패",
              "결과는 화면에서 유지되지만 서버 재기동 후 사라질 수 있어.",
            );
          }
          return;
        }
        setRunning(true, evt.progress, evt.stageLabel);
        pushStage({
          type: evt.type,
          label: evt.stageLabel,
          progress: evt.progress,
        });
        if (evt.type === "comfyui-sampling") {
          setSampling(evt.samplingStep ?? null, evt.samplingTotal ?? null);
        }
      }
    } catch (err) {
      resetRunning();
      toast.error(
        "생성 실패",
        err instanceof Error ? err.message : "알 수 없는 오류",
      );
    }
  };

  /* ── [생성] 진입점 ── */
  const generate = async () => {
    if (generating) return;
    if (!prompt.trim()) {
      toast.warn("프롬프트를 입력해줘");
      return;
    }
    if (comfyuiStatus === "stopped") {
      toast.warn(
        "ComfyUI 정지 상태",
        "설정에서 시작해도 되고, Mock 은 그대로 돌아가.",
      );
    }

    if (showUpgradeStep) {
      setUpgradeOpen(true);
      setUpgradeLoading(true);
      setUpgradeResult(null);
      try {
        const result = await upgradeOnly({
          prompt,
          research,
          ollamaModel: ollamaModelSel,
        });
        setUpgradeResult(result);
      } catch (err) {
        toast.error(
          "업그레이드 실패",
          err instanceof Error ? err.message : "원본으로 바로 생성할게",
        );
        setUpgradeOpen(false);
        await runStream();
      } finally {
        setUpgradeLoading(false);
      }
      return;
    }

    await runStream();
  };

  const confirm = async (p: { finalPrompt: string; researchHints: string[] }) => {
    setUpgradeOpen(false);
    // research 토글 OFF 면 힌트 미전송(백엔드 research 단계 스킵),
    // ON 이면 upgrade-only 에서 이미 조사한 힌트 재사용.
    await runStream(p.finalPrompt, research ? p.researchHints : undefined);
  };

  const rerun = async () => {
    setUpgradeLoading(true);
    try {
      const result = await upgradeOnly({
        prompt,
        research,
        ollamaModel: ollamaModelSel,
      });
      setUpgradeResult(result);
    } catch (err) {
      toast.error("재업그레이드 실패", err instanceof Error ? err.message : "");
    } finally {
      setUpgradeLoading(false);
    }
  };

  const cancel = () => {
    setUpgradeOpen(false);
    toast.info("생성 취소됨");
  };

  const researchNow = async () => {
    toast.info("Claude CLI 호출 중…", "최신 팁을 조사하는 중이야");
    try {
      const { hints } = await researchPrompt(prompt, GENERATE_MODEL.displayName);
      toast.success("조사 완료", hints.slice(0, 2).join(" · "));
    } catch (err) {
      toast.error("조사 실패", err instanceof Error ? err.message : "");
    }
  };

  return {
    generate,
    upgrade: {
      open: upgradeOpen,
      loading: upgradeLoading,
      result: upgradeResult,
      confirm,
      rerun,
      cancel,
    },
    researchNow,
  };
}
