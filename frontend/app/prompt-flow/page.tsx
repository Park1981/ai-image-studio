"use client";

import Link from "next/link";
import AppHeader from "@/components/chrome/AppHeader";
import Icon, { type IconName } from "@/components/ui/Icon";
import { StudioPage } from "@/components/studio/StudioLayout";
import styles from "./page.module.css";

type JourneyStep = {
  icon: IconName;
  title: string;
  body: string;
};

type FlowStep = {
  index: string;
  title: string;
  simple: string;
  detail: string;
  accent: "blue" | "green" | "amber";
};

const journey: JourneyStep[] = [
  {
    icon: "edit",
    title: "요청 입력",
    body: "생성·수정·영상 모두 사용자가 입력하신 문장에서 시작합니다.",
  },
  {
    icon: "wand",
    title: "프롬프트 정리",
    body: "AI 엔진이 읽기 쉬운 영어 문장으로 다듬어 드립니다.",
  },
  {
    icon: "scan-eye",
    title: "이미지 이해",
    body: "수정·영상 모드는 업로드하신 이미지를 먼저 분석해 기준을 잡습니다.",
  },
  {
    icon: "grid",
    title: "규칙 적용",
    body: "유지할 부분, 변경할 부분, 스타일 같은 조건을 정리합니다.",
  },
  {
    icon: "sparkle",
    title: "결과 생성",
    body: "최종 프롬프트가 이미지·영상 엔진으로 전달됩니다.",
  },
];

const generateSteps: FlowStep[] = [
  {
    index: "01",
    title: "원하는 장면을 문장으로 입력합니다",
    simple: "예) 비 오는 골목에서 네온사인을 보는 여성.",
    detail:
      "처음 입력은 짧아도 괜찮습니다. 앱이 이 문장을 원본 요청으로 보관하고, 별도로 최종 프롬프트를 만들어 줍니다.",
    accent: "blue",
  },
  {
    index: "02",
    title: "캔버스 정보를 함께 알려줍니다",
    simple: "선택하신 비율과 해상도를 프롬프트 정리 단계에 함께 전달합니다.",
    detail:
      "가로 사진·세로 사진·정사각형 같은 캔버스 정보를 알면 구도 표현이 더 안정적으로 만들어집니다.",
    accent: "green",
  },
  {
    index: "03",
    title: "필요하면 조사 힌트를 더합니다",
    simple: "Claude 프롬프트 조사를 켜시면 스타일·조명 힌트가 참고자료로 추가됩니다.",
    detail:
      "이 힌트는 명령이 아닌 참고 자료입니다. 원래 요청은 바꾸지 않고 표현만 풍부하게 만드는 용도로 사용됩니다.",
    accent: "amber",
  },
  {
    index: "04",
    title: "이미지용 영어 프롬프트로 다듬습니다",
    simple: "짧은 입력이 조명·구도·질감·분위기가 담긴 영어 문장으로 변환됩니다.",
    detail:
      "단, 입력에 미니멀·심플 같은 표현이 포함되면 과도한 디테일을 일부러 추가하지 않고 간결하게 유지합니다.",
    accent: "blue",
  },
  {
    index: "05",
    title: "확인하신 프롬프트는 다시 변경하지 않습니다",
    simple: "업그레이드 확인 모달에서 확정하신 문장은 그대로 생성 단계로 전달됩니다.",
    detail:
      "이미 검토를 마친 최종 문장을 AI에 다시 맡기지 않으므로, 시간이 단축되고 의미가 의도치 않게 바뀌는 일도 줄어듭니다.",
    accent: "green",
  },
  {
    index: "06",
    title: "스타일과 금지어를 붙여 엔진으로 전송합니다",
    simple: "스타일 프리셋이 활성화되어 있으면 트리거 문구와 LoRA 설정이 함께 적용됩니다.",
    detail:
      "최종 영어 프롬프트는 positive 로, 기본 품질 방지 문구는 negative 로 ComfyUI 에 전달됩니다.",
    accent: "amber",
  },
];

const editSteps: FlowStep[] = [
  {
    index: "01",
    title: "원본 요청을 받습니다",
    simple: "예) 배경만 밤거리로 바꾸고 인물은 그대로 유지해 주세요.",
    detail:
      "사용자가 작성하신 원문은 그대로 보관됩니다. 히스토리에 원문도 함께 저장되어 나중에 다시 확인하실 수 있습니다.",
    accent: "blue",
  },
  {
    index: "02",
    title: "수정 의도를 한 번 정리합니다",
    simple: "느슨한 한국어 요청을 명확한 영어 지시로 다듬는 단계입니다.",
    detail:
      "이 단계는 단순 번역이 아닌 의도 정리입니다. 무엇을 변경할지, 무엇을 유지할지 먼저 선명하게 만든 뒤 다음 단계로 넘어갑니다.",
    accent: "green",
  },
  {
    index: "03",
    title: "원본 이미지를 분석해 매트릭스로 나눕니다",
    simple: "이미지를 얼굴·머리·의상·자세·배경 같은 슬롯 단위로 분석합니다.",
    detail:
      "인물 사진이면 인물용 슬롯, 물체나 풍경이면 물체·장면용 슬롯을 사용합니다. 비전 모델이 도메인을 자동으로 판별합니다.",
    accent: "blue",
  },
  {
    index: "04",
    title: "변경할 슬롯과 유지할 슬롯을 분리합니다",
    simple: "변경할 슬롯은 구체적으로 작성하고, 유지할 슬롯은 자세히 묘사하지 않습니다.",
    detail:
      "유지할 부분을 너무 자세히 다시 묘사하면 생성 엔진이 그 부분까지 새로 그릴 위험이 있어, '원본 그대로 유지' 같은 일반 표현만 전달합니다.",
    accent: "amber",
  },
  {
    index: "05",
    title: "참조 이미지가 있으면 역할을 제한합니다",
    simple: "image2(참조)는 얼굴·의상·배경·스타일 중 지정하신 역할만 가져옵니다.",
    detail:
      "예를 들어 의상 참조라면 image2 의 옷만 가져오고, 얼굴·자세·배경은 image1 을 그대로 유지하도록 가드가 적용됩니다.",
    accent: "green",
  },
  {
    index: "06",
    title: "최종 프롬프트를 한 번 더 점검합니다",
    simple: "참조 이미지를 사용하는데 최종 문장에 image2 가 빠지면 자동으로 보강합니다.",
    detail:
      "이 안전장치 덕분에 참조 이미지를 올리셨지만 프롬프트가 그 이미지를 무시하는 상황을 줄여 줍니다.",
    accent: "amber",
  },
  {
    index: "07",
    title: "생성 엔진으로 전달합니다",
    simple: "최종 프롬프트와 image1, 필요하면 image2 를 함께 ComfyUI 로 보냅니다.",
    detail:
      "결과에는 원본 요청·최종 프롬프트·한국어 번역·분석 요약이 함께 저장되어 다시 확인하실 수 있습니다.",
    accent: "blue",
  },
];

const preserveSlots = ["얼굴/표정", "머리", "의상", "몸/자세", "배경"];
const sceneSlots = ["주제", "색/재질", "구도", "배경/장소", "분위기"];

const videoSteps: FlowStep[] = [
  {
    index: "01",
    title: "첫 장면 이미지와 영상 요청을 받습니다",
    simple: "예) 이 사진에서 카메라가 천천히 앞으로 다가가게 해 주세요.",
    detail:
      "영상 모드는 텍스트만으로 시작하지 않고, 업로드하신 이미지가 첫 프레임의 기준점이 됩니다.",
    accent: "blue",
  },
  {
    index: "02",
    title: "이미 다듬어진 문장이면 보강을 건너뜁니다",
    simple: "스킵 옵션을 켜시면 입력하신 문장을 그대로 최종 영상 프롬프트로 사용합니다.",
    detail:
      "이미지 분석과 프롬프트 보강 단계를 생략해 빠르게 진행됩니다. 다만 이때는 직접 작성하신 문장의 품질이 결과에 더 직접적으로 영향을 줍니다.",
    accent: "amber",
  },
  {
    index: "03",
    title: "스킵하지 않으면 이미지를 먼저 분석합니다",
    simple: "비전 AI가 첫 장면의 인물·배경·조명·구도를 요약합니다.",
    detail:
      "이 요약이 있어야 영상이 시작 프레임과 비슷하게 이어지고, 도중에 다른 사람이나 장소로 튀는 현상을 줄일 수 있습니다.",
    accent: "green",
  },
  {
    index: "04",
    title: "영상용 문장으로 다시 작성합니다",
    simple: "움직임·카메라·조명 변화·분위기를 한 문단으로 정리합니다.",
    detail:
      "LTX 영상 모델은 소리 없이 화면을 만드는 모델입니다. 그래서 음악·대사·소리 묘사보다는 보이는 움직임을 중심으로 프롬프트가 구성됩니다.",
    accent: "blue",
  },
  {
    index: "05",
    title: "첫 프레임 보존 문구를 넣습니다",
    simple: "같은 얼굴·같은 인물·같은 구도 같은 정체성 보존 문구가 강하게 포함됩니다.",
    detail:
      "영상 생성에서 가장 위험한 현상은 인물이나 물체가 도중에 다른 모습으로 변하는 것이라, 정체성 보존 문구가 사용자 지시보다 먼저 강하게 들어갑니다.",
    accent: "green",
  },
  {
    index: "06",
    title: "영상 엔진에 맞게 크기와 샘플링을 준비합니다",
    simple: "원본 비율을 유지해 리사이즈한 뒤, 5초 영상 샘플링으로 전달합니다.",
    detail:
      "최종 프롬프트와 첫 이미지가 함께 LTX 로 전달되어 MP4 가 생성되고, 사용된 프롬프트와 함께 히스토리에 저장됩니다.",
    accent: "amber",
  },
];

export default function PromptFlowPage() {
  const scrollToSection = (id: string) => {
    document.getElementById(id)?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  return (
    <StudioPage>
      <AppHeader />
      <main id="top" className={styles.page}>
        <section className={styles.hero}>
          <div className={styles.heroText}>
            <div className={styles.kicker}>Prompt Flow Guide</div>
            <h1>프롬프트가 결과가 되기까지</h1>
            <p>
              복잡한 함수 이름 대신, 실제로는 어떤 생각의 순서로 프롬프트가
              정리되는지 보여 드리는 설명 페이지입니다. 수정 흐름을 가장 크게
              다루었습니다.
            </p>
          </div>
          <div className={styles.heroPreview} aria-label="페이지 구성 요약">
            <HeroFlowRow
              icon="image"
              title="생성"
              image="/menu/generate.png"
              onClick={() => scrollToSection("generate-flow")}
            />
            <HeroFlowRow
              icon="edit"
              title="수정"
              image="/menu/edit.png"
              onClick={() => scrollToSection("edit-flow")}
            />
            <HeroFlowRow
              icon="film"
              title="영상"
              image="/menu/video.png"
              onClick={() => scrollToSection("video-flow")}
            />
          </div>
        </section>

        <section className={styles.overview} aria-labelledby="overview-title">
          <div className={styles.sectionHead}>
            <span className={styles.sectionEyebrow}>한 줄 요약</span>
            <h2 id="overview-title">세 흐름은 같은 원리로 움직입니다</h2>
            <p>
              사용자가 입력하신 문장이 바로 엔진으로 전달되는 것이 아니라,
              목적에 맞게 정리되고 필요한 이미지 정보가 결합된 뒤 최종
              프롬프트로 넘어갑니다.
            </p>
          </div>
          <div className={styles.journey}>
            {journey.map((step, idx) => (
              <div className={styles.journeyStep} key={step.title}>
                <div className={styles.journeyIcon}>
                  <Icon name={step.icon} size={18} />
                </div>
                <strong>{step.title}</strong>
                <span>{step.body}</span>
                {idx < journey.length - 1 && (
                  <div className={styles.journeyArrow} aria-hidden="true">
                    <Icon name="arrow-right" size={18} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        <section
          id="generate-flow"
          className={styles.modeDetail}
          aria-labelledby="generate-title"
        >
          <div className={styles.sectionHead}>
            <span className={styles.sectionEyebrow}>Generate Flow</span>
            <h2 id="generate-title">이미지 생성은 이렇게 정리됩니다</h2>
            <p>
              생성 모드는 원본 이미지가 없어서, 사용자가 입력하신 문장을 좋은
              촬영 지시문처럼 다듬는 흐름이 중심입니다.
            </p>
            <Link
              href="/prompt-flow/generate"
              style={{
                marginTop: 12,
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontSize: 13,
                fontWeight: 600,
                color: "var(--accent-ink)",
                textDecoration: "none",
                padding: "8px 14px",
                border: "1px solid var(--accent-ink)",
                borderRadius: 999,
                width: "fit-content",
              }}
            >
              <Icon name="grid" size={14} />
              분기 트리로 자세히 보기 (조건별 시뮬레이터)
              <Icon name="arrow-right" size={14} />
            </Link>
          </div>

          <div className={styles.modeDetailGrid}>
            <div className={styles.timeline}>
              {generateSteps.map((step) => (
                <StepCard step={step} key={step.index} />
              ))}
            </div>
            <aside className={styles.modeAside}>
              <VisualModeCard
                icon="image"
                title="이미지 생성"
                image="/menu/generate.png"
              />
              <div className={styles.ruleBlock}>
                <h3>생성에서 바뀌는 것</h3>
                <p>
                  짧은 요청이 구도·카메라 느낌·조명·질감이 포함된 영어
                  프롬프트로 변환됩니다.
                </p>
              </div>
              <div className={styles.ruleBlock}>
                <h3>다시 보강하지 않는 경우</h3>
                <p>
                  확인 모달에서 직접 수정하신 최종 프롬프트는 그대로
                  사용됩니다. 그래서 의도치 않은 재해석을 줄여 줍니다.
                </p>
              </div>
            </aside>
          </div>

          <GenerateUseCaseDiagram />

          <div className={styles.exampleFlow}>
            <ExampleCard label="사용자 입력" text="비 오는 골목의 네온 감성." />
            <ExampleCard
              label="추가 맥락"
              text="세로 이미지라면 인물 중심 구도, 가로 이미지라면 배경 공간을 더 넓게 잡도록 컨텍스트가 전달됩니다."
            />
            <ExampleCard
              label="정리된 프롬프트"
              text="A cinematic rainy alley scene with neon reflections, wet pavement, moody lighting, and a clear subject-focused composition."
            />
            <ExampleCard
              label="엔진 전달"
              text="최종 영어 문장 + 선택하신 스타일 + 기본 negative prompt 가 함께 전달됩니다."
            />
          </div>
        </section>

        <section
          id="edit-flow"
          className={styles.editFocus}
          aria-labelledby="edit-title"
        >
          <div className={styles.sectionHead}>
            <span className={styles.sectionEyebrow}>Main Focus</span>
            <h2 id="edit-title">이미지 수정은 이렇게 움직입니다</h2>
            <p>
              핵심은 &ldquo;어디를 변경할지&rdquo; 보다 &ldquo;어디를 건드리면
              안 되는지&rdquo; 까지 함께 정리하는 것입니다.
            </p>
          </div>

          <div className={styles.editGrid}>
            <div className={styles.timeline}>
              {editSteps.map((step) => (
                <StepCard step={step} key={step.index} />
              ))}
            </div>

            <aside className={styles.sidePanel} aria-label="수정 흐름 핵심 규칙">
              <div className={styles.ruleBlock}>
                <h3>분석표는 이렇게 구성됩니다</h3>
                <p>
                  AI 가 원본을 보고 5칸짜리 표로 나눕니다. 각 칸에는
                  <b> 변경</b> 또는 <b>유지</b> 가 표시됩니다.
                </p>
                <div className={styles.slotColumns}>
                  <SlotList title="인물 사진" items={preserveSlots} />
                  <SlotList title="물체·풍경" items={sceneSlots} />
                </div>
              </div>

              <div className={styles.ruleBlock}>
                <h3>참조 이미지가 있을 때</h3>
                <div className={styles.referenceRows}>
                  <ReferenceRule label="얼굴" text="얼굴 정체성만 image2 에서 가져옵니다." />
                  <ReferenceRule label="의상" text="옷과 액세서리만 가져옵니다." />
                  <ReferenceRule label="배경" text="배경만 image2 환경으로 변경합니다." />
                  <ReferenceRule label="스타일" text="색감과 조명 분위기만 적용합니다." />
                </div>
              </div>

              <div className={styles.ruleBlock}>
                <h3>가장 중요한 안전장치</h3>
                <p>
                  &ldquo;유지&rdquo; 칸은 자세히 묘사하지 않고 &ldquo;그대로
                  유지&rdquo; 라고만 전달합니다. 그래야 원본의 정상적인 부분을
                  다시 그리는 실수를 줄일 수 있습니다.
                </p>
              </div>
            </aside>
          </div>
        </section>

        <section className={styles.example} aria-labelledby="example-title">
          <div className={styles.sectionHead}>
            <span className={styles.sectionEyebrow}>예시</span>
            <h2 id="example-title">프롬프트가 실제로 변하는 느낌</h2>
          </div>
          <div className={styles.exampleFlow}>
            <ExampleCard
              label="사용자 입력"
              text="배경만 밤거리로 변경하고 인물 얼굴과 의상은 그대로 유지해 주세요."
            />
            <ExampleCard
              label="정리된 의도"
              text="Change only the background to a night city street. Keep the person, face, and clothing unchanged."
            />
            <ExampleCard
              label="분석표"
              text="얼굴 유지 · 의상 유지 · 자세 유지 · 배경 바꿈"
            />
            <ExampleCard
              label="최종 프롬프트"
              text="Replace only the background with a realistic night city street while preserving the same person, face, clothing, pose, lighting balance, and all unchanged details from image1."
            />
          </div>
        </section>

        <section
          id="video-flow"
          className={styles.modeDetail}
          aria-labelledby="video-title"
        >
          <div className={styles.sectionHead}>
            <span className={styles.sectionEyebrow}>Video Flow</span>
            <h2 id="video-title">영상 생성은 첫 장면을 기준으로 움직임을 만듭니다</h2>
            <p>
              영상은 프롬프트만 보는 것이 아니라, 업로드하신 이미지를 첫
              프레임으로 삼고 그 상태에서 어떤 움직임을 줄지 정리합니다.
            </p>
          </div>

          <div className={styles.modeDetailGrid}>
            <div className={styles.timeline}>
              {videoSteps.map((step) => (
                <StepCard step={step} key={step.index} />
              ))}
            </div>
            <aside className={styles.modeAside}>
              <VisualModeCard
                icon="film"
                title="영상 생성"
                image="/menu/video.png"
              />
              <div className={styles.ruleBlock}>
                <h3>영상에서 가장 중요한 것</h3>
                <p>
                  첫 이미지의 얼굴·피사체·구도가 유지되어야 합니다. 그래서
                  움직임보다 정체성 보존 문구가 먼저 적용됩니다.
                </p>
              </div>
              <div className={styles.ruleBlock}>
                <h3>스킵 옵션의 의미</h3>
                <p>
                  스킵을 켜면 빠르지만, 이미지 분석과 프롬프트 보강을 거치지
                  않습니다. 이미 잘 다듬어진 영어 영상 프롬프트일 때 사용하시는
                  옵션입니다.
                </p>
              </div>
            </aside>
          </div>
          <div className={styles.exampleFlow}>
            <ExampleCard label="사용자 입력" text="카메라가 천천히 앞으로 다가가게 해 주세요." />
            <ExampleCard
              label="이미지 이해"
              text="첫 장면의 인물·표정·배경·조명 상태를 먼저 요약합니다."
            />
            <ExampleCard
              label="영상 프롬프트"
              text="A slow cinematic dolly-in toward the same subject, preserving the face, pose, lighting, and first-frame composition."
            />
            <ExampleCard
              label="결과 저장"
              text="MP4 결과와 최종 영상 프롬프트·한국어 번역·이미지 설명이 히스토리에 함께 저장됩니다."
            />
          </div>
        </section>

        <button
          type="button"
          className={styles.topButton}
          onClick={() => scrollToSection("top")}
          title="맨 위로"
          aria-label="맨 위로 이동"
        >
          <Icon name="chevron-down" size={18} />
          TOP
        </button>
      </main>
    </StudioPage>
  );
}

function StepCard({ step }: { step: FlowStep }) {
  return (
    <article className={`${styles.stepCard} ${styles[step.accent]}`}>
      <div className={styles.stepIndex}>{step.index}</div>
      <div className={styles.stepCopy}>
        <h3>{step.title}</h3>
        <p className={styles.simple}>{step.simple}</p>
        <p>{step.detail}</p>
      </div>
    </article>
  );
}

function GenerateUseCaseDiagram() {
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

function HeroFlowRow({
  icon,
  title,
  image,
  onClick,
}: {
  icon: IconName;
  title: string;
  image: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={styles.heroFlowRow}
      onClick={onClick}
      title={`${title} 흐름으로 이동`}
      style={{
        backgroundImage: `linear-gradient(180deg, rgba(31,31,31,.05), rgba(31,31,31,.62)), url(${image})`,
      }}
    >
      <div className={styles.heroFlowTitle}>
        <Icon name={icon} size={18} />
        <strong>{title}</strong>
      </div>
    </button>
  );
}

function SlotList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className={styles.slotList}>
      <strong>{title}</strong>
      {items.map((item) => (
        <span key={item}>{item}</span>
      ))}
    </div>
  );
}

function ReferenceRule({ label, text }: { label: string; text: string }) {
  return (
    <div className={styles.referenceRule}>
      <span>{label}</span>
      <p>{text}</p>
    </div>
  );
}

function ExampleCard({ label, text }: { label: string; text: string }) {
  return (
    <article className={styles.exampleCard}>
      <span>{label}</span>
      <p>{text}</p>
    </article>
  );
}

function VisualModeCard({
  icon,
  title,
  image,
}: {
  icon: IconName;
  title: string;
  image: string;
}) {
  return (
    <article className={styles.visualModeCard}>
      <div
        className={styles.summaryMedia}
        style={{ backgroundImage: `linear-gradient(90deg, rgba(31,31,31,.58), rgba(31,31,31,.16)), url(${image})` }}
      >
        <Icon name={icon} size={24} />
        <h3>{title}</h3>
      </div>
    </article>
  );
}
