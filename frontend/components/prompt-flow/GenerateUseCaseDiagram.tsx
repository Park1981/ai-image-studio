/**
 * GenerateUseCaseDiagram — UC Generate Pipeline 다이어그램.
 *
 * 옛 page.tsx 에 있던 컴포넌트를 그대로 분리. 사용자가 보여준 이미지 1번
 * (UC Generate Pipeline) 의 구현체. SYSTEM Boundary + 메인 5단계 + 상하 확장 분기.
 *
 * 추후 PNG/SVG 로 교체될 수 있어 단일 컴포넌트로 격리.
 */

"use client";

import styles from "./prompt-flow.module.css";

export default function GenerateUseCaseDiagram() {
  return (
    <section className={styles.ucSection} aria-labelledby="generate-uc-title">
      <div className={styles.ucSectionHead}>
        <span className={styles.sectionEyebrow}>Graphic View</span>
        <h3 id="generate-uc-title">생성 모드 변환 다이어그램 (Use Case 스타일)</h3>
        <p>
          위 단계 카드가 문자 기준 설명이라면, 이 다이어그램은 같은 흐름을
          그래픽으로 보여 드립니다. 실선은 기본 흐름이고, 점선은 조건부로
          붙는 확장 분기입니다.
        </p>
      </div>

      <div className={styles.ucBoundary}>
        <span className={styles.ucBoundaryLabel}>uc Generate Pipeline</span>
        <div className={styles.ucTitle}>System Boundary</div>

        <div className={styles.ucDiagramWrap}>
          <div className={styles.ucExtendRow}>
            <UcExtendNode
              label="한글 → 영어 번역"
              condition="한글 입력일 때"
              colorClass={styles.ucColorPurple}
              sysPrompt="SYSTEM_GENERATE"
            />
            <UcExtendNode
              label="조사 힌트 흡수"
              condition="Claude 조사 ON"
              colorClass={styles.ucColorGreen}
              sysPrompt="data-only hints"
            />
            <UcExtendNode
              label="미니멀 모드"
              condition="미니멀 키워드"
              colorClass={styles.ucColorAmber}
              sysPrompt="minimal branch"
            />
            <UcExtendNode
              label="보강 호출 스킵"
              condition="사전 확정 프롬프트"
              colorClass={styles.ucColorRose}
              sysPrompt="pre-confirmed"
            />
          </div>

          <div className={styles.ucMainRow}>
            <UcMainNode
              number="01"
              label="사용자 입력"
              desc="원본 prompt"
              colorClass={styles.ucColorPurple}
            />
            <span className={styles.ucMainArrow} aria-hidden="true">→</span>
            <UcMainNode
              number="02"
              label="프롬프트 보강"
              desc="영어 생성 지시문"
              colorClass={styles.ucColorInk}
              sysPrompt="gemma4"
            />
            <span className={styles.ucMainArrow} aria-hidden="true">→</span>
            <UcMainNode
              number="03"
              label="캔버스 결합"
              desc="비율·해상도"
              colorClass={styles.ucColorAmber}
            />
            <span className={styles.ucMainArrow} aria-hidden="true">→</span>
            <UcMainNode
              number="04"
              label="ComfyUI 전달"
              desc="prompt + LoRA + seed"
              colorClass={styles.ucColorBlue}
              sysPrompt="flat API"
            />
            <span className={styles.ucMainArrow} aria-hidden="true">→</span>
            <UcMainNode
              number="05"
              label="이미지 결과"
              desc="히스토리 저장"
              colorClass={styles.ucColorCyan}
            />
          </div>

          <div className={styles.ucExtendRow}>
            <UcExtendNode
              label="Lightning"
              condition="빠른 생성"
              colorClass={styles.ucColorBlue}
              sysPrompt="steps 8 · cfg 1.5"
            />
            <UcExtendNode
              label="Style LoRA"
              condition="스타일 프리셋"
              colorClass={styles.ucColorCyan}
              sysPrompt="trigger + override"
            />
            <UcExtendNode
              label="기본 샘플링"
              condition="스타일 OFF"
              colorClass={styles.ucColorRose}
              sysPrompt="default sampling"
            />
          </div>

          <svg
            className={styles.ucSvgOverlay}
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            {[12, 32, 56, 78].map((leftPct) => (
              <line
                key={`top-${leftPct}`}
                x1={leftPct}
                y1="22"
                x2="30"
                y2="42"
                stroke="#9aa3b2"
                strokeWidth="0.4"
                strokeDasharray="0.8 0.6"
                opacity="0.55"
              />
            ))}
            {[20, 50, 80].map((leftPct) => (
              <line
                key={`bottom-${leftPct}`}
                x1={leftPct}
                y1="78"
                x2="70"
                y2="58"
                stroke="#9aa3b2"
                strokeWidth="0.4"
                strokeDasharray="0.8 0.6"
                opacity="0.55"
              />
            ))}
          </svg>
        </div>

        <div className={styles.ucActorRow}>
          <span className={styles.ucActorRoleLabel}>외부 액터</span>
          <span className={styles.ucActor}>사용자</span>
          <span className={styles.ucActor}>Ollama gemma4</span>
          <span className={styles.ucActor}>Claude 조사</span>
          <span className={styles.ucActor}>ComfyUI</span>
        </div>
      </div>
    </section>
  );
}

function UcMainNode({
  number,
  label,
  desc,
  colorClass,
  sysPrompt,
}: {
  number: string;
  label: string;
  desc: string;
  colorClass: string;
  sysPrompt?: string;
}) {
  return (
    <div className={`${styles.ucMainNode} ${colorClass}`}>
      <div className={styles.ucMainNumber}>{number}</div>
      <div className={styles.ucMainLabel}>{label}</div>
      <p className={styles.ucMainDesc}>{desc}</p>
      {sysPrompt && <span className={styles.ucSysPrompt}>{sysPrompt}</span>}
    </div>
  );
}

function UcExtendNode({
  label,
  condition,
  colorClass,
  sysPrompt,
}: {
  label: string;
  condition: string;
  colorClass: string;
  sysPrompt: string;
}) {
  return (
    <div className={`${styles.ucExtendNode} ${colorClass}`}>
      <span className={styles.ucExtendTagBadge}>&lt;&lt;extend&gt;&gt;</span>
      <span className={styles.ucExtendLabel}>{label}</span>
      <span className={styles.ucExtendCondition}>{`{${condition}}`}</span>
      <span className={styles.ucSysPrompt}>{sysPrompt}</span>
    </div>
  );
}
