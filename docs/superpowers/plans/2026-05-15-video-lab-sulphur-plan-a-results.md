# Plan A — Phase 1.5 Hard Blocker 결과

**실행일**: 2026-05-15 21:50 +09:00  
**실행자**: 사용자 + Codex

## 1. ComfyUI /object_info 캡처 결과

- ComfyUI URL: `http://127.0.0.1:8000`
- 노드 수: 1254 개
- 캡처 파일: `backend/scripts/_capture_object_info.json` (gitignored, local diagnostic only)

## 2. LoRA enum 검증

| 파일 | 결과 | ComfyUI enum 값 |
|---|---|---|
| `sulphur_lora_rank_768.safetensors` | 통과 | `sulphur_lora_rank_768.safetensors` |
| `ltx-2.3-22b-distilled-lora-1.1_fro90_ceil72_condsafe.safetensors` | 통과 | `ltx-2.3-22b-distilled-lora-1.1_fro90_ceil72_condsafe.safetensors` |

Workflow LoRA node 매칭:

```text
ltx-2.3-22b-distilled-lora-1.1_fro90_ceil72_condsafe.safetensors
ltx-2.3-22b-distilled-lora-1.1_fro90_ceil72_condsafe.safetensors
sulphur_lora_rank_768.safetensors
```

결과: `2 / 2` 필수 LoRA, `3 / 3` workflow LoRA 통과.

## 3. class_type 검증

- Generated workflow nodes: 38
- Generated class_type: 27
- 결과: `27 / 27` class_type 모두 `/object_info` 에 존재

검증된 핵심 class_type:

```text
CheckpointLoaderSimple
LoraLoaderModelOnly
LTXVImgToVideoInplace
LTXVPreprocess
ResizeImageMaskNode
ResizeImagesByLongerEdge
CreateVideo
SaveVideo
```

## 4. Runtime Smoke

- 실행 명령: `python backend/scripts/verify_lab_workflow_runtime.py --longer-edge 512`
- 결과 MP4 URL: `/images/studio/video/2026-05-15/video-2150-048.mp4`
- 로컬 파일: `data/images/studio/video/2026-05-15/video-2150-048.mp4`
- 파일 크기: 307,398 bytes
- ComfyUI execution_error: 없음

진행 출력:

```text
[stage 54%] ComfyUI 샘플링 33%
[stage 73%] ComfyUI 샘플링 66%
[stage 92%] ComfyUI 샘플링 100%
[stage 42%] ComfyUI 샘플링 12%
[stage 49%] ComfyUI 샘플링 25%
[stage 56%] ComfyUI 샘플링 37%
[stage 63%] ComfyUI 샘플링 50%
[stage 70%] ComfyUI 샘플링 62%
[stage 77%] ComfyUI 샘플링 75%
[stage 84%] ComfyUI 샘플링 87%
[stage 92%] ComfyUI 샘플링 100%
MP4 저장 성공: /images/studio/video/2026-05-15/video-2150-048.mp4
```

## 5. 종합 평가

- 통과: Plan B (backend route/pipeline/builder) 진입 가능
- 근거: Sulphur LoRA 2개가 ComfyUI enum 에 노출되고, generated workflow 의 모든 class_type 이 존재하며, 실제 queue + MP4 저장까지 성공

## 6. 후속 결정

- LoRA strength 시작값은 첫 사용자 실측에서 `0.5 / 0.7 / 1.0` 비교
- Sulphur LoRA + eros 동시 호환성은 Plan B/C 이후 5조합 실측에서 확인
- Lab history 표시 범위는 Plan C 진입 시 exact model match 기준으로 결정
