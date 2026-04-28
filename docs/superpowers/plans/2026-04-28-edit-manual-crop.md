# Edit Multi-Reference 수동 Crop UI

**작성일**: 2026-04-28
**브랜치**: `claude/edit-multi-ref` (기존 multi-ref 브랜치 위에 이어서)
**관련 plan**: `2026-04-27-edit-multi-reference.md` (multi-ref 기능 본체) / `2026-04-27-edit-reference-library.md` (참조 이미지 라이브러리 — 후속)

---

## 1. 목표

Edit 모드 multi-reference 토글 ON 시 사용자가 image2 의 `사용 영역` 을 *직접* 선택할 수 있는 인라인 crop editor 를 제공한다.

## 2. 컨텍스트 (왜)

`2026-04-28` 사용자 검증 결과 (DB `edit-153d2c13` · 결과 `edit-1537-018.png`):

- gemma4 가 만든 영어 prompt 자체는 정확 (face replace + sweater removed + hair/body/bg preserve 명시)
- 그럼에도 Qwen Edit 가 image2 를 broad reference 로 처리 → image2 의 의상 (검은 cut-out 톱) 이 결과에 그대로 transfer
- `2026-04-28` 1차 시도에서 도입한 face geometric crop 은 얼굴 위치 다양성에서 빗나감 → 제거 (`0d7ff57`)
- detector 도입 (mediapipe/insightface) 은 dependency 부담 + 별도 plan 거리

**해결 사상**: 사용자가 *직접* 영역을 잘라서 image2 를 *해당 영역만* 으로 만든다 → ComfyUI 의 multi-ref 가 받는 image2 자체가 의도된 영역 한정 → 누수 가능성 제거. native ComfyUI 워크플로우와 동일.

face transfer 자체의 약점 (Qwen Edit 의 source-face preserve instinct) 은 본 plan 의 범위 밖 (InstantID 별도 plan).

## 3. UX 흐름

```
1. multi-ref 토글 ON
2. image2 업로드
3. 업로드 즉시 → 인라인 crop editor 변환 (모달 X · 자리에서)
   · default 박스 = 이미지 전체 (zoom 1.0 / 박스 100%)
   · 자유 pan/zoom (마우스 드래그 + 휠)
   · 비율 lock 프리셋: [자유] [1:1] [4:3] [9:16]
4. 사용자가 박스 조정 (또는 default 100% 그대로)
5. role 선택 (기존 그대로 · crop 영역과 모순 검사 X)
6. "수정 생성" 클릭
7. 클라이언트가 그 시점 박스 → canvas.toBlob('image/png')
8. cropped Blob 만 multipart 의 reference_image 로 백엔드 전송
9. 백엔드 변경 0 (이미 image2 받는 구조 그대로)
10. 결과 도착 → 영구 저장 / 갤러리 / cleanup 은 본 plan 범위 밖 (`2026-04-27-edit-reference-library.md` 에서 다룸)
```

## 4. 결정사항 (논의 결과)

| 항목 | 결정 | 근거 |
|------|------|------|
| Layout | 인라인 (모달 X) | 흐름 끊김 없음 |
| 확정 버튼 | **없음** · "수정 생성" 시점에 crop 적용 | 클릭 한 번 절감 + 시멘틱 일치 |
| Crop 강제 | **강제** · image2 = 무조건 crop 단계 통과 | 단순 + 사용자 책임 명확 |
| Default 박스 | **이미지 전체 (100%)** | 박스 안 줄이면 = 원본 그대로 → 강제 부담 0 |
| 비율 lock | **자유 (default) + 1:1 / 4:3 / 9:16 토글** | UX 명확 |
| 크기 프리셋 (100/95/70) | **X** | zoom slider + drag 와 중복 |
| Role × Crop 모순 검사 | **X** | 사용자 자유 + 책임 |
| 저장 (history.db reference_ref) | **결과 후 결정** · default 미저장 (임시) | 사용자 자율성 |
| Cleanup | 설정 페이지에 자동 + 수동 버튼 | 시스템 부담 ↓ |
| 라이브러리 재적용 시 | **crop UI bypass** (`bypassCrop` flag) | 이미 crop 된 이미지 재 crop 시 품질 손실 + 짜증 |

## 5. 기술 스택

| 항목 | 선택 |
|------|------|
| Crop 라이브러리 | **`react-easy-crop`** (~30KB gzipped · pan/zoom 직관 · TS 완비 · 결과 추출 단순) |
| 출력 형식 | PNG Blob (`canvas.toBlob('image/png')`) |
| 백엔드 multipart | 변경 0 (이미 `reference_image` field 받음) |

## 6. Phase 분할

각 Phase 종료 시 검증 (pytest + vitest + tsc + lint clean) → Phase 단위 commit. 전체 master merge 는 Phase 6 끝나고 옵션 A 정책으로 한 번.

> **Codex 리뷰 코멘트 (2026-04-28)**  
> 방향은 좋음. 다만 MVP 는 Phase 1~3 까지만 먼저 자르는 것을 권장. Phase 4~5 의 저장/cleanup 은 reference library plan 과 겹치고 scope 가 커짐.  
> 구현 시 `referenceImage` 는 현재 store 에서 data URL 이므로, submit 시 `data URL → Blob → crop → File(reference-crop.png)` 흐름을 명시해야 함.  
> crop state 는 percent 보다 `croppedAreaPixels` 저장이 안전하고, reference 변경/해제/토글 OFF 때 반드시 reset 필요.  
> backend face auto-crop 코드가 남아 있으면 manual crop 과 double crop 충돌 가능성이 있으니 제거 또는 bypass 확인 필요.

> **✅ 반영 (2026-04-28)**  
> #1 — MVP scope = Phase 1~3 으로 축소. 옛 Phase 4 (저장) / Phase 5 (cleanup) 는 본 plan에서 제거 → `2026-04-27-edit-reference-library.md` 에서 흡수.  
> #2 — Phase 1 컴포넌트 props 를 `imageSrc: string` (URL) 로 변경 + Phase 2 에 `data URL → Blob → crop → File('reference-crop.png')` 흐름 도식 명시.  
> #3 — `referenceCropArea` state 는 `{ x, y, width, height }` (pixels) 로 명시 + reset 트리거 3 (새 업로드 / 해제 / 토글 OFF) 명시.  
> #4 — backend face auto-crop 은 `0d7ff57` 에서 이미 제거됨 → double crop 우려 0. 위험요소 섹션에 한 줄 명시.

### Phase 1 — Crop editor 컴포넌트 (~1h)

**목표**: image2 업로드 시 인라인 crop UI 노출.

**작업**:
- `frontend/package.json` → `react-easy-crop` 추가 (Next.js dynamic import + `ssr: false`)
- `frontend/components/studio/EditReferenceCrop.tsx` 신규
  - props:
    - `imageSrc: string` — image source URL (data URL 또는 ObjectURL · 호출자가 보장)
    - `onAreaChange: (area: CroppedAreaPixels | null) => void`
    - `bypassCrop?: boolean` — 라이브러리 plan 진입 시 활성 (현재는 자리만)
  - default: zoom 1.0 · aspect undefined (자유)
  - 비율 lock 토글 UI (자유 / 1:1 / 4:3 / 9:16)
  - `onCropComplete` 의 `croppedAreaPixels` 만 부모에 전달 (percent 는 화면 사이즈 의존이라 무시)
  - bypassCrop=true 면 그냥 미리보기만 (crop UI 숨김)
- `frontend/app/edit/page.tsx` (또는 image2 업로드 영역) 에 컴포넌트 통합
- Zustand `useEditStore` 에 추가:
  - `referenceCropArea: { x: number; y: number; width: number; height: number } | null`
  - **reset 트리거 3개** 명시:
    1. image2 새 업로드 시 → `null`
    2. image2 해제 (X 버튼) 시 → `null`
    3. multi-ref 토글 OFF 시 → `null`

**검증**: vitest 기존 통과 + 컴포넌트 신규 테스트
- default 박스 = zoom 1.0 (이미지 전체)
- 비율 lock 토글 동작 (자유 / 1:1 / 4:3 / 9:16)
- bypassCrop=true 시 UI 숨김
- reset 트리거 3개 (새 업로드 / 해제 / 토글 OFF) 시 area null

### Phase 2 — 클라이언트 crop → Blob (~30분)

**목표**: "수정 생성" 클릭 시점에 그 박스 영역만 cropped File 로 변환 후 multipart 전송.

**변환 흐름** (Codex #2 명시):
```
data URL (store.referenceImage)
  ↓ fetch(dataUrl).then(r => r.blob())
Blob
  ↓ croppedAreaPixels 적용 (canvas drawImage → toBlob)
cropped Blob
  ↓ new File([blob], 'reference-crop.png', { type: 'image/png' })
File
  ↓ FormData append
multipart 의 reference_image 필드
```

**작업**:
- `frontend/lib/image-crop.ts` 신규 — 두 헬퍼:
  - `dataUrlToBlob(dataUrl: string): Promise<Blob>`
  - `cropBlobByArea(blob: Blob, area: CroppedAreaPixels): Promise<Blob>` (canvas + toBlob)
- `frontend/hooks/useEditPipeline.ts` 수정 — submit 시점:
  - `referenceImage` (data URL) → `dataUrlToBlob` → original Blob
  - `referenceCropArea` 가 있으면 → `cropBlobByArea` → cropped Blob
  - cropped Blob (또는 area 없으면 original) → `new File([..], 'reference-crop.png', ..)` → FormData
- `bypassCrop=true` 인 reference 는 area 무시하고 원본 그대로 전송 (라이브러리 plan 활성 시)
- `frontend/lib/api/edit.ts` → 변경 0

**검증**: vitest 헬퍼 단위 테스트
- `dataUrlToBlob` 기본 동작 (PNG / JPEG)
- `cropBlobByArea` 1:1 / 자유 비율 / 100% (전체) 케이스
- area null 일 때 원본 그대로 통과 (no-crop path)

### Phase 3 — 백엔드 검증 (~15분)

**목표**: cropped Blob 이 ComfyUI 까지 정상 전달되는지 확인.

**작업**:
- 코드 변경 거의 0 (image2 multipart 이미 받음)
- `backend/tests/studio/test_multi_ref_edit.py` 에 cropped image2 사이즈 차이 회귀 테스트 (small reference Blob → ComfyUI dispatch OK)
- `_dispatch.py` 의 `extra_uploads` workflow summary log 가 cropped 도 정상 처리하는지 점검

**검증**: pytest 231 → 232~234 (cropped 회귀 테스트 추가만큼)

### Phase 4 — 종합 검증 + commit + master merge (~20분)

**목표**: 전체 회귀 0 + master merge.

**작업**:
- `cd backend; pytest tests/`
- `cd frontend; npm test; npm run lint; npx tsc --noEmit`
- 사용자 수동 검증 (gen-1152-001 / gen-2212-006 케이스 다시 — image2 얼굴 영역만 crop 후 결과 비교)
- `git checkout master; git merge --no-ff claude/edit-multi-ref`
- `docs/changelog.md` 갱신 (multi-ref + 수동 crop 섹션)
- `CLAUDE.md` 의 multi-ref 사용법 + crop 안내 추가

## 7. 위험 요소 / Open Questions

| 항목 | 대응 |
|------|------|
| react-easy-crop 의 SSR 호환성 | Next.js dynamic import (`ssr: false`) 로 처리 |
| 큰 이미지 + canvas.toBlob 성능 | 대상 < 4096px 가정 (Qwen Edit 한계 자체가 그 이하) · 필요 시 OffscreenCanvas |
| 임시 파일 leak | 본 plan 범위 밖 (라이브러리 plan 의 cleanup 에서 다룸) |
| crop 결과가 너무 작을 때 (<256px) | Phase 1 에서 minimum 박스 크기 검증 (예: 256x256 미만 경고 toast) |
| `bypassCrop` flag 가 라이브러리 plan 종속 | Phase 1 에서 자리만 마련 · 실제 활성화는 라이브러리 plan 에서 |
| Backend face auto-crop 과 double crop 충돌 | `0d7ff57` 에서 face geometric crop 제거됨 → 우려 0 (Codex #4) |

## 8. 검증 baseline

- pytest **231** (현재) → Phase 3 후 **+2~5**
- vitest **61** → Phase 1-2 후 **+5~8**
- tsc / lint clean 유지

## 9. Phase 별 commit 메시지 패턴

```
feat(edit): Phase N — manual crop UI (간단 설명)

Phase N 의 구체 작업 (불릿 3-5)

검증
- pytest XXX passed
- vitest XX passed
- tsc / lint clean

Co-Authored-By: ...
```

## 10. 종료 조건 (Phase 1-3 MVP)

- 사용자 수동 검증 OK (image2 얼굴/의상 영역만 crop 후 의상 누수 차단 확인 — gen-1152-001 / gen-2212-006 케이스 재현)
- 전체 회귀 0 (pytest + vitest + tsc + lint clean)
- master merge 완료 (`--no-ff`)
- changelog + CLAUDE.md 의 multi-ref 사용법에 *수동 crop 단계* 안내 추가

검증 결과 *여전히* face transfer 가 약하면 (Qwen Edit 본질 한계) → multi-ref 의 *얼굴* role 만 한계 명시 + 의상/배경 role 위주 사용 가이드. 별도 InstantID plan 은 그 이후.

옛 Phase 4 (저장) / Phase 5 (cleanup) 는 **`2026-04-27-edit-reference-library.md`** 에서 다룸 (MVP 검증 결과로 가치 확인 후 진입).
