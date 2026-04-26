/**
 * useGeneratePipeline — Generate 페이지의 실행 로직 일괄 캡슐화.
 * 2026-04-23 Opus F6: generate/page.tsx 에서 파이프라인/업그레이드 모달/조사 단독
 * 실행 로직(~135줄) 을 훅으로 이동. 페이지는 스토어 + 훅 조합만 담당.
 *
 * 반환:
 *   - generate(): handleGenerate 진입점 (조건 체크 + hideGeneratePrompts 분기).
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
  /** [생성] 버튼 진입점 — hideGeneratePrompts=false 면 모달 경유, true 면 바로 스트림. */
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
  /** "힌트 미리 받기" — 생성 전 Claude 조사 단독 실행 + 결과 state 보유 */
  researchPreview: {
    loading: boolean;
    /** null = 아직 실행 안 함, []=실행했는데 빈 결과, [...]=힌트 */
    hints: string[] | null;
    /** 실패 시 메시지 */
    error: string | null;
    run: () => Promise<void>;
  };
}

export function useGeneratePipeline(): UseGeneratePipeline {
  // 입력값 (스토어)
  const prompt = useGenerateStore((s) => s.prompt);
  const aspect = useGenerateStore((s) => s.aspect);
  const width = useGenerateStore((s) => s.width);
  const height = useGenerateStore((s) => s.height);
  const lightning = useGenerateStore((s) => s.lightning);
  const research = useGenerateStore((s) => s.research);
  const styleId = useGenerateStore((s) => s.styleId);
  // 실행 상태
  const generating = useGenerateStore((s) => s.generating);
  const setRunning = useGenerateStore((s) => s.setRunning);
  const resetRunning = useGenerateStore((s) => s.resetRunning);
  const pushStage = useGenerateStore((s) => s.pushStage);
  const setSampling = useGenerateStore((s) => s.setSampling);
  // 히스토리
  const addItem = useHistoryStore((s) => s.add);
  // 설정
  // hideGeneratePrompts (기본 true · 깔끔 모드).
  // false 시 사전 검수 모달 (UpgradeConfirmModal) 띄움 + 진행 모달 펼침.
  const hideGeneratePrompts = useSettingsStore((s) => s.hideGeneratePrompts);
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

  // 힌트 미리 받기 (단독 조사) 로컬 상태 — 배너에 인라인 표시 용
  const [researchLoading, setResearchLoading] = useState(false);
  const [researchHints, setResearchHints] = useState<string[] | null>(null);
  const [researchError, setResearchError] = useState<string | null>(null);

  /* ── 실제 스트림 소비 루프 ──
   * try/catch/finally — generator 가 done/error 둘 다 emit 안 하고 끝나도
   * finally 가 running=false 보장. resetRunning 은 idempotent 라 중복 호출 안전.
   */
  const runStream = async (
    preUpgraded?: string,
    preResearchHints?: string[],
  ) => {
    setRunning(true, 0, "초기화");
    // Step/CFG/Seed 는 UI 에서 제거됨 → lightning 여부에 따라 defaults/lightning 세트 직접 참조.
    // Seed 는 매번 랜덤 (같은 시드 재사용으로 결과가 동일해지는 것 방지).
    const modelCfg = lightning
      ? GENERATE_MODEL.lightning
      : GENERATE_MODEL.defaults;
    const randomSeed = Math.floor(Math.random() * 1e15);
    let completed = false;
    try {
      for await (const evt of generateImageStream({
        prompt,
        aspect,
        width,
        height,
        steps: modelCfg.steps,
        cfg: modelCfg.cfg,
        seed: randomSeed,
        lightning,
        research,
        ollamaModel: ollamaModelSel,
        visionModel: visionModelSel,
        preUpgradedPrompt: preUpgraded,
        preResearchHints,
        styleId,
      })) {
        if (evt.type === "done") {
          addItem(evt.item);
          resetRunning();
          toast.success(
            "생성 완료",
            `${evt.item.width}×${evt.item.height}`,
          );
          if (evt.item.comfyError) {
            toast.error(
              "ComfyUI 오류 (Mock 폴백 적용)",
              evt.item.comfyError.slice(0, 160),
            );
          } else if (evt.item.promptProvider === "fallback") {
            toast.warn(
              "gemma4 업그레이드 실패",
              "원본 프롬프트로 생성됐습니다. Ollama 상태 확인 또는 설정에서 재시작해 주세요.",
            );
          }
          if (!evt.savedToHistory) {
            toast.warn(
              "히스토리 DB 저장 실패",
              "결과는 화면에서 유지되지만 서버 재기동 후 사라질 수 있습니다.",
            );
          }
          completed = true;
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
      // generator 가 done 없이 끝남 — 비정상 종료
      if (!completed) {
        toast.warn(
          "생성 스트림이 도중에 끊겼습니다.",
          "백엔드 로그를 확인해 주세요. 결과는 저장되지 않았습니다.",
        );
      }
    } catch (err) {
      toast.error(
        "생성 실패",
        err instanceof Error ? err.message : "알 수 없는 오류",
      );
    } finally {
      // 어떤 종료 경로든 running 해제 보장 (UI 영구 잠금 방지)
      resetRunning();
    }
  };

  /* ── [생성] 진입점 ── */
  const generate = async () => {
    if (generating) return;
    if (!prompt.trim()) {
      toast.warn("프롬프트를 입력해 주세요.");
      return;
    }
    if (comfyuiStatus === "stopped") {
      toast.warn(
        "ComfyUI 정지 상태",
        "설정에서 시작해도 되고, Mock 은 그대로 돌아가.",
      );
    }

    if (!hideGeneratePrompts) {
      setUpgradeOpen(true);
      setUpgradeLoading(true);
      setUpgradeResult(null);
      try {
        const result = await upgradeOnly({
          prompt,
          research,
          ollamaModel: ollamaModelSel,
          // spec 19 후속 (Codex 추가 fix): aspect 컨텍스트 전달
          aspect,
          width,
          height,
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
        // spec 19 후속 (Codex 추가 fix): aspect 컨텍스트 전달 (재업그레이드)
        aspect,
        width,
        height,
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

  const researchPreviewRun = async () => {
    if (!prompt.trim()) {
      toast.warn("프롬프트를 먼저 입력해 주세요.");
      return;
    }
    setResearchLoading(true);
    setResearchError(null);
    try {
      const { hints } = await researchPrompt(
        prompt,
        GENERATE_MODEL.displayName,
      );
      setResearchHints(hints);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "조사 실패";
      setResearchError(msg);
      setResearchHints(null);
    } finally {
      setResearchLoading(false);
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
    researchPreview: {
      loading: researchLoading,
      hints: researchHints,
      error: researchError,
      run: researchPreviewRun,
    },
  };
}
