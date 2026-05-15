"use client";

import { useEffect, useState } from "react";
import Icon from "@/components/ui/Icon";
import { checkLabVideoFiles, type LabVideoFilesResponse } from "@/lib/api/lab";

export default function LabFilesCheckBanner() {
  const [state, setState] = useState<{
    loading: boolean;
    data: LabVideoFilesResponse | null;
    error: string | null;
  }>({ loading: true, data: null, error: null });

  useEffect(() => {
    let alive = true;
    checkLabVideoFiles()
      .then((data) => {
        if (alive) setState({ loading: false, data, error: null });
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setState({
          loading: false,
          data: null,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    return () => {
      alive = false;
    };
  }, []);

  const tone = state.loading
    ? "rgba(148, 163, 184, 0.12)"
    : state.error || !state.data?.allPresent
      ? "rgba(251, 191, 36, 0.14)"
      : "rgba(45, 212, 191, 0.12)";
  const border = state.loading
    ? "rgba(148, 163, 184, 0.25)"
    : state.error || !state.data?.allPresent
      ? "rgba(251, 191, 36, 0.35)"
      : "rgba(45, 212, 191, 0.28)";

  return (
    <section
      style={{
        display: "grid",
        gap: 8,
        border: `1px solid ${border}`,
        background: tone,
        borderRadius: 8,
        padding: "10px 12px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: 12,
          fontWeight: 650,
          color: "var(--ink-1)",
        }}
      >
        <Icon
          name={state.error || !state.data?.allPresent ? "x" : "check"}
          size={14}
        />
        {state.loading
          ? "ComfyUI LoRA 확인 중"
          : state.error
            ? "ComfyUI 파일 확인 실패"
            : state.data?.allPresent
              ? "Lab LoRA 준비됨"
              : "필요 LoRA 누락"}
      </div>
      {(state.error || state.data?.missing.length) && (
        <div className="mono" style={{ fontSize: 11, color: "var(--ink-2)" }}>
          {state.error ?? state.data?.missing.join(" · ")}
        </div>
      )}
    </section>
  );
}
