/**
 * lib/api/reference-templates.ts — Edit reference template 라이브러리 API.
 *
 * Codex 2차 리뷰 fix #6: 백엔드가 반환하는 상대 URL (`/images/studio/...`) 을
 * STUDIO_BASE prefix 로 절대 URL 변환 (`<img src=...>` 가 Next.js origin 으로
 * 잘못 fetch 하는 사고 방지).
 */

import { STUDIO_BASE, USE_MOCK, fetchImageBlob } from "./client";
import type { ReferenceTemplate } from "./types";

/** ReferenceTemplate.imageRef 를 STUDIO_BASE 기준 절대 URL 로 정규화.
 *  보존 prefix: http:// / https:// / data: / blob: / mock-seed://.
 *  나머지는 상대 path 로 간주해 STUDIO_BASE prefix 추가.
 *  Codex Phase B+C 리뷰 fix #5: blob: 분기 누락 fix.
 */
function normalizeReferenceTemplate(t: ReferenceTemplate): ReferenceTemplate {
  let ref = t.imageRef;
  if (
    ref &&
    !ref.startsWith("http://") &&
    !ref.startsWith("https://") &&
    !ref.startsWith("data:") &&
    !ref.startsWith("blob:") &&
    !ref.startsWith("mock-seed://")
  ) {
    // 상대 path → STUDIO_BASE prefix
    ref = `${STUDIO_BASE}${ref.startsWith("/") ? "" : "/"}${ref}`;
  }
  return { ...t, imageRef: ref };
}

export async function listReferenceTemplates(): Promise<ReferenceTemplate[]> {
  if (USE_MOCK) return [];
  try {
    const res = await fetch(`${STUDIO_BASE}/api/studio/reference-templates`);
    if (!res.ok) return [];
    const data = (await res.json()) as { items: ReferenceTemplate[] };
    return (data.items ?? []).map(normalizeReferenceTemplate);
  } catch {
    return [];
  }
}

export async function createReferenceTemplate(req: {
  /** File 또는 data URL 모두 허용 (브라우저 fetch 후 blob 추출) */
  imageFile: File | string;
  name: string;
  role?: string;
  userIntent?: string;
  visionModel?: string;
}): Promise<ReferenceTemplate | null> {
  if (USE_MOCK) return null;
  const form = new FormData();
  if (typeof req.imageFile === "string") {
    const blob = await fetchImageBlob(req.imageFile);
    form.append("image", blob, "reference.png");
  } else {
    form.append("image", req.imageFile);
  }
  form.append(
    "meta",
    JSON.stringify({
      name: req.name,
      role: req.role,
      userIntent: req.userIntent,
      visionModel: req.visionModel,
    }),
  );
  const res = await fetch(`${STUDIO_BASE}/api/studio/reference-templates`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    throw new Error(`create template failed: ${res.status}`);
  }
  const data = (await res.json()) as { item: ReferenceTemplate };
  return normalizeReferenceTemplate(data.item);
}

export async function deleteReferenceTemplate(id: string): Promise<boolean> {
  if (USE_MOCK) return true;
  const res = await fetch(
    `${STUDIO_BASE}/api/studio/reference-templates/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
  return res.ok;
}

export async function touchReferenceTemplate(id: string): Promise<boolean> {
  if (USE_MOCK) return true;
  try {
    const res = await fetch(
      `${STUDIO_BASE}/api/studio/reference-templates/${encodeURIComponent(id)}/touch`,
      { method: "POST" },
    );
    return res.ok;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────
// v9 (2026-04-29 · Phase C): 사후 저장 promote
// ─────────────────────────────────────────────

export interface PromoteResponse {
  template: ReferenceTemplate;
  visionFailed: boolean;
}

/**
 * 임시 풀 ref 를 영구 라이브러리로 promote (v9 사후 저장).
 *
 * @param historyId  promote 할 history row 의 ID
 * @param name       사용자 지정 이름 (1~64자, alphanumeric/한글/공백/-_)
 * @param role       옵션 — 없으면 history 의 referenceRole 사용
 * @param userIntent 옵션 — 사용자가 promote 시점에 추가
 *
 * @throws Error on HTTP failure (400 invalid name / 404 history not found / 500 db failure)
 */
export async function promoteFromHistory(
  historyId: string,
  name: string,
  options?: { role?: string; userIntent?: string },
): Promise<PromoteResponse> {
  const res = await fetch(
    `${STUDIO_BASE}/api/studio/reference-templates/promote/${encodeURIComponent(
      historyId,
    )}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        role: options?.role,
        userIntent: options?.userIntent,
      }),
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`promote failed: ${res.status} ${text}`);
  }
  const data = (await res.json()) as {
    template: ReferenceTemplate;
    visionFailed: boolean;
  };
  return {
    template: normalizeReferenceTemplate(data.template),
    visionFailed: !!data.visionFailed,
  };
}
