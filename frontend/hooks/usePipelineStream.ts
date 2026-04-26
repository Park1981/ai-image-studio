/**
 * usePipelineStream — SSE 스트림 소비 공통 추상화 (task #7 · 2026-04-26).
 *
 * 이전 패턴 (3 hook 동일 try/catch/finally + for-await + completed flag):
 *   let completed = false;
 *   try {
 *     for await (const evt of generator) {
 *       if (evt.type === "sampling") ...
 *       if (evt.type === "step") ...
 *       else if (evt.type === "stage") ...
 *       else if (evt.type === "done") { ...; completed = true; return; }
 *     }
 *     if (!completed) toast.warn("스트림 끊김");
 *   } catch (err) { toast.error("실패", err); }
 *   finally { resetPipeline(); }
 *
 * → 3 hook × ~80줄 = 240줄 보일러. SSE event 추가/수정 시 3곳 동시 변경 필요
 * (spec 19 ollama race fix 때 finally 보강 3곳 동시 적용 사례).
 *
 * 신규 사용:
 *   await consumePipelineStream(generator, {
 *     on: {
 *       sampling: (e) => setSampling(e.samplingStep, e.samplingTotal),
 *       step:     (e) => handleStep(e),
 *       stage:    (e) => setPipelineProgress(e.progress, e.stageLabel),
 *       done:     (e) => { addItem(e.item); ... },
 *     },
 *     onError: (err) => toast.error("실패", err),
 *     onIncomplete: () => toast.warn("스트림 끊김"),
 *     onFinally: resetPipeline,
 *   });
 *
 * "done" handler 가 정상 종료 신호 — 호출 후 자동 break + completed 설정.
 * generator 가 done 없이 EOF 면 onIncomplete 발화. 예외는 onError.
 * 어떤 경로든 onFinally 호출 (resetPipeline 등 cleanup 보장).
 */

"use client";

interface MinimalEvent {
  type: string;
}

/**
 * Discriminated union event 의 type 별 handler 맵.
 * 호출부에서 type 별 narrow 된 evt 사용 가능 (TS exhaustive 추론).
 */
type Handlers<TEvent extends MinimalEvent> = Partial<{
  [K in TEvent["type"]]: (evt: Extract<TEvent, { type: K }>) => void;
}>;

interface PipelineStreamOptions<TEvent extends MinimalEvent> {
  on: Handlers<TEvent>;
  /** "done" 외 모든 event 에서 type-specific handler 후 호출.
   *  Generate 의 setRunning(progress, stageLabel) + pushStage 같은 공통 진행 업데이트용. */
  onProgress?: (evt: Exclude<TEvent, { type: "done" }>) => void;
  /** 예외 catch — 기본은 throw (caller 가 명시) */
  onError?: (err: unknown) => void;
  /** generator 가 "done" 없이 EOF — 비정상 종료 알림용 */
  onIncomplete?: () => void;
  /** 어떤 종료 경로든 마지막 정리 (resetPipeline / running false 보장 등) */
  onFinally?: () => void;
}

/**
 * 스트림 generator 를 소비. "done" 이벤트 도착 시 정상 종료.
 *
 * @param generator AsyncIterable<TEvent> — type 필드를 가진 discriminated union 이벤트 시퀀스
 * @param opts handler/error/incomplete/finally 콜백
 */
export async function consumePipelineStream<TEvent extends MinimalEvent>(
  generator: AsyncIterable<TEvent>,
  opts: PipelineStreamOptions<TEvent>,
): Promise<void> {
  let completed = false;
  try {
    for await (const evt of generator) {
      // type 별 handler 호출. 미정의 type 은 silent skip.
      const key = evt.type as keyof Handlers<TEvent>;
      const handler = opts.on[key] as
        | ((e: TEvent) => void)
        | undefined;
      if (handler) handler(evt);
      if (evt.type === "done") {
        completed = true;
        return;
      }
      // done 이외 — 공통 진행 처리 (setRunning/pushStage 등)
      opts.onProgress?.(evt as Exclude<TEvent, { type: "done" }>);
    }
    if (!completed) opts.onIncomplete?.();
  } catch (err) {
    if (opts.onError) opts.onError(err);
    else throw err;
  } finally {
    opts.onFinally?.();
  }
}
