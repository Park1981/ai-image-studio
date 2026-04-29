/**
 * ReferencePromoteModal — 사후 라이브러리 저장 모달 (v9 · Phase C.1).
 *
 * 결과 ActionBar 의 📚 라이브러리 저장 버튼 클릭 시 노출.
 * 이름 input + 정규식 검증 + 저장/취소.
 *
 * vision 실패 시 visionFailed=true 응답 → 부분 성공 토스트 (Codex I6).
 *
 * Plan: docs/superpowers/plans/2026-04-29-reference-library-v9.md
 */

"use client";

import { useEffect, useState } from "react";

import Icon from "@/components/ui/Icon";
import { promoteFromHistory } from "@/lib/api/reference-templates";
import { toast } from "@/stores/useToastStore";

interface Props {
  historyId: string;
  open: boolean;
  onClose: () => void;
  /** promote 성공 시 호출.
   *  Args: newReferenceRef = 영구 라이브러리 URL (backend 가 history.referenceRef 를 swap 한 값) */
  onSuccess?: (newReferenceRef: string) => void;
}

const NAME_PATTERN = /^[A-Za-z0-9가-힣\s_\-]{1,64}$/;

export default function ReferencePromoteModal({
  historyId,
  open,
  onClose,
  onSuccess,
}: Props) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  // 모달 닫힐 때마다 입력 reset
  useEffect(() => {
    if (!open) {
      setName("");
      setBusy(false);
    }
  }, [open]);

  // ESC 키 닫기
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  if (!open) return null;

  const trimmed = name.trim();
  const valid = NAME_PATTERN.test(trimmed);

  const handleSave = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      const { template, visionFailed } = await promoteFromHistory(
        historyId,
        trimmed,
      );
      if (visionFailed) {
        toast.warn(
          "부분 성공",
          `'${template.name}' 저장 — vision 분석 실패 (description 비어있음)`,
        );
      } else {
        toast.success("라이브러리 저장 완료", `'${template.name}' 추가됨`);
      }
      // template.imageRef 는 normalizeReferenceTemplate 거친 *절대 URL*. store 도 동일 형식으로 swap.
      onSuccess?.(template.imageRef);
      onClose();
    } catch (e) {
      toast.error(
        "저장 실패",
        e instanceof Error ? e.message : "알 수 없는 오류",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="라이브러리 저장"
      onClick={(e) => {
        // backdrop 클릭 닫힘 — 단 입력 중에는 보호 안 함 (취소 의도 명확)
        if (e.target === e.currentTarget && !busy) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 80,
        background: "rgba(0,0,0,.5)",
        display: "grid",
        placeItems: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--surface)",
          borderRadius: "var(--radius-card)",
          padding: 24,
          width: 380,
          boxShadow: "0 20px 60px rgba(0,0,0,.3)",
          border: "1px solid var(--line)",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <div
          style={{
            fontSize: 16,
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <Icon name="grid" size={16} />
          참조 라이브러리에 저장
        </div>
        <div style={{ fontSize: 12, color: "var(--ink-2)", lineHeight: 1.5 }}>
          이 결과의 참조 이미지를 라이브러리에 영구 저장합니다.
          <br />
          저장 후 vision 분석 (5-10초 소요) 자동 실행 — 실패 시 description 만 비어있음.
        </div>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && valid && !busy) {
              void handleSave();
            }
          }}
          placeholder="이름 (1~64자, 한글/영문/숫자/공백/-_)"
          disabled={busy}
          autoFocus
          style={{
            all: "unset",
            display: "block",
            boxSizing: "border-box",
            width: "100%",
            padding: "10px 12px",
            borderRadius: "var(--radius-md)",
            border: "1px solid var(--line)",
            background: "var(--bg-1, var(--surface))",
            color: "var(--ink)",
            fontSize: 14,
          }}
        />
        {trimmed && !valid && (
          <div style={{ fontSize: 11, color: "var(--danger, #c44)" }}>
            허용: 1~64자, 한글/영문/숫자/공백/하이픈/언더스코어
          </div>
        )}
        <div
          style={{
            display: "flex",
            gap: 8,
            justifyContent: "flex-end",
          }}
        >
          <button
            onClick={onClose}
            disabled={busy}
            style={{
              all: "unset",
              cursor: busy ? "not-allowed" : "pointer",
              padding: "8px 16px",
              borderRadius: "var(--radius-md)",
              fontSize: 13,
              color: "var(--ink-2)",
              opacity: busy ? 0.5 : 1,
            }}
          >
            취소
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={!valid || busy}
            style={{
              all: "unset",
              cursor: valid && !busy ? "pointer" : "not-allowed",
              padding: "8px 16px",
              borderRadius: "var(--radius-md)",
              fontSize: 13,
              fontWeight: 600,
              background:
                valid && !busy ? "var(--accent)" : "var(--ink-4, #999)",
              color: "#fff",
              opacity: valid && !busy ? 1 : 0.5,
            }}
          >
            {busy ? "저장 중…" : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
}
