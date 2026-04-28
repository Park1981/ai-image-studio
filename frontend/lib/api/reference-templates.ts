/**
 * lib/api/reference-templates.ts — Edit reference template 라이브러리 API.
 *
 * Codex 2차 리뷰 fix #6: 백엔드가 반환하는 상대 URL (`/images/studio/...`) 을
 * STUDIO_BASE prefix 로 절대 URL 변환 (`<img src=...>` 가 Next.js origin 으로
 * 잘못 fetch 하는 사고 방지).
 */

import { STUDIO_BASE, USE_MOCK } from "./client";
import type { ReferenceTemplate } from "./types";

/** ReferenceTemplate.imageRef 를 STUDIO_BASE 기준 절대 URL 로 정규화. */
function normalizeReferenceTemplate(t: ReferenceTemplate): ReferenceTemplate {
  let ref = t.imageRef;
  if (
    ref &&
    !ref.startsWith("http://") &&
    !ref.startsWith("https://") &&
    !ref.startsWith("data:") &&
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
    const fetched = await fetch(req.imageFile);
    if (!fetched.ok) {
      throw new Error(
        `image fetch ${fetched.status}: ${req.imageFile.slice(0, 80)}`,
      );
    }
    const blob = await fetched.blob();
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
