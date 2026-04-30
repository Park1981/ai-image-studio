/**
 * SnippetRegisterModal — 라이브러리 신규 항목 등록 모달.
 *
 * 2026-04-30 (Phase 2A Task 4 · plan 2026-04-30-prompt-snippets-library.md).
 *
 * 동작:
 *  - 이름 입력 + prompt 편집 + 이미지 업로드 (옵셔널) → 등록
 *  - 이미지 있을 때만 SnippetCropper (1:1 고정 · 동적 ssr:false) 노출
 *  - [등록] 클릭 시 cropBlobIfArea → dataURL 변환 → usePromptSnippetsStore.add
 *  - z-index 9998 (LibraryModal 9997 보다 위 · ShutdownButton 9999 아래)
 *
 * 의존:
 *  - lib/image-crop (cropBlobIfArea · dataUrlToBlob 재사용 · v9 패턴)
 *  - stores/usePromptSnippetsStore (sanitize on add 가 store 안에서 처리됨)
 */

"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Icon from "@/components/ui/Icon";
import {
  blobToCompressedThumbDataUrl,
  cropBlobIfArea,
  dataUrlToBlob,
} from "@/lib/image-crop";
import { stripAllMarkers } from "@/lib/snippet-marker";
import { usePromptSnippetsStore } from "@/stores/usePromptSnippetsStore";
import type { CropArea } from "@/stores/useEditStore";

// SSR 격리 — react-easy-crop 은 window 의존이라 server 에서 import 자체가 깨짐.
const SnippetCropper = dynamic(() => import("./SnippetCropper"), {
  ssr: false,
  loading: () => (
    <div
      style={{
        height: 240,
        display: "grid",
        placeItems: "center",
        color: "var(--ink-4)",
        fontSize: 12,
        background: "var(--bg-2)",
        borderRadius: "var(--radius-md)",
      }}
    >
      crop UI 로드 중…
    </div>
  ),
});

interface Props {
  open: boolean;
  onClose: () => void;
  /** 부모가 textarea 의 현재 prompt 를 pre-fill 로 넘김 (편집 가능) */
  defaultPrompt?: string;
}

export default function SnippetRegisterModal({
  open,
  onClose,
  defaultPrompt = "",
}: Props) {
  const add = usePromptSnippetsStore((s) => s.add);

  // Portal SSR 안전
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  // open 시 default 값으로 초기화 (재오픈 시 fresh)
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState(defaultPrompt);
  const [image, setImage] = useState<string | null>(null);
  const [cropArea, setCropArea] = useState<CropArea | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setPrompt(defaultPrompt);
      setImage(null);
      setCropArea(null);
      setError(null);
      setSubmitting(false);
    }
  }, [open, defaultPrompt]);

  // ESC = close
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // 2026-04-30 (codex review fix · Important #1):
  // store.add 가 stripAllMarkers(prompt).trim() 후 빈값이면 silent skip 하므로
  // 모달도 같은 sanitize 기준으로 canSubmit 판단해야 silent fail 방지.
  // 예: `<lib></lib>` 만 입력해도 raw trim 으론 활성화돼서 닫기만 되는 함정.
  const sanitizedPrompt = useMemo(
    () => stripAllMarkers(prompt).trim(),
    [prompt],
  );
  const canSubmit = useMemo(
    () => !submitting && name.trim().length > 0 && sanitizedPrompt.length > 0,
    [submitting, name, sanitizedPrompt],
  );

  const handlePickFile = () => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "image/*";
    inp.onchange = () => {
      const f = inp.files?.[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => setImage(reader.result as string);
      reader.onerror = () => setError("이미지 로드에 실패했어요.");
      reader.readAsDataURL(f);
    };
    inp.click();
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    // 2026-04-30 (codex review fix · Important #1): canSubmit 와 동일 sanitize
    // 가드를 handleSubmit 에서도 한 번 더 — race / 직접 호출 시 안전망.
    if (sanitizedPrompt.length === 0) {
      setError(
        "프롬프트가 비어있어요. <lib> 마커만 적혀있는 경우 저장되지 않습니다.",
      );
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      let thumbnail: string | undefined;
      if (image) {
        const blob = await dataUrlToBlob(image);
        const cropped = await cropBlobIfArea(blob, cropArea);
        // 2026-04-30 (localStorage quota fix): WebP 256px q=0.75 압축.
        // PNG dataURL (수 MB) → WebP (~20-30KB) ≈ 95%+ 절감.
        thumbnail = await blobToCompressedThumbDataUrl(cropped, 256, 0.75);
      }
      // store.add 안에서 stripAllMarkers + trim 자동 처리 (Codex v3 #4).
      add({ name, prompt, thumbnail });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "등록에 실패했어요.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!mounted || !open) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="프롬프트 라이브러리 등록"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9998,
        background: "rgba(31,31,31,.32)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        display: "grid",
        placeItems: "center",
        padding: 24,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(560px, 100%)",
          maxHeight: "calc(100vh - 48px)",
          overflowY: "auto",
          border: "1px solid var(--line)",
          borderRadius: "var(--radius-card)",
          background: "var(--surface)",
          padding: 24,
          boxShadow: "var(--shadow-lg)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 16,
          }}
        >
          <h1 style={{ margin: 0, fontSize: 18, lineHeight: 1.2 }}>
            ➕ 라이브러리에 등록
          </h1>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            style={{
              all: "unset",
              cursor: "pointer",
              width: 28,
              height: 28,
              display: "grid",
              placeItems: "center",
              borderRadius: "var(--radius-sm)",
              color: "var(--ink-4)",
            }}
          >
            <Icon name="x" size={14} />
          </button>
        </div>

        {/* 이름 */}
        <Field label="이름">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="예: 부드러운 인물 (cinematic 35mm)"
            maxLength={60}
            style={inputStyle}
          />
        </Field>

        {/* prompt */}
        <Field label="프롬프트 본문" hint="(<lib> 마커는 저장 시 자동 제거)">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={5}
            placeholder="예: cinematic 35mm, soft window light"
            style={{ ...inputStyle, resize: "vertical", minHeight: 96 }}
          />
        </Field>

        {/* 썸네일 (옵셔널) */}
        <Field label="썸네일" hint="(옵셔널 · 1:1 정사각 crop)">
          {image ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <SnippetCropper image={image} onCropArea={setCropArea} />
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button
                  type="button"
                  onClick={() => {
                    setImage(null);
                    setCropArea(null);
                  }}
                  style={{
                    all: "unset",
                    cursor: "pointer",
                    fontSize: 11,
                    color: "var(--ink-4)",
                    padding: "4px 8px",
                    borderRadius: "var(--radius-sm)",
                  }}
                >
                  이미지 제거
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={handlePickFile}
              style={{
                all: "unset",
                cursor: "pointer",
                width: "100%",
                padding: "20px 12px",
                textAlign: "center",
                border: "2px dashed var(--line)",
                borderRadius: "var(--radius-md)",
                color: "var(--ink-3)",
                fontSize: 12,
              }}
            >
              <Icon name="upload" size={18} />
              <div style={{ marginTop: 6 }}>이미지 업로드 (옵셔널)</div>
            </button>
          )}
        </Field>

        {error && (
          <div
            role="alert"
            style={{
              marginTop: 8,
              padding: "8px 10px",
              borderRadius: "var(--radius-sm)",
              background: "rgba(239,68,68,.08)",
              color: "#b42318",
              fontSize: 12,
            }}
          >
            {error}
          </div>
        )}

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            marginTop: 20,
          }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            style={{ ...btnStyle, background: "var(--bg-2)", color: "var(--ink-2)" }}
          >
            취소
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            style={{
              ...btnStyle,
              background: canSubmit ? "var(--accent)" : "var(--bg-2)",
              color: canSubmit ? "#fff" : "var(--ink-4)",
              cursor: canSubmit ? "pointer" : "not-allowed",
            }}
          >
            {submitting ? "등록 중…" : "등록"}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}

/* ── 작은 helper 컴포넌트 / 스타일 ── */

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-2)" }}>
          {label}
        </span>
        {hint && (
          <span style={{ fontSize: 11, color: "var(--ink-4)" }}>{hint}</span>
        )}
      </div>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  fontSize: 13,
  border: "1px solid var(--line)",
  borderRadius: "var(--radius-sm)",
  background: "var(--bg)",
  color: "var(--ink)",
  outline: "none",
  boxSizing: "border-box",
};

const btnStyle: React.CSSProperties = {
  height: 34,
  padding: "0 16px",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--line)",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};
