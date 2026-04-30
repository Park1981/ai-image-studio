/**
 * SnippetRegisterModal — 라이브러리 신규 등록 / 수정 통합 모달.
 *
 * 2026-04-30 (Phase 2A Task 4 + drawer 디자인 후속 — 등록/수정 통합).
 *
 * 동작:
 *  - mode="create" (기본): 새 항목 등록 (defaultPrompt pre-fill)
 *  - mode="edit": editTarget 의 name/prompt/thumbnail pre-fill + update 호출
 *  - 썸네일 — 옵셔널 · 1:1 정사각 crop · WebP 256px 압축
 *  - 수정 모드 + 옛 썸네일 있으면 미리보기 + [변경] / [제거] 버튼
 *  - z-index 9998 (LibraryDrawer 9997 위 · ShutdownButton 9999 아래)
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
import {
  type PromptSnippet,
  usePromptSnippetsStore,
} from "@/stores/usePromptSnippetsStore";
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
  /** "create" 기본 / "edit" 시 editTarget 의 값으로 pre-fill + update 호출 */
  mode?: "create" | "edit";
  /** create 시 textarea 의 현재 prompt pre-fill */
  defaultPrompt?: string;
  /** edit 시 기존 entry — 모달 진입 시 name/prompt/thumbnail 이 이걸로 초기화 */
  editTarget?: PromptSnippet;
}

export default function SnippetRegisterModal({
  open,
  onClose,
  mode = "create",
  defaultPrompt = "",
  editTarget,
}: Props) {
  const add = usePromptSnippetsStore((s) => s.add);
  const update = usePromptSnippetsStore((s) => s.update);

  const isEdit = mode === "edit" && !!editTarget;

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
  // 수정 모드 시 "현재 썸네일 제거" 의도. 새 image 와 별개.
  const [removeThumb, setRemoveThumb] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (isEdit && editTarget) {
      setName(editTarget.name);
      setPrompt(editTarget.prompt);
    } else {
      setName("");
      setPrompt(defaultPrompt);
    }
    setImage(null);
    setCropArea(null);
    setRemoveThumb(false);
    setError(null);
    setSubmitting(false);
  }, [open, defaultPrompt, isEdit, editTarget]);

  // ESC = close
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

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
      reader.onload = () => {
        setImage(reader.result as string);
        setRemoveThumb(false); // 새 이미지 업로드 = 제거 의도 취소
      };
      reader.onerror = () => setError("이미지 로드에 실패했어요.");
      reader.readAsDataURL(f);
    };
    inp.click();
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    if (sanitizedPrompt.length === 0) {
      setError(
        "프롬프트가 비어있어요. <lib> 마커만 적혀있는 경우 저장되지 않습니다.",
      );
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      // 새 썸네일 결정 — 3 케이스:
      //   1. image 있음 → 새 crop + 압축
      //   2. removeThumb 명시 (수정 모드만) → undefined (제거)
      //   3. 둘 다 아님 → thumbnail 키 자체 omit (수정 시 옛 그대로 유지 / 등록 시 thumbnail=undefined)
      let newThumbnail: string | undefined;
      let thumbnailChanged = false;
      if (image) {
        const blob = await dataUrlToBlob(image);
        const cropped = await cropBlobIfArea(blob, cropArea);
        newThumbnail = await blobToCompressedThumbDataUrl(cropped, 256, 0.75);
        thumbnailChanged = true;
      } else if (removeThumb && isEdit) {
        newThumbnail = undefined;
        thumbnailChanged = true;
      }

      if (isEdit && editTarget) {
        // store.update 안에서 stripAllMarkers + trim 자동 처리.
        update(editTarget.id, {
          name,
          prompt,
          ...(thumbnailChanged ? { thumbnail: newThumbnail } : {}),
        });
      } else {
        // store.add 안에서 stripAllMarkers + trim 자동 처리.
        add({ name, prompt, thumbnail: newThumbnail });
      }
      onClose();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : isEdit
            ? "수정에 실패했어요."
            : "등록에 실패했어요.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (!mounted || !open) return null;

  const showOldThumb =
    isEdit && !!editTarget?.thumbnail && !image && !removeThumb;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={isEdit ? "프롬프트 라이브러리 항목 수정" : "프롬프트 라이브러리 등록"}
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
            {isEdit ? "✎ 항목 수정" : "➕ 라이브러리에 등록"}
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
            // 새 이미지 업로드 → SnippetCropper 모드
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <SnippetCropper image={image} onCropArea={setCropArea} />
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button
                  type="button"
                  onClick={() => {
                    setImage(null);
                    setCropArea(null);
                  }}
                  style={linkBtnStyle}
                >
                  이미지 취소
                </button>
              </div>
            </div>
          ) : showOldThumb ? (
            // 수정 모드 + 옛 썸네일 있음 → 미리보기 + [변경] / [제거]
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div
                style={{
                  width: "100%",
                  borderRadius: "var(--radius-md)",
                  overflow: "hidden",
                  background: "var(--bg-2)",
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- base64 data URL */}
                <img
                  src={editTarget!.thumbnail}
                  alt={editTarget!.name}
                  style={{
                    display: "block",
                    width: "100%",
                    height: 200,
                    objectFit: "cover",
                  }}
                />
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: 8,
                }}
              >
                <button
                  type="button"
                  onClick={handlePickFile}
                  style={linkBtnStyle}
                >
                  이미지 변경
                </button>
                <button
                  type="button"
                  onClick={() => setRemoveThumb(true)}
                  style={{ ...linkBtnStyle, color: "#b42318" }}
                >
                  이미지 제거
                </button>
              </div>
            </div>
          ) : (
            // 빈 드롭존
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
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
                  boxSizing: "border-box",
                }}
              >
                <Icon name="upload" size={18} />
                <div style={{ marginTop: 6 }}>이미지 업로드 (옵셔널)</div>
              </button>
              {removeThumb && isEdit && (
                <div
                  style={{
                    display: "flex",
                    justifyContent: "flex-end",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setRemoveThumb(false)}
                    style={linkBtnStyle}
                  >
                    제거 취소
                  </button>
                </div>
              )}
            </div>
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
            {submitting
              ? isEdit
                ? "저장 중…"
                : "등록 중…"
              : isEdit
                ? "저장"
                : "등록"}
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

const linkBtnStyle: React.CSSProperties = {
  all: "unset",
  cursor: "pointer",
  fontSize: 11,
  color: "var(--ink-3)",
  padding: "4px 8px",
  borderRadius: "var(--radius-sm)",
};
